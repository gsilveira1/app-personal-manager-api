const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes a value for interpolation into HTML text or a quoted attribute.
 *
 * @example
 * escapeHtml('<b>"Ana"</b>') // "&lt;b&gt;&quot;Ana&quot;&lt;/b&gt;"
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}
