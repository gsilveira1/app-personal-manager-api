import { NotFoundException } from "@nestjs/common";
import {
  isPrismaError,
  uniqueViolationFields,
  userNotFound,
  violatesUnique,
} from "./errors";
import { prismaError } from "./testing";

describe("identity errors", () => {
  it("recognises a Prisma error by code", () => {
    expect(isPrismaError(prismaError("P2002"), "P2002")).toBe(true);
    expect(isPrismaError(prismaError("P2025"), "P2002")).toBe(false);
    expect(isPrismaError(new Error("P2002"), "P2002")).toBe(false);
  });

  it("reads the violated columns from meta.target (query engine)", () => {
    const error = prismaError("P2002", { target: ["email"] });
    expect(uniqueViolationFields(error)).toEqual(["email"]);
    expect(violatesUnique(error, "email")).toBe(true);
    expect(violatesUnique(error, "slug")).toBe(false);
  });

  it("reads the violated columns from the driver adapter error (adapter-pg)", () => {
    const error = prismaError("P2002", {
      modelName: "User",
      driverAdapterError: { cause: { constraint: { fields: ["slug"] } } },
    });
    expect(violatesUnique(error, "slug")).toBe(true);
  });

  it("matches a constraint name such as User_slug_key", () => {
    const error = prismaError("P2002", { target: "User_slug_key" });
    expect(violatesUnique(error, "slug")).toBe(true);
  });

  it("returns no fields when Prisma does not say which column", () => {
    expect(uniqueViolationFields(prismaError("P2002"))).toEqual([]);
  });

  it("builds the 404 for a missing account", () => {
    const error = userNotFound("abc");
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toContain("abc");
  });
});
