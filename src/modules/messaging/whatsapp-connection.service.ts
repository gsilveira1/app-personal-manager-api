import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { WhatsappStatus } from "@prisma/client";
import {
  USER_DIRECTORY,
  UserDirectory,
  WhatsappConnection,
} from "../../common/ports";
import { NotificationDeliveryError } from "../../common/types";
import { WhatsAppTestMessageDto } from "./dto/whatsapp-test-message.dto";
import {
  EvolutionApiError,
  EvolutionNotConfiguredError,
} from "./evolution-api.errors";
import { LiveInstanceStatus, WhatsAppService } from "./whatsapp.service";

export interface WhatsappConnectResponse {
  instanceName: string;
  qrcodeBase64: string;
  status: WhatsappStatus;
}

const NOT_CONFIGURED_MESSAGE =
  "Integração com o WhatsApp não configurada neste ambiente.";

/**
 * Instance name of a trainer who never connected: `user-<user id>`. The whole id is
 * used because the provider answers "already exists" for a name in use, which is
 * treated as success: a shortened id could pair one trainer's phone to another's instance.
 * A name already stored for the user (including the old `user-<8 hex>` form) is kept.
 */
export function defaultInstanceName(userId: string): string {
  return `user-${userId}`;
}

/** Stored status after a live check, or null when the stored one stands. */
function reconcile(
  stored: WhatsappStatus,
  live: LiveInstanceStatus,
): WhatsappStatus | null {
  if (live === "CONNECTED" && stored !== WhatsappStatus.CONNECTED) {
    return WhatsappStatus.CONNECTED;
  }
  if (live === "DISCONNECTED" && stored === WhatsappStatus.CONNECTED) {
    return WhatsappStatus.DISCONNECTED;
  }
  return null;
}

/**
 * The trainer's WhatsApp connection (endpoints 85–88). State lives on User and is
 * read and written only through the USER_DIRECTORY port.
 */
@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * Creates the instance on the provider, fetches the pairing QR code and stores PENDING.
   *
   * @throws {ServiceUnavailableException} Provider URL or key not configured
   * @throws {BadGatewayException} The provider failed or returned no QR code
   */
  async connect(userId: string): Promise<WhatsappConnectResponse> {
    const stored = await this.users.getWhatsappConnection(userId);
    const instanceName = stored.instanceName || defaultInstanceName(userId);
    let qrcodeBase64: string;
    try {
      await this.whatsapp.ensureInstance(instanceName);
      qrcodeBase64 = await this.whatsapp.fetchQrCode(instanceName);
    } catch (error) {
      throw this.toHttpError(error, `connect user ${userId}`);
    }
    const saved = await this.users.setWhatsappConnection(userId, {
      instanceName,
      status: WhatsappStatus.PENDING,
    });
    return { instanceName, qrcodeBase64, status: saved.status };
  }

  /**
   * Live status, reconciled with the stored one. When the live check fails the
   * stored status is returned and the cause is logged (graceful degradation).
   */
  async getStatus(userId: string): Promise<WhatsappConnection> {
    const stored = await this.users.getWhatsappConnection(userId);
    if (!stored.instanceName) {
      return stored;
    }
    let live: LiveInstanceStatus;
    try {
      live = await this.whatsapp.checkInstanceStatus(stored.instanceName);
    } catch (error) {
      if (!this.isProviderError(error)) throw error;
      this.logger.warn(
        `Live WhatsApp status check failed for user ${userId} (instance '${stored.instanceName}', HTTP ${this.statusOf(error)}): ${error.message}. Returning stored status ${stored.status}.`,
      );
      return stored;
    }
    const next = reconcile(stored.status, live);
    if (!next) {
      return stored;
    }
    return this.users.setWhatsappConnection(userId, { status: next });
  }

  /**
   * Logs the instance out on the provider, then stores DISCONNECTED.
   *
   * @throws {BadGatewayException} The provider refused or could not be reached; nothing is stored
   * @throws {ServiceUnavailableException} Provider URL or key not configured
   */
  async disconnect(userId: string) {
    const stored = await this.users.getWhatsappConnection(userId);
    if (stored.instanceName) {
      try {
        await this.whatsapp.disconnectInstance(stored.instanceName);
      } catch (error) {
        throw this.toHttpError(error, `disconnect user ${userId}`);
      }
    }
    const saved = await this.users.setWhatsappConnection(userId, {
      status: WhatsappStatus.DISCONNECTED,
    });
    return {
      success: true as const,
      status: saved.status,
      instanceName: saved.instanceName,
    };
  }

  /**
   * Sends a text directly: not queued, not logged in NotificationLog.
   *
   * @throws {BadRequestException} No instance, or the delivery failed (provider's message)
   * @throws {ServiceUnavailableException} Provider URL or key not configured
   */
  async sendTestMessage(userId: string, dto: WhatsAppTestMessageDto) {
    const { instanceName } = await this.users.getWhatsappConnection(userId);
    if (!instanceName) {
      throw new BadRequestException("Instância do WhatsApp não configurada.");
    }
    try {
      const { messageId } = await this.whatsapp.sendTextMessage(
        instanceName,
        dto.phone,
        dto.message,
      );
      return { success: true as const, messageId };
    } catch (error) {
      if (error instanceof EvolutionNotConfiguredError) {
        throw new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE);
      }
      if (
        error instanceof NotificationDeliveryError ||
        error instanceof EvolutionApiError
      ) {
        this.logger.error(
          `Test message of user ${userId} failed (HTTP ${error.httpStatus ?? "n/a"}): ${error.message}`,
        );
        throw new BadRequestException(
          error.message || "Falha ao enviar mensagem de teste via WhatsApp.",
        );
      }
      throw error;
    }
  }

  private isProviderError(
    error: unknown,
  ): error is EvolutionApiError | EvolutionNotConfiguredError {
    return (
      error instanceof EvolutionApiError ||
      error instanceof EvolutionNotConfiguredError
    );
  }

  private statusOf(error: EvolutionApiError | EvolutionNotConfiguredError) {
    return (error instanceof EvolutionApiError && error.httpStatus) || "n/a";
  }

  /** Maps a provider failure to 503 (not configured) or 502 (upstream failed). */
  private toHttpError(error: unknown, action: string): unknown {
    if (error instanceof EvolutionNotConfiguredError) {
      this.logger.error(`Cannot ${action}: ${error.message}`);
      return new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE);
    }
    if (error instanceof EvolutionApiError) {
      this.logger.error(
        `Cannot ${action}: upstream HTTP ${this.statusOf(error)}: ${error.message}`,
      );
      return new BadGatewayException(
        "O provedor do WhatsApp não respondeu como esperado. Tente novamente.",
      );
    }
    return error;
  }
}
