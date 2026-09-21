import { validate } from "class-validator";
import { ResetPasswordDto } from "./reset-password.dto";

describe("ResetPasswordDto", () => {
  it("should validate valid token and password (>= 8 chars)", async () => {
    const dto = new ResetPasswordDto();
    dto.token = "valid-reset-token-123";
    dto.password = "MySecurePassword2026!";

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should fail when token is missing or empty", async () => {
    const dto = new ResetPasswordDto();
    dto.token = "";
    dto.password = "MySecurePassword2026!";

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should fail when password is shorter than 8 characters", async () => {
    const dto = new ResetPasswordDto();
    dto.token = "valid-token";
    dto.password = "1234567";

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty("minLength");
  });
});
