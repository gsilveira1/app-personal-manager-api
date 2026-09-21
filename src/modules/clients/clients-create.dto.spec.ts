import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateClientDto } from "./clients-create.dto";
import { ClientStatus, ClientModality } from "@prisma/client";

describe("CreateClientDto", () => {
  const createDto = (data: Record<string, any>): CreateClientDto => {
    return plainToInstance(CreateClientDto, data);
  };

  const validData = {
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "53999001122",
    modality: ClientModality.PRESENCIAL,
  };

  it("should pass with valid required fields", async () => {
    const dto = createDto(validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should pass with all optional fields", async () => {
    const dto = createDto({
      ...validData,
      status: ClientStatus.ACTIVE,
      goal: "Hipertrofia",
      avatar: "https://example.com/avatar.jpg",
      notes: "Aluna dedicada",
      dateOfBirth: "1995-03-15",
      checkInFrequency: "Weekly",
      planId: "550e8400-e29b-41d4-a716-446655440000",
      medicalHistory: {
        objective: ["Saúde", "Estética"],
        hasHeartDisease: false,
        smoker: false,
        drinker: false,
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when name is missing", async () => {
    const dto = createDto({
      email: "maria@example.com",
      phone: "123",
      modality: ClientModality.PRESENCIAL,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "name")).toBe(true);
  });

  it("should fail when email is invalid", async () => {
    const dto = createDto({ ...validData, email: "not-email" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("should fail when phone is missing", async () => {
    const dto = createDto({
      name: "Maria",
      email: "maria@example.com",
      modality: ClientModality.PRESENCIAL,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "phone")).toBe(true);
  });

  it("should fail when planId is not a valid UUID", async () => {
    const dto = createDto({ ...validData, planId: "not-a-uuid" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "planId")).toBe(true);
  });

  it("should fail when status is invalid enum value", async () => {
    const dto = createDto({ ...validData, status: "InvalidStatus" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "status")).toBe(true);
  });

  it("should pass with valid status enum (LEAD)", async () => {
    const dto = createDto({ ...validData, status: ClientStatus.LEAD });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should pass and map checkInFrequency and type with whitelist/forbidNonWhitelisted", async () => {
    const dto = createDto({
      ...validData,
      type: "Online",
      checkInFrequency: "Weekly",
      subscriptionStatus: "Active",
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
    expect(dto.modality).toBe(ClientModality.ONLINE);
    expect(dto.status).toBe(ClientStatus.ACTIVE);
    expect(dto.checkInFrequency).toBe("Weekly");
  });

  it("should pass when checkInFreq is provided directly", async () => {
    const dto = createDto({
      ...validData,
      modality: ClientModality.HYBRID,
      checkInFreq: "Bi-weekly",
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
    expect(dto.checkInFreq).toBe("Bi-weekly");
  });

  it("should fail when unknown unwhitelisted property is passed with forbidNonWhitelisted", async () => {
    const dto = createDto({
      ...validData,
      unknownProp: "malicious_input",
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === "unknownProp")).toBe(true);
  });
});

