import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { USER_DIRECTORY } from "../../../common/ports";
import { ClientStoreService } from "../clients/client-store.service";
import { LeadsService } from "./leads.service";

describe("LeadsService", () => {
  let service: LeadsService;
  let store: { resurrectOrCreate: jest.Mock };
  let users: { requireBySlug: jest.Mock };

  const trainerId = "trainer-uuid-1";
  const slug = "vivi-personal";
  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      name: "Carlos",
      email: "carlos@example.com",
      phone: "53999001122",
      interest: "presencial",
      ...overrides,
    }) as any;

  beforeEach(async () => {
    store = {
      resurrectOrCreate: jest.fn().mockResolvedValue({ id: "lead-1" }),
    };
    users = { requireBySlug: jest.fn().mockResolvedValue({ id: trainerId }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: ClientStoreService, useValue: store },
        { provide: USER_DIRECTORY, useValue: users },
      ],
    }).compile();
    service = moduleRef.get(LeadsService);
  });

  const values = () => store.resurrectOrCreate.mock.calls[0][2];

  it("creates a LEAD for the trainer behind the slug and returns only its id", async () => {
    const result = await service.create(slug, dto());

    expect(users.requireBySlug).toHaveBeenCalledWith(slug);
    expect(store.resurrectOrCreate).toHaveBeenCalledWith(
      trainerId,
      "carlos@example.com",
      {
        name: "Carlos",
        phone: "53999001122",
        status: "LEAD",
        modality: "PRESENCIAL",
        notes: null,
        planId: null,
        subscriptionStatus: null,
        currentPeriodEnd: null,
      },
      "This email is already registered as a lead or client.",
      expect.any(Function),
    );
    expect(result).toEqual({ id: "lead-1" });
  });

  it.each([
    ["presencial", "PRESENCIAL"],
    ["online", "ONLINE"],
    ["ambos", "HYBRID"],
  ])("maps interest %s to modality %s", async (interest, modality) => {
    await service.create(slug, dto({ interest }));

    expect(values().modality).toBe(modality);
  });

  it("stores the message as notes", async () => {
    await service.create(slug, dto({ message: "Quero começar!" }));

    expect(values().notes).toBe("Quero começar!");
  });

  it("looks the e-mail up lower-cased and trimmed", async () => {
    await service.create(slug, dto({ email: " Carlos@Example.COM " }));

    expect(store.resurrectOrCreate.mock.calls[0][1]).toBe("carlos@example.com");
  });

  it("resets the subscription of a resurrected client (LEAD, no plan, no period)", async () => {
    await service.create(slug, dto());

    expect(values()).toMatchObject({
      status: "LEAD",
      planId: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
    });
  });

  it("answers 404 for an unknown slug and writes nothing", async () => {
    users.requireBySlug.mockRejectedValue(new NotFoundException());

    await expect(service.create("nobody", dto())).rejects.toThrow(
      NotFoundException,
    );
    expect(store.resurrectOrCreate).not.toHaveBeenCalled();
  });

  it("answers 409 when the e-mail belongs to a live client", async () => {
    store.resurrectOrCreate.mockRejectedValue(new ConflictException("taken"));

    await expect(service.create(slug, dto())).rejects.toThrow(
      ConflictException,
    );
  });

  it("rethrows unexpected errors", async () => {
    store.resurrectOrCreate.mockRejectedValue(new Error("DB error"));

    await expect(service.create(slug, dto())).rejects.toThrow("DB error");
  });

  describe("resurrection through the public form (review H4)", () => {
    const stored: { name: string; phone: string; notes: string | null } = {
      name: "Maria Verdadeira",
      phone: "5553911112222",
      notes: "Aluna desde 2024.",
    };
    const resurrectionValues = async (overrides = {}, row = stored) => {
      await service.create(
        slug,
        dto({ name: "Atacante", phone: "5553900000000", ...overrides }),
      );
      const onResurrect = store.resurrectOrCreate.mock.calls[0][4];
      return onResurrect(row);
    };

    it("never overwrites the stored name or phone (magic links go to that phone)", async () => {
      const data = await resurrectionValues();

      expect(data).not.toHaveProperty("name");
      expect(data).not.toHaveProperty("phone");
    });

    it("appends the submitted name, phone and message to the notes", async () => {
      const data = await resurrectionValues({ message: "Quero voltar!" });

      expect(data.notes.startsWith("Aluna desde 2024.\n\n")).toBe(true);
      expect(data.notes).toContain("Nome informado: Atacante");
      expect(data.notes).toContain("Telefone informado: 5553900000000");
      expect(data.notes).toContain("Mensagem: Quero voltar!");
    });

    it("writes only the submission when the client had no notes", async () => {
      const data = await resurrectionValues({}, { ...stored, notes: null });

      expect(data.notes.startsWith("[Formulário público")).toBe(true);
      expect(data.notes).not.toContain("Mensagem:");
    });

    it("still resets the subscription and turns the client into a LEAD", async () => {
      expect(await resurrectionValues({ interest: "online" })).toMatchObject({
        status: "LEAD",
        modality: "ONLINE",
        planId: null,
        subscriptionStatus: null,
        currentPeriodEnd: null,
      });
    });

    it("a brand-new lead still gets the submitted name and phone", async () => {
      await service.create(slug, dto({ name: "Novo", phone: "5553900000000" }));

      expect(values()).toMatchObject({ name: "Novo", phone: "5553900000000" });
    });
  });
});
