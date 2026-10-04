import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateLeadDto } from "./create-lead.dto";

describe("CreateLeadDto", () => {
  const check = async (data: Record<string, unknown>) => {
    const dto = plainToInstance(CreateLeadDto, data);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return { dto, errors, invalid: errors.map((error) => error.property) };
  };

  const validData = {
    name: "Carlos Silva",
    email: "carlos@example.com",
    phone: "53999001122",
    interest: "presencial",
  };

  it("passes with the required fields", async () => {
    expect((await check(validData)).errors).toHaveLength(0);
  });

  it("passes with the optional message", async () => {
    const { errors } = await check({ ...validData, message: "Quero começar!" });
    expect(errors).toHaveLength(0);
  });

  it.each([["online"], ["ambos"]])(
    "passes with interest %s",
    async (interest) => {
      expect((await check({ ...validData, interest })).errors).toHaveLength(0);
    },
  );

  it("fails with an invalid interest", async () => {
    const { invalid } = await check({ ...validData, interest: "hibrido" });
    expect(invalid).toContain("interest");
  });

  it.each([["name"], ["phone"]])("fails when %s is empty", async (field) => {
    const { invalid } = await check({ ...validData, [field]: "" });
    expect(invalid).toContain(field);
  });

  it("fails when the e-mail is invalid", async () => {
    const { invalid } = await check({ ...validData, email: "not-email" });
    expect(invalid).toContain("email");
  });

  it("lower-cases and trims the e-mail", async () => {
    const { dto, errors } = await check({
      ...validData,
      email: " Carlos@Example.COM ",
    });
    expect(errors).toHaveLength(0);
    expect(dto.email).toBe("carlos@example.com");
  });

  it("fails when the required fields are missing", async () => {
    const { errors } = await check({});
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it.each([["status"], ["userId"], ["planId"]])(
    "rejects the forged property %s",
    async (property) => {
      const { invalid } = await check({ ...validData, [property]: "x" });
      expect(invalid).toContain(property);
    },
  );

  describe("bounds (review M2: public, unauthenticated route)", () => {
    it("rejects a 201-character name", async () => {
      const { invalid } = await check({ ...validData, name: "a".repeat(201) });
      expect(invalid).toContain("name");
    });

    it("accepts a 200-character name", async () => {
      const { errors } = await check({ ...validData, name: "a".repeat(200) });
      expect(errors).toHaveLength(0);
    });

    it("rejects a message longer than 2000 characters", async () => {
      const { invalid } = await check({
        ...validData,
        message: "a".repeat(2001),
      });
      expect(invalid).toContain("message");
    });

    it("rejects an e-mail longer than 254 characters", async () => {
      const { invalid } = await check({
        ...validData,
        email: `${"a".repeat(250)}@example.com`,
      });
      expect(invalid).toContain("email");
    });

    it.each([
      ["53999001122"],
      ["(53) 99900-1122"],
      ["+55 53 99900-1122"],
      ["+5553999001122"],
    ])("accepts the phone %s", async (phone) => {
      expect((await check({ ...validData, phone })).errors).toHaveLength(0);
    });

    it.each([
      ["abc"],
      ["123"],
      ["53999001122<script>"],
      ["5".repeat(33)],
      ["https://evil.example/53999001122"],
    ])("rejects the phone %s", async (phone) => {
      const { invalid } = await check({ ...validData, phone });
      expect(invalid).toContain("phone");
    });
  });
});
