import type { ContactRow } from "@/lib/types";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Replaces {{variable}} placeholders in a template with contact fields.
 *
 * - Keys are matched case-insensitively: {{name}}, {{ Name }}, {{NAME}} all work.
 * - Whitespace inside the braces is ignored.
 * - Known keys: name, company, email, website, industry.
 * - Missing optional fields and unknown keys resolve to "".
 */
export function substituteVariables(template: string, c: ContactRow): string {
  const values: Record<string, string> = {
    name: c.name ?? "",
    company: c.company ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
    industry: c.industry ?? "",
  };
  return template.replace(VARIABLE_PATTERN, (_match, key: string) => {
    return values[key.toLowerCase()] ?? "";
  });
}
