import { describe, it, expect } from "vitest";
import { substituteVariables } from "@/lib/template";
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
