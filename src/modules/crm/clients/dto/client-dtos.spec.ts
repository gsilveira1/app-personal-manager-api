import "reflect-metadata";
import { ClientModality, ClientStatus } from "@prisma/client";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { AvatarUploadDto } from "./avatar-upload.dto";
import { ClientQueryDto } from "./client-query.dto";
import { ConvertLeadDto } from "./convert-lead.dto";
import { CreateClientDto } from "./create-client.dto";
import { RecordPaymentDto } from "./record-payment.dto";
import { UpdateClientStatusDto } from "./update-client-status.dto";
import { UpdateClientDto } from "./update-client.dto";

/** Same options as the global ValidationPipe. */
const STRICT = { whitelist: true, forbidNonWhitelisted: true };

async function check<T extends object>(
  cls: ClassConstructor<T>,
  data: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, data);
  const errors = await validate(dto, STRICT);
  return { dto, errors, invalid: errors.map((error) => error.property) };
}

describe("CreateClientDto", () => {
  const validData = {
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "53999001122",
    modality: ClientModality.PRESENCIAL,
  };

  it("passes with the required fields", async () => {
    const { errors } = await check(CreateClientDto, validData);
    expect(errors).toHaveLength(0);
  });

  it("passes with every optional field", async () => {
    const { errors } = await check(CreateClientDto, {
      ...validData,
      status: ClientStatus.ACTIVE,
      goal: "Hipertrofia",
      avatar: "https://example.com/avatar.jpg",
      notes: "Aluna dedicada",
      dateOfBirth: "1995-03-15",
      checkInFrequency: "Weekly",
      planId: "550e8400-e29b-41d4-a716-446655440000",
      notificationEnabled: false,
      medicalHistory: {
        objective: ["Saúde", "Estética"],
        hasHeartDisease: false,
        smoker: false,
        drinker: false,
      },
    });
    expect(errors).toHaveLength(0);
  });

  it.each([["name"], ["email"], ["phone"]])(
    "fails when %s is missing",
    async (field) => {
      const data: Record<string, unknown> = { ...validData };
      delete data[field];
      const { invalid } = await check(CreateClientDto, data);
      expect(invalid).toContain(field);
    },
  );

  it("fails when the e-mail is invalid", async () => {
    const { invalid } = await check(CreateClientDto, {
      ...validData,
      email: "not-email",
    });
    expect(invalid).toContain("email");
  });

  it("lower-cases and trims the e-mail", async () => {
    const { dto, errors } = await check(CreateClientDto, {
      ...validData,
      email: "  Maria@Example.COM ",
    });
    expect(errors).toHaveLength(0);
    expect(dto.email).toBe("maria@example.com");
  });

  it("fails when planId is not a UUID and ignores an empty one", async () => {
    const bad = await check(CreateClientDto, {
      ...validData,
      planId: "not-a-uuid",
    });
    expect(bad.invalid).toContain("planId");

    const empty = await check(CreateClientDto, { ...validData, planId: "" });
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.planId).toBeUndefined();
  });

  it("fails when the status is not a status", async () => {
    const { invalid } = await check(CreateClientDto, {
      ...validData,
      status: "InvalidStatus",
    });
    expect(invalid).toContain("status");
  });

  it.each([
    ["LEAD", ClientStatus.LEAD],
    ["active", ClientStatus.ACTIVE],
    ["Ativo", ClientStatus.ACTIVE],
    ["pausada", ClientStatus.PAUSED],
    ["PAUSADO", ClientStatus.PAUSED],
    ["em atraso", ClientStatus.OVERDUE],
    ["EM_ATRASO", ClientStatus.OVERDUE],
    ["atrasado", ClientStatus.OVERDUE],
    ["inactive", ClientStatus.OVERDUE],
  ])("accepts the status %p as %s", async (status, expected) => {
    const { dto, errors } = await check(CreateClientDto, {
      ...validData,
      status,
    });
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe(expected);
  });

  it.each([
    ["Online", ClientModality.ONLINE],
    ["in-person", ClientModality.PRESENCIAL],
    ["Híbrido", ClientModality.HYBRID],
  ])("accepts the modality %p as %s", async (modality, expected) => {
    const { dto, errors } = await check(CreateClientDto, {
      ...validData,
      modality,
    });
    expect(errors).toHaveLength(0);
    expect(dto.modality).toBe(expected);
  });

  it("fails when the modality is not a modality", async () => {
    const { invalid } = await check(CreateClientDto, {
      ...validData,
      modality: "remote",
    });
    expect(invalid).toContain("modality");
  });

  it("accepts checkInFrequency and checkInFreq", async () => {
    const alias = await check(CreateClientDto, {
      ...validData,
      checkInFrequency: "Weekly",
    });
    expect(alias.errors).toHaveLength(0);
    expect(alias.dto.checkInFrequency).toBe("Weekly");

    const direct = await check(CreateClientDto, {
      ...validData,
      checkInFreq: "Bi-weekly",
    });
    expect(direct.errors).toHaveLength(0);
    expect(direct.dto.checkInFreq).toBe("Bi-weekly");
  });

  it("normalises dateOfBirth to ISO and rejects an invalid date", async () => {
    const ok = await check(CreateClientDto, {
      ...validData,
      dateOfBirth: "1995-03-15",
    });
    expect(ok.dto.dateOfBirth).toBe("1995-03-15T00:00:00.000Z");

    const bad = await check(CreateClientDto, {
      ...validData,
      dateOfBirth: "not-a-date",
    });
    expect(bad.invalid).toContain("dateOfBirth");
  });

  // Contract 6.2: the body aliases are gone; subscriptionStatus is not writable.
  it.each([
    ["type", "Online"],
    ["subscriptionStatus", "ACTIVE"],
  ])("rejects the removed alias %s", async (property, value) => {
    const { invalid } = await check(CreateClientDto, {
      ...validData,
      [property]: value,
    });
    expect(invalid).toContain(property);
  });

  it.each([
    ["unknownProp"],
    ["userId"],
    ["deletedAt"],
    ["currentPeriodEnd"],
    ["gatewayCustomerId"],
  ])("rejects the non-whitelisted property %s", async (property) => {
    const { invalid } = await check(CreateClientDto, {
      ...validData,
      [property]: "x",
    });
    expect(invalid).toContain(property);
  });

  it("rejects unknown keys inside medicalHistory", async () => {
    const { invalid } = await check(CreateClientDto, {
      ...validData,
      medicalHistory: { objective: [], hacked: true },
    });
    expect(invalid).toContain("medicalHistory");
  });
});

