import { Inject, Injectable } from "@nestjs/common";
import { ClientModality, ClientStatus } from "@prisma/client";

import { USER_DIRECTORY, UserDirectory } from "../../../common/ports";
import { normalizeEmail } from "../clients/client-parsing";
import {
  ClientStoreService,
  ClientWriteValues,
  StoredClientIdentity,
} from "../clients/client-store.service";
import { CreateLeadDto } from "./create-lead.dto";

const MODALITY_BY_INTEREST: Readonly<
  Record<CreateLeadDto["interest"], ClientModality>
> = {
  presencial: ClientModality.PRESENCIAL,
  online: ClientModality.ONLINE,
  ambos: ClientModality.HYBRID,
};

@Injectable()
export class LeadsService {
  constructor(
    private readonly store: ClientStoreService,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  /**
   * Public lead form of the trainer behind `slug`. A soft-deleted client with the
   * same e-mail comes back as a LEAD, with its history and without a subscription,
   * and keeps its stored name and phone: the form is unauthenticated, and the
   * phone is where magic links are sent. What was typed goes to the notes.
   * A live client is never changed.
   *
   * @throws {NotFoundException} When no trainer has that slug
   * @throws {ConflictException} When the e-mail belongs to a live client of the trainer
   */
  async create(slug: string, dto: CreateLeadDto): Promise<{ id: string }> {
    const trainer = await this.users.requireBySlug(slug);
    const leadState = {
      status: ClientStatus.LEAD,
      modality: MODALITY_BY_INTEREST[dto.interest],
      planId: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
    };
    const client = await this.store.resurrectOrCreate(
      trainer.id,
      normalizeEmail(dto.email),
      {
        ...leadState,
        name: dto.name,
        phone: dto.phone,
        notes: dto.message ?? null,
      },
      "This email is already registered as a lead or client.",
      (stored) => ({ ...leadState, notes: appendSubmission(stored, dto) }),
    );
    return { id: client.id };
  }
}

/**
 * Notes of a resurrected client: what was stored, then what the public form sent.
 *
 * @example
 * appendSubmission({ name: "Ana", phone: "1", notes: null }, dto)
 * // "[Formulário público 2026-10-04]\nNome informado: ...\nTelefone informado: ..."
 */
function appendSubmission(
  stored: StoredClientIdentity,
  dto: CreateLeadDto,
): NonNullable<ClientWriteValues["notes"]> {
  const lines = [
    `[Formulário público ${new Date().toISOString().slice(0, 10)}]`,
    `Nome informado: ${dto.name}`,
    `Telefone informado: ${dto.phone}`,
    ...(dto.message ? [`Mensagem: ${dto.message}`] : []),
  ];
  const submission = lines.join("\n");
  return stored.notes ? `${stored.notes}\n\n${submission}` : submission;
}
