import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/lib/env";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

const SubjectsSchema = z.object({
  subjects: z.array(z.string()),
});

/**
 * Generates subject-line variations for a campaign using Claude.
 *
 * Never throws: on any failure (API error, timeout, empty/unusable output)
 * it falls back to `[masterSubject]`. On success the returned array always
 * contains the master subject first, followed by up to `count` variations.
 */
export async function generateSubjectVariations(
  masterSubject: string,
  masterBody: string,
  count = 5,
): Promise<string[]> {
  try {
    const res = await getClient().messages.parse(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        system: [
          "You are a professional cold-email subject-line writer.",
          `Write exactly ${count} distinct subject-line variations of the original subject you are given.`,
          "Each variation must preserve the same meaning and offer as the original subject, in a professional tone suitable for B2B outreach.",
          "Avoid clickbait, spam-trigger words (FREE, urgent, act now, !!!, ALL CAPS), and misleading claims.",
          "The subject may contain template placeholders like {{name}} or {{company}} — keep any placeholders verbatim and unchanged in your variations.",
          "Keep each variation concise (under 80 characters where possible).",
        ].join(" "),
        messages: [
          {
            role: "user",
            content: [
              `Original subject: ${masterSubject}`,
              "",
              "Email body (for context about the offer):",
              masterBody,
            ].join("\n"),
          },
        ],
        output_config: {
          format: zodOutputFormat(SubjectsSchema),
        },
      },
      { timeout: 60_000 },
    );

    const parsed = res.parsed_output;
    if (!parsed) {
      return [masterSubject];
    }

    const usable = parsed.subjects
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (usable.length < 1) {
      return [masterSubject];
    }

    const withMaster = usable.includes(masterSubject)
      ? usable
      : [masterSubject, ...usable];
    return withMaster.slice(0, count + 1);
  } catch {
    return [masterSubject];
  }
}
