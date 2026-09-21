import { validate } from "class-validator";
import { ForgotPasswordDto } from "./forgot-password.dto";

describe("ForgotPasswordDto", () => {
  it("should validate valid email successfully", async () => {
    const dto = new ForgotPasswordDto();
    dto.email = "trainer@viviops.com";

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should fail when email is invalid format", async () => {
    const dto = new ForgotPasswordDto();
    dto.email = "invalid-email";

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty("isEmail");
  });

  it("should fail when email is empty", async () => {
    const dto = new ForgotPasswordDto();
    dto.email = "";

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
