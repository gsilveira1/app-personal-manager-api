import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes & first, so entities are not double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves plain text (including accents) untouched", () => {
    expect(escapeHtml("João da Conceição")).toBe("João da Conceição");
  });

  it("stringifies non-strings and maps null/undefined to an empty string", () => {
    expect(escapeHtml(2026)).toBe("2026");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
