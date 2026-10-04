import { Client } from "@prisma/client";

const HEADER = "Nome,Telefone,Email,Modalidade,Status,VencimentoAssinatura";

/** A leading sign followed only by phone characters is data, not a formula. */
const SIGNED_NUMBER = /^[+-][\d\s().-]*$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Quotes one CSV cell: embedded quotes are doubled and a value a spreadsheet would
 * run as a formula (names come from the public lead form) is prefixed with `'`.
 *
 * @example
 * csvCell('=HYPERLINK("x")') // "\"'=HYPERLINK(\"\"x\"\")\""
 */
export function csvCell(value: string): string {
  const isFormula = FORMULA_START.test(value) && !SIGNED_NUMBER.test(value);
  const safe = isFormula ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

type CsvClient = Pick<
  Client,
  "name" | "phone" | "email" | "modality" | "status" | "currentPeriodEnd"
>;

export function buildClientsCsv(clients: readonly CsvClient[]): string {
  const rows = clients.map((client) => {
    const expiry = client.currentPeriodEnd
      ? client.currentPeriodEnd.toISOString().split("T")[0]
      : "N/A";
    return [
      client.name,
      client.phone,
      client.email,
      client.modality,
      client.status,
      expiry,
    ]
      .map(csvCell)
      .join(",");
  });
  return `${HEADER}\n${rows.join("\n")}`;
}
