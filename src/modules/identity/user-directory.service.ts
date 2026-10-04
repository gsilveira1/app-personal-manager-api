import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import {
  TrainerProfile,
  UserDirectory,
  WhatsappConnection,
} from "../../common/ports";
import { ResolvedUserSettings } from "../../common/types";
import { PrismaService } from "../prisma/prisma.service";
import {
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_VIOLATION,
  userNotFound,
} from "./errors";
import { UserSettingsStore } from "./user-settings.store";
import { toTrainerProfile, TRAINER_PROFILE_SELECT } from "./user-view";

const WHATSAPP_SELECT = {
  whatsappInstanceName: true,
  whatsappStatus: true,
} as const;

type WhatsappRow = Pick<User, keyof typeof WHATSAPP_SELECT>;

function toConnection(row: WhatsappRow): WhatsappConnection {
  return { instanceName: row.whatsappInstanceName, status: row.whatsappStatus };
}

/** USER_DIRECTORY: the only way modules other than identity read or change User. */
@Injectable()
export class UserDirectoryService implements UserDirectory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: UserSettingsStore,
  ) {}

  async requireBySlug(slug: string): Promise<TrainerProfile> {
    const user = await this.prisma.user.findUnique({
      where: { slug },
      select: TRAINER_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException("Treinador não encontrado");
    return toTrainerProfile(user);
  }

  async getProfile(userId: string): Promise<TrainerProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: TRAINER_PROFILE_SELECT,
    });
    if (!user) throw userNotFound(userId);
    return toTrainerProfile(user);
  }

  getSettings(userId: string): Promise<ResolvedUserSettings> {
    return this.settings.read(userId);
  }

  async getWhatsappConnection(userId: string): Promise<WhatsappConnection> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: WHATSAPP_SELECT,
    });
    if (!user) throw userNotFound(userId);
    return toConnection(user);
  }

  /**
   * @throws {NotFoundException} When the user does not exist
   * @throws {ConflictException} When another account already uses that instance name
   */
  async setWhatsappConnection(
    userId: string,
    patch: Partial<WhatsappConnection>,
  ): Promise<WhatsappConnection> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(patch.instanceName !== undefined && {
            whatsappInstanceName: patch.instanceName,
          }),
          ...(patch.status !== undefined && { whatsappStatus: patch.status }),
        },
        select: WHATSAPP_SELECT,
      });
      return toConnection(user);
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) throw userNotFound(userId);
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        throw new ConflictException(
          "Esta instância do WhatsApp já está vinculada a outra conta.",
        );
      }
      throw error;
    }
  }
}
