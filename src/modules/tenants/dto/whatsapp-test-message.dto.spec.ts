import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { WhatsAppTestMessageDto } from "./whatsapp-test-message.dto";

describe("WhatsAppTestMessageDto", () => {
  it("should validate valid phone and message", async () => {
    const dto = plainToInstance(WhatsAppTestMessageDto, {
      phone: "+5511999998888",
      message: "Test message from coach",
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should fail validation if phone is missing or invalid format", async () => {
    const dto = plainToInstance(WhatsAppTestMessageDto, {
      phone: "123",
      message: "Test message",
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should fail validation if message is empty", async () => {
    const dto = plainToInstance(WhatsAppTestMessageDto, {
      phone: "+5511999998888",
      message: "",
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
