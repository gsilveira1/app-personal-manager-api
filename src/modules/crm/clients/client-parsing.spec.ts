import {
  normalizeEmail,
  parseClientModality,
  parseClientStatus,
} from "./client-parsing";

describe("client parsing", () => {
  it.each([
    ["ACTIVE", "ACTIVE"],
    ["active", "ACTIVE"],
    ["Ativo", "ACTIVE"],
    ["PAUSED", "PAUSED"],
    ["pausada", "PAUSED"],
    ["Pausado", "PAUSED"],
    ["OVERDUE", "OVERDUE"],
    ["em atraso", "OVERDUE"],
    ["EM_ATRASO", "OVERDUE"],
    ["atrasado", "OVERDUE"],
    ["inactive", "OVERDUE"],
    [" lead ", "LEAD"],
  ])("parses status %p as %s", (raw, expected) => {
    expect(parseClientStatus(raw)).toBe(expected);
  });

  it.each([["unknown"], [""], [undefined], [null], [3], ["constructor"]])(
    "does not parse %p as a status",
    (raw) => {
      expect(parseClientStatus(raw)).toBeUndefined();
    },
  );

  it.each([
    ["presencial", "PRESENCIAL"],
    ["In-Person", "PRESENCIAL"],
    ["in_person", "PRESENCIAL"],
    ["Online", "ONLINE"],
    ["hybrid", "HYBRID"],
    ["Híbrido", "HYBRID"],
    ["hibrido", "HYBRID"],
  ])("parses modality %p as %s", (raw, expected) => {
    expect(parseClientModality(raw)).toBe(expected);
  });

  it("does not parse an unknown modality", () => {
    expect(parseClientModality("remote")).toBeUndefined();
    expect(parseClientModality("toString")).toBeUndefined();
  });

  it("lower-cases and trims e-mails", () => {
    expect(normalizeEmail("  Maria@Example.COM ")).toBe("maria@example.com");
  });
});
