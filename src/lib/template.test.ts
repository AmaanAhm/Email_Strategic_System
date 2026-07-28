import { describe, it, expect } from "vitest";
import {
  findTemplateIssues,
  hasUnresolvedPlaceholders,
  substituteVariables,
} from "@/lib/template";
import type { ContactRow } from "@/lib/types";

const contact: ContactRow = {
  name: "Priya Sharma",
  company: "Acme Corp",
  email: "priya@acme.com",
  website: "https://acme.com",
  industry: "SaaS",
};

describe("substituteVariables", () => {
  it("replaces basic variables", () => {
    expect(substituteVariables("Hi {{name}} from {{company}}", contact)).toBe(
      "Hi Priya Sharma from Acme Corp",
    );
  });

  it("tolerates whitespace inside braces", () => {
    expect(substituteVariables("Hi {{ name }}!", contact)).toBe(
      "Hi Priya Sharma!",
    );
    expect(substituteVariables("{{  company  }}", contact)).toBe("Acme Corp");
    expect(substituteVariables("{{\temail\t}}", contact)).toBe(
      "priya@acme.com",
    );
  });

  it("is case-insensitive on variable names", () => {
    expect(substituteVariables("{{NAME}}", contact)).toBe("Priya Sharma");
    expect(substituteVariables("{{Name}}", contact)).toBe("Priya Sharma");
    expect(substituteVariables("{{ InDuStRy }}", contact)).toBe("SaaS");
  });

  it("replaces all occurrences", () => {
    expect(substituteVariables("{{name}} {{name}} {{email}}", contact)).toBe(
      "Priya Sharma Priya Sharma priya@acme.com",
    );
  });

  it("replaces unknown variables with an empty string", () => {
    expect(substituteVariables("Hello {{unknown}}!", contact)).toBe("Hello !");
    expect(substituteVariables("{{foo}}{{bar}}", contact)).toBe("");
  });

  it("replaces missing optional fields with an empty string", () => {
    const minimal: ContactRow = {
      name: "Jo",
      company: "Co",
      email: "jo@co.com",
    };
    expect(substituteVariables("Site: {{website}}|{{industry}}", minimal)).toBe(
      "Site: |",
    );
  });

  it("leaves malformed placeholders untouched", () => {
    expect(substituteVariables("{{name}", contact)).toBe("{{name}");
    expect(substituteVariables("{ {name} }", contact)).toBe("{ {name} }");
    expect(substituteVariables("{{first name}}", contact)).toBe(
      "{{first name}}",
    );
  });

  it("handles templates with no variables", () => {
    expect(substituteVariables("Plain text.", contact)).toBe("Plain text.");
    expect(substituteVariables("", contact)).toBe("");
  });
});

describe("hasUnresolvedPlaceholders", () => {
  it("passes templates that fully resolve", () => {
    expect(hasUnresolvedPlaceholders("Hi {{name}} at {{company}}")).toBe(false);
    expect(hasUnresolvedPlaceholders("No variables here")).toBe(false);
    expect(hasUnresolvedPlaceholders("")).toBe(false);
  });

  it("does not flag a contact whose optional field is empty", () => {
    const noWebsite: ContactRow = {
      name: "Jo",
      company: "Co",
      email: "jo@co.com",
    };
    expect(hasUnresolvedPlaceholders("Site: {{website}}")).toBe(false);
    expect(substituteVariables("Site: {{website}}", noWebsite)).toBe("Site: ");
  });

  it("catches unknown names that would ship literally", () => {
    expect(hasUnresolvedPlaceholders("Hi {{first_name}}")).toBe(true);
    expect(hasUnresolvedPlaceholders("Hi {{Company Name}}")).toBe(true);
    expect(hasUnresolvedPlaceholders("Hi {{name1}}")).toBe(true);
  });

  it("catches the nested case that reached real inboxes", () => {
    // Sent as "abc{{Amaan}}ZNX Media" before this check existed.
    expect(hasUnresolvedPlaceholders("abc{{Amaan{{elhekko}}}}{{name}}")).toBe(
      true,
    );
    expect(hasUnresolvedPlaceholders("{{name}")).toBe(true);
  });
});

describe("findTemplateIssues", () => {
  it("returns nothing for valid templates", () => {
    expect(findTemplateIssues("Hi {{name}}, about {{company}}")).toEqual([]);
    expect(findTemplateIssues("{{ NAME }} — {{industry}}")).toEqual([]);
    expect(findTemplateIssues("")).toEqual([]);
  });

  it("names the offending placeholder", () => {
    expect(findTemplateIssues("Hi {{firstname}}")).toContain(
      "{{firstname}} is not a variable",
    );
  });

  it("reports each bad placeholder once", () => {
    const issues = findTemplateIssues("{{foo}} {{foo}} {{bar}}");
    expect(issues.filter((i) => i.includes("{{foo}}"))).toHaveLength(1);
    expect(issues.filter((i) => i.includes("{{bar}}"))).toHaveLength(1);
  });

  it("unwraps nesting to name every bad placeholder", () => {
    // A single scan only sees the inner {{elhekko}}; {{Amaan}} is exposed once
    // that layer is stripped. Both need reporting or the author fixes one and
    // ships the other.
    const issues = findTemplateIssues("abc{{Amaan{{elhekko}}}}{{name}}");
    expect(issues).toContain("{{elhekko}} is not a variable");
    expect(issues).toContain("{{Amaan}} is not a variable");
  });

  it("does not cry nesting over a plain misnamed variable", () => {
    const issues = findTemplateIssues("Hi {{first_name}}, about {{company}}.");
    expect(issues).toEqual(["{{first_name}} is not a variable"]);
  });

  it("reports an unclosed brace", () => {
    expect(findTemplateIssues("Hi {{name}")).toEqual([
      "braces are unbalanced, so { } characters would be sent literally",
    ]);
  });

  it("leaves single braces alone", () => {
    expect(findTemplateIssues("Cost is {1} unit, hi {{name}}")).toEqual([]);
  });
});
