import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Job } from "bullmq";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { ContactRow, SendEmailJobData } from "@/lib/types";
import {
  hasUnresolvedPlaceholders,
  substituteVariables,
} from "@/lib/template";
import { mimeTypeFor } from "@/lib/attachments";
import { rewriteEmail } from "@/lib/ai";
import { GmailSendError, findSentMessageId, sendGmail } from "@/lib/gmail";
import { ReauthRequiredError } from "@/lib/google";
import { getSenderForCampaign } from "@/lib/senders";

/**
 * Fail the recipient being processed and pause its campaign, so an author
 * mistake costs one email rather than the whole list.
 */
async function failRecipientAndPause(
  recipientId: string,
  campaignId: string,
  reason: string,
): Promise<void> {
  await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, status: "SENDING" },
    data: { status: "FAILED", lastError: reason },
  });
  await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ["RUNNING", "SCHEDULED"] } },
    data: { status: "PAUSED" },
  });
}

export async function sendProcessor(job: Job<SendEmailJobData>): Promise<void> {
  const { recipientId } = job.data;

  // (1) Claim: QUEUED -> SENDING.
  const claimed = await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, status: "QUEUED" },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const current = await prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      select: { status: true },
    });
    if (current?.status === "SENDING") {
      // A previous attempt died mid-send; we cannot know whether the email
      // went out, so do not retry.
      await prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: "SENDING" },
        data: {
          status: "FAILED",
          lastError:
            "Indeterminate previous send attempt - not retried to avoid duplicates",
        },
      });
    }
    return;
  }

  let campaignId: string | null = null;
  let userId: string | null = null;
  let senderIsDefault = false;
  let sendAttempted = false;

  try {
    // (2) Load recipient with campaign.
    const recipient = await prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: { campaign: true },
    });
    if (!recipient) return;
    const { campaign } = recipient;
    campaignId = campaign.id;
    userId = campaign.userId;

    // Resolve which connected sender dispatches this campaign (explicit choice,
    // else the user's default). No sender means we cannot send safely.
    const sender = await getSenderForCampaign(campaign);
    if (!sender) {
      await prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: "SENDING" },
        data: {
          status: "FAILED",
          lastError: "No connected sender available for this campaign",
        },
      });
      await prisma.campaign.updateMany({
        where: { id: campaignId, status: { in: ["RUNNING", "SCHEDULED"] } },
        data: { status: "PAUSED" },
      });
      return;
    }
    senderIsDefault = sender.isDefault;

    // Stable across retries, so a retry can ask Gmail whether an earlier attempt
    // whose response was lost actually delivered. The domain must match the
    // sending address — receivers treat an unresolvable Message-ID domain as spam.
    const senderDomain = sender.email.split("@")[1] ?? "gmail.com";
    const rfcMessageId = `<${recipientId}@${senderDomain}>`;
    if (campaign.status !== "RUNNING") {
      await prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: "SENDING" },
        data: { status: "SCHEDULED" },
      });
      return;
    }

    // (3) Build content.
    const recipientRow: ContactRow = {
      name: recipient.name,
      company: recipient.company,
      email: recipient.email,
      website: recipient.website ?? undefined,
      industry: recipient.industry ?? undefined,
    };
    const variations =
      campaign.subjectVariations.length > 0
        ? campaign.subjectVariations
        : [campaign.masterSubject];
    const picked = variations[Math.floor(Math.random() * variations.length)];
    const subject = substituteVariables(picked, recipientRow);
    const body = substituteVariables(campaign.masterBody, recipientRow);
    const senderName = sender.name ?? sender.email;

    // Campaigns created before author-time validation existed, or edited
    // directly in the database, can still carry a broken placeholder. Sending
    // literal "{{...}}" to a prospect is unrecoverable, so stop the whole
    // campaign here instead of burning the rest of the list one email at a time.
    if (
      hasUnresolvedPlaceholders(subject) ||
      hasUnresolvedPlaceholders(body)
    ) {
      await failRecipientAndPause(
        recipientId,
        campaignId,
        "Unresolved {{placeholder}} in the subject or body - fix the campaign template before sending",
      );
      return;
    }

    const { email, usedFallback } = await rewriteEmail({
      masterBody: body,
      subject,
      recipient: recipientRow,
      senderName,
    });
    const finalSubject = email.subject || subject;
    const finalBody =
      [email.greeting, email.opening, email.body, email.cta, email.closing]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join("\n\n") || body;

    // The rewrite is free text from the model; it can echo braces back even
    // when the substituted input was clean.
    if (
      hasUnresolvedPlaceholders(finalSubject) ||
      hasUnresolvedPlaceholders(finalBody)
    ) {
      await failRecipientAndPause(
        recipientId,
        campaignId,
        "Rewritten email still contained a {{placeholder}} - not sent",
      );
      return;
    }

    // (4) Attachment. pdfPath is a bare filename (any allowlisted type, not
    // just PDF); keep the read inside UPLOAD_DIR regardless of what was stored.
    let attachment: Buffer | undefined;
    if (campaign.pdfPath) {
      const uploadDir = path.resolve(env.UPLOAD_DIR);
      const pdfFile = path.resolve(uploadDir, path.basename(campaign.pdfPath));
      if (pdfFile !== uploadDir && !pdfFile.startsWith(uploadDir + path.sep)) {
        await prisma.campaignRecipient.updateMany({
          where: { id: recipientId, status: "SENDING" },
          data: { status: "FAILED", lastError: "Attachment file missing" },
        });
        return;
      }
      try {
        attachment = await readFile(pdfFile);
      } catch {
        await prisma.campaignRecipient.updateMany({
          where: { id: recipientId, status: "SENDING" },
          data: { status: "FAILED", lastError: "Attachment file missing" },
        });
        return;
      }
    }

    // Prefer the name the user uploaded; fall back to the stored name so the
    // extension — and therefore the Content-Type — survives either way.
    const attachmentName =
      campaign.pdfFileName ?? campaign.pdfPath ?? "attachment";

    // (5) On a retry, an earlier attempt may have delivered even though its
    // response was lost. Ask Gmail before sending a second copy.
    const isRetry = job.attemptsMade > 0 || recipient.attemptCount > 1;
    if (isRetry) {
      const priorMessageId = await findSentMessageId(sender, rfcMessageId);
      if (priorMessageId) {
        await prisma.campaignRecipient.updateMany({
          where: { id: recipientId, status: "SENDING" },
          data: {
            status: "SENT",
            sentAt: new Date(),
            finalSubject,
            finalBody,
            usedFallback,
            gmailMessageId: priorMessageId,
          },
        });
        return;
      }
    }

    // (6) Send.
    sendAttempted = true;
    const { gmailMessageId } = await sendGmail(sender, {
      to: recipient.email,
      subject: finalSubject,
      textBody: finalBody,
      messageId: rfcMessageId,
      attachment: attachment
        ? {
            filename: attachmentName,
            // Derived from the stored file name, so a .csv is not mailed out
            // announcing itself as a PDF.
            contentType: mimeTypeFor(attachmentName),
            data: attachment,
          }
        : undefined,
    });

    // (7) Success.
    await prisma.campaignRecipient.updateMany({
      where: { id: recipientId, status: "SENDING" },
      data: {
        status: "SENT",
        sentAt: new Date(),
        finalSubject,
        finalBody,
        usedFallback,
        gmailMessageId,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuthError =
      (err instanceof GmailSendError && err.kind === "AUTH") ||
      err instanceof ReauthRequiredError;

    if (isAuthError && userId && campaignId) {
      await prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: "SENDING" },
        data: { status: "FAILED", lastError: message },
      });
      // The failing sender is flagged for reconnect by sendGmail. Only nag the
      // global (login) banner when it's the default/login sender that broke.
      if (senderIsDefault) {
        await prisma.user.update({
          where: { id: userId },
          data: { needsReauth: true },
        });
      }
      await prisma.campaign.updateMany({
        where: { id: campaignId, status: { in: ["RUNNING", "SCHEDULED"] } },
        data: { status: "PAUSED" },
      });
      return;
    }

    if (err instanceof GmailSendError && err.kind === "PERMANENT") {
      await prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: "SENDING" },
        data: { status: "FAILED", lastError: message },
      });
      return;
    }

    // RATE_LIMIT / TRANSIENT / unknown: retry via BullMQ unless out of
    // attempts. A non-Gmail failure before the send (e.g. a database blip)
    // means nothing went out, so it goes back to QUEUED for the tick to pick
    // up again rather than being failed for something the recipient never did.
    const maxAttempts = job.opts.attempts ?? 1;
    const outOfAttempts = job.attemptsMade + 1 >= maxAttempts;
    if (outOfAttempts && (sendAttempted || err instanceof GmailSendError)) {
      await prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: "SENDING" },
        data: { status: "FAILED", lastError: message },
      });
      return;
    }
    await prisma.campaignRecipient.updateMany({
      where: { id: recipientId, status: "SENDING" },
      data: { status: "QUEUED", lastError: message },
    });
    if (outOfAttempts) return;
    throw err;
  }
}
