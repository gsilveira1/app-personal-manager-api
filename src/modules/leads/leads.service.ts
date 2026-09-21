import { ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientStatus, ClientModality } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CreateLeadDto } from "./create-lead.dto";

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateLeadDto) {
    const trainerId = this.configService.get<string>("TRAINER_USER_ID");

    if (!trainerId) {
      throw new Error(
        "TRAINER_USER_ID is not configured. Please set it in the .env file.",
      );
    }

    // Map website interest to ClientModality
    const modalityMap: Record<CreateLeadDto["interest"], ClientModality> = {
      presencial: ClientModality.PRESENCIAL,
      online: ClientModality.ONLINE,
      ambos: ClientModality.HYBRID,
    };

    try {
      return await this.prisma.client.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          modality: modalityMap[dto.interest] || ClientModality.PRESENCIAL,
          notes: dto.message ?? null,
          status: ClientStatus.LEAD,
          userId: trainerId,
        },
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new ConflictException(
          "This email is already registered as a lead or client.",
        );
      }
      throw error;
    }
  }
}
