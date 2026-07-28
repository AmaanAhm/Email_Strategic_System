import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "@/lib/env";
import type { RewriteInput, RewrittenEmail } from "@/lib/types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

const RewriteSchema = z.object({
  subject: z.string(),
  greeting: z.string(),
  opening: z.string(),
  body: z.string(),
  cta: z.string(),
  closing: z.string(),
});

function fallbackResult(input: RewriteInput): {
  email: RewrittenEmail;
  usedFallback: boolean;
} {
  return {
    email: {
      subject: input.subject,
      greeting: "",
      opening: "",
      body: input.masterBody,
      cta: "",
      closing: "",
    },
    usedFallback: true,
  };
}

/**
 * Falling back silently is what let a missing API key go unnoticed for 13
 * sends. The campaign still proceeds — an outage should not strand a list —
 * but the reason is always written to the worker log.
 */
function logFallback(stage: string, reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[ai] ${stage} fell back to the master email: ${message}`);
}

export async function rewriteEmail(
  input: RewriteInput,
): Promise<{ email: RewrittenEmail; usedFallback: boolean }> {
  try {
    const { recipient, senderName } = input;

    const system = [
      "You rewrite B2B outreach emails so each recipient receives a unique version.",
      "Keep the exact same meaning, offer and professional tone.",
      "Rewrite the subject, greeting, opening line, body, call-to-action and sign-off so the wording differs from the original.",
      "Do not invent facts, numbers, or claims not present in the original.",
      "Keep a similar length.",
      "Personalize naturally with the recipient's name/company/industry when it helps.",
      "Never include template placeholders such as {{name}} or any { } characters in your output.",
      `Sender name for the sign-off: ${senderName}`,
    ].join(" ");

    const recipientLines = [
      `Name: ${recipient.name}`,
      `Company: ${recipient.company}`,
    ];
    if (recipient.industry) recipientLines.push(`Industry: ${recipient.industry}`);
    if (recipient.website) recipientLines.push(`Website: ${recipient.website}`);

    const userContent = [
      `Subject: ${input.subject}`,
      "",
      input.masterBody,
      "",
      "Recipient:",
      ...recipientLines,
    ].join("\n");

    const completion = await getClient().chat.completions.parse(
      {
        model: env.OPENAI_MODEL,
        max_completion_tokens: 4096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        response_format: zodResponseFormat(RewriteSchema, "rewritten_email"),
      },
      { timeout: 60_000 },
    );

    const choice = completion.choices[0];
    if (choice?.message.refusal) {
      logFallback("rewriteEmail", `model refused: ${choice.message.refusal}`);
      return fallbackResult(input);
    }

    const parsed = choice?.message.parsed;
    if (!parsed) {
      logFallback("rewriteEmail", "no parsed output returned");
      return fallbackResult(input);
    }
    const pieces = [
      parsed.subject,
      parsed.greeting,
      parsed.opening,
      parsed.body,
      parsed.cta,
      parsed.closing,
    ];
    if (pieces.some((p) => typeof p !== "string" || p.trim().length === 0)) {
      logFallback("rewriteEmail", "model returned an empty section");
      return fallbackResult(input);
    }

    return { email: parsed, usedFallback: false };
  } catch (err) {
    logFallback("rewriteEmail", err);
    return fallbackResult(input);
  }
}