describe("UpdateClientDto", () => {
  it("passes with an empty body", async () => {
    const { errors } = await check(UpdateClientDto, {});
    expect(errors).toHaveLength(0);
  });

  // Regression: CreateClientDto had property initialisers (status = ACTIVE,
  // modality = PRESENCIAL, notificationEnabled = true) that PartialType copied, so
  // renaming a PAUSED client silently reset those three columns.
  it("carries no defaults: a PATCH of one field leaves the others undefined", async () => {
    const { dto, errors } = await check(UpdateClientDto, { name: "Novo nome" });

    expect(errors).toHaveLength(0);
    expect(dto.status).toBeUndefined();
    expect(dto.modality).toBeUndefined();
    expect(dto.notificationEnabled).toBeUndefined();
  });

  it("accepts planId null (unlink) and a UUID, rejects anything else", async () => {
    const unlink = await check(UpdateClientDto, { planId: null });
    expect(unlink.errors).toHaveLength(0);
    expect(unlink.dto.planId).toBeNull();

    const link = await check(UpdateClientDto, {
      planId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(link.errors).toHaveLength(0);

    const bad = await check(UpdateClientDto, { planId: "nope" });
    expect(bad.invalid).toContain("planId");
  });

  it("rejects the removed aliases", async () => {
    const { invalid } = await check(UpdateClientDto, {
      type: "Online",
      subscriptionStatus: "ACTIVE",
    });
    expect(invalid).toEqual(
      expect.arrayContaining(["type", "subscriptionStatus"]),
    );
  });

  it("still validates what is sent", async () => {
    const { invalid } = await check(UpdateClientDto, {
      email: "nope",
      status: "x",
    });
    expect(invalid).toEqual(expect.arrayContaining(["email", "status"]));
  });
});

describe("ClientQueryDto", () => {
  it("applies the defaults to an empty query", async () => {
    const { dto, errors } = await check(ClientQueryDto, {});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.sortBy).toBe("name");
    expect(dto.sortOrder).toBe("asc");
  });

  it("converts query strings to numbers", async () => {
    const { dto, errors } = await check(ClientQueryDto, {
      page: "3",
      limit: "500",
    });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(500);
  });

  it("accepts every sort field and order", async () => {
    const fields = [
      "name",
      "email",
      "status",
      "modality",
      "createdAt",
      "updatedAt",
      "dateOfBirth",
    ];
    for (const sortBy of fields) {
      for (const sortOrder of ["asc", "desc", "ASC", "DESC"]) {
        const { errors } = await check(ClientQueryDto, { sortBy, sortOrder });
        expect(errors).toHaveLength(0);
      }
    }
  });

  it.each([
    ["page", 0],
    ["page", "abc"],
    ["page", 1.5],
    ["limit", -5],
    ["limit", 501],
  ])("fails when %s is %p", async (property, value) => {
    const { invalid } = await check(ClientQueryDto, { [property]: value });
    expect(invalid).toContain(property);
  });
});

describe("UpdateClientStatusDto", () => {
  it.each([
    ["PAUSED", ClientStatus.PAUSED],
    ["ativo", ClientStatus.ACTIVE],
    ["Em Atraso", ClientStatus.OVERDUE],
    ["lead", ClientStatus.LEAD],
  ])("accepts %p as %s", async (status, expected) => {
    const { dto, errors } = await check(UpdateClientStatusDto, { status });
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe(expected);
  });

  // Regression: the old service mapped any unknown value to ACTIVE.
  it.each([["whatever"], [undefined], [null], [1]])(
    "rejects %p",
    async (status) => {
      const { invalid } = await check(UpdateClientStatusDto, { status });
      expect(invalid).toContain("status");
    },
  );
});

describe("ConvertLeadDto", () => {
  it("passes with no fields", async () => {
    const { errors } = await check(ConvertLeadDto, {});
    expect(errors).toHaveLength(0);
  });

  it("passes with a UUID planId", async () => {
    const { errors } = await check(ConvertLeadDto, {
      planId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(errors).toHaveLength(0);
  });

  it("fails with a planId that is not a UUID", async () => {
    const { invalid } = await check(ConvertLeadDto, { planId: "not-a-uuid" });
    expect(invalid).toContain("planId");
  });
});

describe("AvatarUploadDto", () => {
  it.each([["image/jpeg"], ["image/png"], ["image/webp"], ["image/gif"]])(
    "accepts %s",
    async (contentType) => {
      const { errors } = await check(AvatarUploadDto, { contentType });
      expect(errors).toHaveLength(0);
    },
  );

  it.each([["image/svg+xml"], ["text/html"], ["image/png/../x"], [undefined]])(
    "rejects %p",
    async (contentType) => {
      const { invalid } = await check(AvatarUploadDto, { contentType });
      expect(invalid).toContain("contentType");
    },
  );
});

describe("RecordPaymentDto", () => {
  const validData = {
    amount: 150,
    method: "PIX",
    periodEnd: "2026-11-03T00:00:00.000Z",
  };

  it("passes with the required fields and optional notes", async () => {
    expect((await check(RecordPaymentDto, validData)).errors).toHaveLength(0);
    expect(
      (await check(RecordPaymentDto, { ...validData, notes: "ok" })).errors,
    ).toHaveLength(0);
  });

  it.each([["PIX"], ["CASH"], ["CARD"]])(
    "accepts method %s",
    async (method) => {
      const { errors } = await check(RecordPaymentDto, {
        ...validData,
        method,
      });
      expect(errors).toHaveLength(0);
    },
  );

  // Contract A5: amount is required (it was optional on manual payments).
  it.each([
    ["amount", undefined],
    ["amount", -1],
    ["amount", "150"],
    ["amount", Number.NaN],
    ["method", "MANUAL_PIX"],
    ["method", undefined],
    ["periodEnd", "soon"],
    ["periodEnd", undefined],
  ])("fails when %s is %p", async (property, value) => {
    const { invalid } = await check(RecordPaymentDto, {
      ...validData,
      [property]: value,
    });
    expect(invalid).toContain(property);
  });

  it.each([["paymentType"], ["validUntil"], ["status"], ["provider"]])(
    "rejects the old or forged property %s",
    async (property) => {
      const { invalid } = await check(RecordPaymentDto, {
        ...validData,
        [property]: "x",
      });
      expect(invalid).toContain(property);
    },
  );
});

describe("string bounds (review M2)", () => {
  const client = {
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "53999001122",
  };
  const payment = { amount: 100, method: "PIX", periodEnd: "2026-11-01" };

  it.each([
    ["name", "a".repeat(201)],
    ["phone", "5".repeat(33)],
    ["goal", "a".repeat(2001)],
    ["notes", "a".repeat(5001)],
    ["checkInFreq", "a".repeat(51)],
    ["checkInFrequency", "a".repeat(51)],
    ["email", `${"a".repeat(250)}@example.com`],
  ])("CreateClientDto rejects an over-long %s", async (property, value) => {
    const { invalid } = await check(CreateClientDto, {
      ...client,
      [property]: value,
    });
    expect(invalid).toContain(property);
  });

  it.each([
    ["injuries", "a".repeat(5001)],
    ["surgeries", "a".repeat(5001)],
    ["medications", "a".repeat(5001)],
    ["observations", "a".repeat(5001)],
    ["objective", Array.from({ length: 21 }, () => "Saúde")],
    ["objective", ["a".repeat(101)]],
  ])(
    "CreateClientDto rejects an over-long medicalHistory.%s",
    async (property, value) => {
      const { invalid } = await check(CreateClientDto, {
        ...client,
        medicalHistory: { [property]: value },
      });
      expect(invalid).toContain("medicalHistory");
    },
  );

  it("CreateClientDto still accepts generous real values", async () => {
    const { errors } = await check(CreateClientDto, {
      ...client,
      name: "a".repeat(200),
      goal: "a".repeat(2000),
      notes: "a".repeat(5000),
      medicalHistory: {
        objective: Array.from({ length: 20 }, () => "Saúde"),
        observations: "a".repeat(5000),
      },
    });
    expect(errors).toHaveLength(0);
  });

  it("UpdateClientDto inherits the bounds", async () => {
    const { invalid } = await check(UpdateClientDto, {
      name: "a".repeat(201),
    });
    expect(invalid).toContain("name");
  });

  it.each([
    ["search", "a".repeat(201)],
    ["modality", "a".repeat(51)],
    ["status", "a".repeat(51)],
    ["sortBy", "a".repeat(51)],
    ["sortOrder", "a".repeat(51)],
  ])("ClientQueryDto rejects an over-long %s", async (property, value) => {
    const { invalid } = await check(ClientQueryDto, { [property]: value });
    expect(invalid).toContain(property);
  });

  it("RecordPaymentDto rejects notes longer than 2000 characters", async () => {
    const { invalid } = await check(RecordPaymentDto, {
      ...payment,
      notes: "a".repeat(2001),
    });
    expect(invalid).toContain("notes");
  });
});
