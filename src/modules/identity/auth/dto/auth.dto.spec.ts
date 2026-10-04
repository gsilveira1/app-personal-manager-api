import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ForgotPasswordDto } from "./forgot-password.dto";
import { AuthLoginDTO } from "./login.dto";
import { ResetPasswordDto } from "./reset-password.dto";

function check<T extends object>(cls: new () => T, plain: object) {
  return validate(plainToInstance(cls, plain));
}

describe("AuthLoginDTO", () => {
  it("passes with a valid email and a 6 character password", async () => {
    const errors = await check(AuthLoginDTO, {
      email: "user@test.com",
      password: "123456",
    });
    expect(errors).toHaveLength(0);
  });

  it("passes with a 128 character password (max)", async () => {
    const errors = await check(AuthLoginDTO, {
      email: "user@test.com",
      password: "a".repeat(128),
    });
    expect(errors).toHaveLength(0);
  });

  it("fails when email is invalid", async () => {
    const errors = await check(AuthLoginDTO, {
      email: "not-an-email",
      password: "123456",
    });
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("fails when email is missing", async () => {
    const errors = await check(AuthLoginDTO, { password: "123456" });
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("fails when password is too short (< 6 chars)", async () => {
    const errors = await check(AuthLoginDTO, {
      email: "user@test.com",
      password: "12345",
    });
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("fails when password is too long (> 128 chars)", async () => {
    const errors = await check(AuthLoginDTO, {
      email: "user@test.com",
      password: "a".repeat(129),
    });
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("fails when password is missing", async () => {
    const errors = await check(AuthLoginDTO, { email: "user@test.com" });
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("fails when both fields are missing", async () => {
    expect((await check(AuthLoginDTO, {})).length).toBeGreaterThanOrEqual(2);
  });
});

describe("ForgotPasswordDto", () => {
  it("validates a valid email", async () => {
    const errors = await check(ForgotPasswordDto, {
      email: "trainer@viviops.com",
    });
    expect(errors).toHaveLength(0);
  });

  it("fails when email has an invalid format", async () => {
    const errors = await check(ForgotPasswordDto, { email: "invalid-email" });
    expect(errors[0].constraints).toHaveProperty("isEmail");
  });

  it("fails when email is empty", async () => {
    const errors = await check(ForgotPasswordDto, { email: "" });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("ResetPasswordDto", () => {
  it("validates a token and a password of 8+ characters", async () => {
    const errors = await check(ResetPasswordDto, {
      token: "valid-token",
      password: "Password123!",
    });
    expect(errors).toHaveLength(0);
  });

  it("fails when token is missing or empty", async () => {
    const errors = await check(ResetPasswordDto, {
      token: "",
      password: "Password123!",
    });
    expect(errors[0].property).toBe("token");
  });

  it("fails when password is shorter than 8 characters", async () => {
    const errors = await check(ResetPasswordDto, {
      token: "valid-token",
      password: "1234567",
    });
    expect(errors[0].property).toBe("password");
    expect(errors[0].constraints).toHaveProperty("minLength");
  });
});
