import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "@/lib/env";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

const SubjectsSchema = z.object({
  subjects: z.array(z.string()),
});

/**
 * Generates subject-line variations for a campaign.
 *
 * Never throws: on any failure (API error, timeout, empty/unusable output)
 * it falls back to `[masterSubject]`, logging why. On success the returned
 * array always contains the master subject first, followed by up to `count`
 * variations.
 */
export async function generateSubjectVariations(
  masterSubject: string,
  masterBody: string,
  count = 5,
): Promise<string[]> {
  try {
    const completion = await getClient().chat.completions.parse(
      {
        model: env.OPENAI_MODEL,
        max_completion_tokens: 2048,
        messages: [
          {
            role: "system",
            content: [
              "You are a professional cold-email subject-line writer.",
              `Write exactly ${count} distinct subject-line variations of the original subject you are given.`,
              "Each variation must preserve the same meaning and offer as the original subject, in a professional tone suitable for B2B outreach.",
              "Avoid clickbait, spam-trigger words (FREE, urgent, act now, !!!, ALL CAPS), and misleading claims.",
              "The subject may contain template placeholders like {{name}} or {{company}} — keep any placeholders verbatim and unchanged, and never introduce new ones.",
              "Keep each variation concise (under 80 characters where possible).",
            ].join(" "),
          },
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
        response_format: zodResponseFormat(SubjectsSchema, "subject_variations"),
      },
      { timeout: 60_000 },
    );

    const choice = completion.choices[0];
    if (choice?.message.refusal) {
      console.warn(
        `[ai] subject variations refused, using the master subject only: ${choice.message.refusal}`,
      );
      return [masterSubject];
    }

    const parsed = choice?.message.parsed;
    if (!parsed) {
      console.warn("[ai] subject variations returned nothing usable");
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
  } catch (err) {
    console.warn(
      `[ai] subject variations failed, using the master subject only: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [masterSubject];
  }
}
