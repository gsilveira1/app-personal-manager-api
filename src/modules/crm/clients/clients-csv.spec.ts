import { buildClientsCsv, csvCell } from "./clients-csv";

describe("clients CSV", () => {
  const client = {
    name: "Maria Santos",
    phone: "+55 53 99900-1122",
    email: "maria@example.com",
    modality: "ONLINE" as const,
    status: "ACTIVE" as const,
    currentPeriodEnd: new Date("2026-11-20T12:00:00.000Z"),
  };

  it("writes the header and one quoted row per client", () => {
    expect(buildClientsCsv([client])).toBe(
      "Nome,Telefone,Email,Modalidade,Status,VencimentoAssinatura\n" +
        '"Maria Santos","+55 53 99900-1122","maria@example.com","ONLINE","ACTIVE","2026-11-20"',
    );
  });

  it("writes N/A when there is no subscription period", () => {
    const csv = buildClientsCsv([{ ...client, currentPeriodEnd: null }]);

    expect(csv.endsWith('"N/A"')).toBe(true);
  });

  it("writes only the header for an empty list", () => {
    expect(buildClientsCsv([])).toBe(
      "Nome,Telefone,Email,Modalidade,Status,VencimentoAssinatura\n",
    );
  });

  // Regression: a quote in a name used to break the row into extra columns.
  it("doubles embedded quotes", () => {
    expect(csvCell('Ana "Aninha" Lima')).toBe('"Ana ""Aninha"" Lima"');
  });

  // Regression: names come from the public lead form and were exported verbatim.
  it.each([
    ['=HYPERLINK("http://evil")', `"'=HYPERLINK(""http://evil"")"`],
    ["@SUM(A1)", `"'@SUM(A1)"`],
    ["+1+cmd|' /C calc'!A0", `"'+1+cmd|' /C calc'!A0"`],
    ["-2+3", `"'-2+3"`],
    ["\t=1", `"'\t=1"`],
  ])("neutralises the formula %p", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it("keeps phone numbers with a leading plus sign untouched", () => {
    expect(csvCell("+55 (53) 99900-1122")).toBe('"+55 (53) 99900-1122"');
  });
});
