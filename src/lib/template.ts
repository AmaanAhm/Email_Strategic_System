import type { ContactRow } from "@/lib/types";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** The only placeholders that resolve to recipient data. */
export const TEMPLATE_VARIABLES = [
  "name",
  "company",
  "email",
  "website",
  "industry",
] as const;

/** Any {{...}} token, well-formed or not, for reporting back to the author. */
const ANY_PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

const PROBE: ContactRow = {
  name: "x",
  company: "x",
  email: "x",
  website: "x",
  industry: "x",
};

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

/**
 * True if any brace residue survives substitution — which means the recipient
 * would literally receive "{{" in their inbox.
 *
 * Checked against a probe contact so a legitimately empty field (a contact with
 * no website) is never mistaken for a broken placeholder.
 */
export function hasUnresolvedPlaceholders(template: string): boolean {
  const substituted = substituteVariables(template, PROBE);
  return substituted.includes("{{") || substituted.includes("}}");
}

/**
 * Author-time validation for a subject or body.
 *
 * Two failure modes, both of which used to reach real inboxes:
 *  - a name that isn't a real variable ({{firstname}}, {{first_name}}, {{Amaan}})
 *  - braces that don't pair up or nest ({{a{{name}}}}, "{{name}")
 *
 * Returns human-readable problems, empty array when the template is safe.
 */
export function findTemplateIssues(template: string): string[] {
  const issues: string[] = [];
  const known = new Set<string>(TEMPLATE_VARIABLES);

  // Scan in passes, stripping each layer of {{...}} tokens. Nesting hides outer
  // placeholders from a single scan: in "abc{{Amaan{{elhekko}}}}" the only
  // well-formed token is {{elhekko}}, and {{Amaan}} is only exposed once the
  // inner one is removed. Each pass strictly shrinks the string, so this ends.
  const unknown = new Set<string>();
  let remaining = template;
  for (;;) {
    for (const match of remaining.matchAll(ANY_PLACEHOLDER)) {
      const key = match[1].trim().toLowerCase();
      if (!known.has(key)) unknown.add(match[0]);
    }
    const stripped = remaining.replace(ANY_PLACEHOLDER, "");
    if (stripped === remaining) break;
    remaining = stripped;
  }
  for (const token of unknown) {
    issues.push(`${token} is not a variable`);
  }

  // Anything brace-shaped still standing after every token was removed is an
  // unclosed or mismatched brace rather than a misnamed variable.
  if (hasUnresolvedPlaceholders(remaining)) {
    issues.push(
      "braces are unbalanced, so { } characters would be sent literally",
    );
  }

  return issues;
}
