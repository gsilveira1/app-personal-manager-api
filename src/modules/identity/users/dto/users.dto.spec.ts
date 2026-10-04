import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UserAvatarUploadDto } from "./avatar-upload.dto";
import { UpdateBrandingDto } from "./branding.dto";
import { SignupDto } from "./signup.dto";
import { UpdateProfileDto } from "./update-profile.dto";

/** Same options as the global ValidationPipe in main.ts. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true };

function check<T extends object>(cls: new () => T, plain: object) {
  return validate(plainToInstance(cls, plain), PIPE);
}

describe("SignupDto", () => {
  const valid = { name: "João", email: "joao@test.com", password: "senha123" };

  it("passes with the required fields", async () => {
    expect(await check(SignupDto, valid)).toHaveLength(0);
  });

  it("rejects a role property (it used to let anyone register as admin)", async () => {
    const errors = await check(SignupDto, { ...valid, role: "admin" });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("role");
    expect(errors[0].constraints).toHaveProperty("whitelistValidation");
  });

  it("fails when name is missing", async () => {
    const errors = await check(SignupDto, { ...valid, name: undefined });
    expect(errors.some((e) => e.property === "name")).toBe(true);
  });

  it("fails when email is invalid", async () => {
    const errors = await check(SignupDto, { ...valid, email: "not-an-email" });
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("fails when email is missing", async () => {
    const errors = await check(SignupDto, { ...valid, email: undefined });
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("fails when password is too short (< 6 chars)", async () => {
    const errors = await check(SignupDto, { ...valid, password: "12345" });
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("fails when password is missing", async () => {
    const errors = await check(SignupDto, { ...valid, password: undefined });
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("passes with exactly 6 character password", async () => {
    expect(
      await check(SignupDto, { ...valid, password: "123456" }),
    ).toHaveLength(0);
  });
});

describe("UpdateProfileDto", () => {
  it("allows every field to be omitted", async () => {
    expect(await check(UpdateProfileDto, {})).toHaveLength(0);
  });

  it("accepts name, email, password, avatar, phone, bio and slug", async () => {
    const errors = await check(UpdateProfileDto, {
      name: "João",
      email: "joao@test.com",
      password: "senha123",
      avatar: "https://cdn/a.png",
      phone: "53999990000",
      bio: "Personal",
      slug: "joao-personal-2",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a role property", async () => {
    const errors = await check(UpdateProfileDto, { role: "admin" });
    expect(errors[0].constraints).toHaveProperty("whitelistValidation");
  });

  it("rejects a status property", async () => {
    const errors = await check(UpdateProfileDto, { status: "ACTIVE" });
    expect(errors[0].constraints).toHaveProperty("whitelistValidation");
  });

  it("rejects a password shorter than 6 characters", async () => {
    const errors = await check(UpdateProfileDto, { password: "12345" });
    expect(errors[0].property).toBe("password");
  });

  it.each([
    "ab", // too short
    "a".repeat(41), // too long
    "Joao", // upper case
    "joão", // accent
    "joao_silva", // underscore
    "-joao", // leading dash
    "joao-", // trailing dash
    "joao--silva", // double dash
    "joao silva", // space
    "joao/admin", // path separator
  ])("rejects the slug %p", async (slug) => {
    const errors = await check(UpdateProfileDto, { slug });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("slug");
  });

  it.each(["abc", "joao-silva", "studio-42", "a".repeat(40)])(
    "accepts the slug %p",
    async (slug) => {
      expect(await check(UpdateProfileDto, { slug })).toHaveLength(0);
    },
  );
});

describe("UpdateBrandingDto", () => {
  it("validates a valid url and a valid hex color", async () => {
    const errors = await check(UpdateBrandingDto, {
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#10B981",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a primaryColor that is not a hex color", async () => {
    const errors = await check(UpdateBrandingDto, { primaryColor: "green" });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("primaryColor");
  });

  it("rejects a logoUrl that is not a URL", async () => {
    const errors = await check(UpdateBrandingDto, { logoUrl: "not-a-url" });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("logoUrl");
  });

  it("allows optional fields to be omitted", async () => {
    expect(await check(UpdateBrandingDto, {})).toHaveLength(0);
  });
});

describe("UserAvatarUploadDto", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])(
    "accepts %s",
    async (contentType) => {
      expect(await check(UserAvatarUploadDto, { contentType })).toHaveLength(0);
    },
  );

  it.each([
    "",
    "text/html",
    "image/",
    "image/../../etc",
    "image/png/x",
    42,
    // Scriptable or unlisted image types (same whitelist as the client avatar).
    "image/svg+xml",
    "image/bmp",
    "IMAGE/PNG",
    "image/png\n",
  ])("rejects %p", async (contentType) => {
    const errors = await check(UserAvatarUploadDto, { contentType });
    expect(errors).toHaveLength(1);
  });
});
