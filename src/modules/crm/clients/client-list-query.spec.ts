import { buildClientOrderBy, buildClientWhere } from "./client-list-query";

describe("client list query", () => {
  const userId = "trainer-1";

  describe("buildClientWhere", () => {
    it("always scopes to the trainer and hides soft-deleted clients", () => {
      expect(buildClientWhere(userId, {})).toEqual({
        userId,
        deletedAt: null,
      });
    });

    it("searches name, e-mail and phone case-insensitively", () => {
      const contains = { contains: "jo", mode: "insensitive" };
      expect(buildClientWhere(userId, { search: "jo" }).OR).toEqual([
        { name: contains },
        { email: contains },
        { phone: contains },
      ]);
    });

    it.each([
      ["active", "ACTIVE"],
      ["ATIVO", "ACTIVE"],
      ["pausada", "PAUSED"],
      ["Em Atraso", "OVERDUE"],
      ["inactive", "OVERDUE"],
      ["lead", "LEAD"],
    ])("filters by status %p", (status, expected) => {
      expect(buildClientWhere(userId, { status }).status).toBe(expected);
    });

    it.each([
      ["online", "ONLINE"],
      ["PRESENCIAL", "PRESENCIAL"],
      ["Hybrid", "HYBRID"],
    ])("filters by modality %p", (modality, expected) => {
      expect(buildClientWhere(userId, { modality }).modality).toBe(expected);
    });

    it("ignores unknown status and modality values (tolerant parsing)", () => {
      const where = buildClientWhere(userId, { status: "x", modality: "y" });

      expect(where).toEqual({ userId, deletedAt: null });
    });

    it("includes LEADs unless a status filter removes them", () => {
      expect(buildClientWhere(userId, {}).status).toBeUndefined();
    });
  });

  describe("buildClientOrderBy", () => {
    it("sorts by name ascending by default, with id as tie-breaker", () => {
      expect(buildClientOrderBy({})).toEqual([{ name: "asc" }, { id: "asc" }]);
    });

    it.each([
      ["name", "asc", { name: "asc" }],
      ["name", "desc", { name: "desc" }],
      ["email", "asc", { email: "asc" }],
      ["email", "desc", { email: "desc" }],
      ["status", "asc", { status: "asc" }],
      ["status", "desc", { status: "desc" }],
      ["modality", "asc", { modality: "asc" }],
      ["modality", "DESC", { modality: "desc" }],
      ["createdAt", "asc", { createdAt: "asc" }],
      ["created_at", "desc", { createdAt: "desc" }],
      ["updatedAt", "asc", { updatedAt: "asc" }],
      ["dateOfBirth", "asc", { dateOfBirth: "asc" }],
      ["date_of_birth", "desc", { dateOfBirth: "desc" }],
    ])("sorts by %s %s", (sortBy, sortOrder, expected) => {
      expect(buildClientOrderBy({ sortBy, sortOrder })[0]).toEqual(expected);
    });

    it("falls back to name when sortBy is not a sortable column", () => {
      expect(
        buildClientOrderBy({ sortBy: "invalidColumn", sortOrder: "desc" })[0],
      ).toEqual({ name: "desc" });
      expect(buildClientOrderBy({ sortBy: "constructor" })[0]).toEqual({
        name: "asc",
      });
    });
  });
});
