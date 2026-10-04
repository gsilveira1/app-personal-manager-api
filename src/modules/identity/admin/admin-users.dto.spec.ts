import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AdminUserQueryDto, UpdateUserAdminDto } from "./admin-users.dto";

const PIPE = { whitelist: true, forbidNonWhitelisted: true };

function check<T extends object>(cls: new () => T, plain: object) {
  return validate(plainToInstance(cls, plain), PIPE);
}

describe("AdminUserQueryDto", () => {
  it("defaults to page 1 and 20 per page", () => {
    const query = plainToInstance(AdminUserQueryDto, {});
    expect(query.page).toBe(1);
    expect(query.limit).toBe(20);
  });

  it("converts query strings to numbers", async () => {
    const query = plainToInstance(AdminUserQueryDto, {
      page: "2",
      limit: "50",
    });
    expect(await validate(query, PIPE)).toHaveLength(0);
    expect(query.page).toBe(2);
    expect(query.limit).toBe(50);
  });

  it.each([{ page: "0" }, { limit: "0" }, { limit: "101" }, { page: "abc" }])(
    "rejects %p",
    async (plain) => {
      expect(await check(AdminUserQueryDto, plain)).toHaveLength(1);
    },
  );

  it("accepts an account status and rejects anything else", async () => {
    expect(await check(AdminUserQueryDto, { status: "OVERDUE" })).toHaveLength(
      0,
    );
    expect(await check(AdminUserQueryDto, { status: "DELETED" })).toHaveLength(
      1,
    );
  });
});

describe("UpdateUserAdminDto", () => {
  it("accepts a status, partial limits, both or neither", async () => {
    expect(await check(UpdateUserAdminDto, {})).toHaveLength(0);
    expect(await check(UpdateUserAdminDto, { status: "BLOCKED" })).toHaveLength(
      0,
    );
    expect(
      await check(UpdateUserAdminDto, {
        status: "ACTIVE",
        limits: { maxStudents: 10 },
      }),
    ).toHaveLength(0);
  });

  it("rejects an unknown status", async () => {
    expect(await check(UpdateUserAdminDto, { status: "GONE" })).toHaveLength(1);
  });

  it("rejects invalid or unknown limits", async () => {
    expect(
      await check(UpdateUserAdminDto, { limits: { maxStudents: -1 } }),
    ).toHaveLength(1);
    expect(
      await check(UpdateUserAdminDto, { limits: { canUploadVideos: "yes" } }),
    ).toHaveLength(1);
    expect(
      await check(UpdateUserAdminDto, { limits: { unlimited: true } }),
    ).toHaveLength(1);
  });

  it("rejects the old `features` key and anything else an admin must not edit here", async () => {
    for (const body of [
      { features: {} },
      { role: "admin" },
      { email: "a@b.c" },
    ]) {
      const errors = await check(UpdateUserAdminDto, body);
      expect(errors[0].constraints).toHaveProperty("whitelistValidation");
    }
  });
});
