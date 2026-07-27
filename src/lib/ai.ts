import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/lib/env";
import type { RewriteInput, RewrittenEmail } from "@/lib/types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
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

    const message = await getClient().messages.parse(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: userContent }],
        output_config: { format: zodOutputFormat(RewriteSchema) },
      },
      { timeout: 60_000 },
    );

    const parsed = message.parsed_output;
    if (!parsed) {
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
      return fallbackResult(input);
    }

    return { email: parsed, usedFallback: false };
  } catch {
    return fallbackResult(input);
  }
}
