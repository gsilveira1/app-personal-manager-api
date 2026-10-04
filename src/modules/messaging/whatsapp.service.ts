import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as QRCode from "qrcode";
import {
  InvalidRecipientError,
  WhatsAppInstanceError,
  WhatsAppNotConnectedError,
  WhatsAppTransientError,
} from "../../common/types";
import {
  EvolutionApiError,
  EvolutionNotConfiguredError,
} from "./evolution-api.errors";

export type LiveInstanceStatus = "CONNECTED" | "DISCONNECTED" | "CONNECTING";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_PHONE_DIGITS = 10;
const QR_OPTIONS = { width: 320, margin: 2 };
/** Provider statuses that mean "the instance is missing or logged out". */
const INSTANCE_ERROR_STATUSES = [400, 401, 404];

interface ProviderFailure {
  status: number;
  message: string;
  /** Evolution answers 400 with `exists: false` when the number has no WhatsApp account. */
  recipientMissing: boolean;
}

function flattenMessage(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join(", ");
  }
  return null;
}

/** Extracts the human-readable message of an Evolution API error body. */
function parseFailureBody(body: string): Omit<ProviderFailure, "status"> {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON (e.g. a proxy's HTML error page): the raw text is the message.
    return { message: body, recipientMissing: false };
  }
  const message =
    flattenMessage(parsed?.response?.message) ??
    flattenMessage(parsed?.message) ??
    flattenMessage(parsed?.error) ??
    body;
  const details = parsed?.response?.message;
  const recipientMissing =
    Array.isArray(details) && details.some((d) => d?.exists === false);
  return { message, recipientMissing };
}

/**
 * HTTP client of the Evolution API (WhatsApp provider). Stateless; knows nothing
 * about users. Every failure is thrown as a typed error — nothing returns
 * `{ success: false }`.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Digits-only international format. Brazilian 10/11-digit numbers without a
   * country code get "55" prepended.
   *
   * @example
   * cleanPhoneNumber("(11) 98765-4321") // "5511987654321"
   */
  cleanPhoneNumber(phone: string): string {
    if (!phone) return "";
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (!digits || trimmed.startsWith("+")) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }

  /**
   * Sends a text through `POST /message/sendText/{instanceName}`.
   *
   * @returns The provider's message id
   * @throws {WhatsAppNotConnectedError} Empty instance name
   * @throws {InvalidRecipientError} Malformed phone, empty text, or number without WhatsApp
   * @throws {WhatsAppTransientError} Timeout, network error, HTTP 429 or 5xx (retryable)
   * @throws {WhatsAppInstanceError} HTTP 400 / 401 / 404 (instance missing or logged out)
   * @throws {EvolutionNotConfiguredError} Provider URL or key not configured
   * @throws {EvolutionApiError} Any other provider status
   */
  async sendTextMessage(
    instanceName: string,
    recipientPhone: string,
    text: string,
  ): Promise<{ messageId: string }> {
    if (!instanceName) {
      throw new WhatsAppNotConnectedError(
        "WhatsApp instance name is not configured.",
      );
    }
    const number = this.cleanPhoneNumber(recipientPhone);
    if (number.length < MIN_PHONE_DIGITS) {
      throw new InvalidRecipientError(
        `Número de telefone inválido: ${recipientPhone}`,
      );
    }
    if (!text?.trim()) {
      throw new InvalidRecipientError(
        "O conteúdo da mensagem não pode ser vazio.",
      );
    }
    const response = await this.callForDelivery(instanceName, {
      number,
      text: text.trim(),
    });
    const data: any = await response.json();
    const messageId: string =
      data?.key?.id || data?.messageId || data?.id || `msg_${Date.now()}`;
    this.logger.log(
      `WhatsApp message ${messageId} sent via instance '${instanceName}'`,
    );
    return { messageId };
  }

  /**
   * Makes sure the instance exists (`POST /instance/create`). An "already in use"
   * answer is success.
   *
   * @throws {EvolutionNotConfiguredError} Provider URL or key not configured
   * @throws {EvolutionApiError} Network error, timeout or any other non-2xx
   */
  async ensureInstance(instanceName: string): Promise<void> {
    const response = await this.request("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });
    if (response.ok) return;
    const failure = await this.readFailure(response);
    const alreadyExists =
      [403, 409].includes(failure.status) &&
      /already (in use|exists)/i.test(failure.message);
    if (alreadyExists) {
      this.logger.log(`WhatsApp instance '${instanceName}' already exists`);
      return;
    }
    throw this.toApiError("create instance", instanceName, failure);
  }

  /**
   * Fetches the pairing QR code (`GET /instance/connect/{instanceName}`).
   *
   * @returns A `data:image/png;base64,...` URL
   * @throws {EvolutionNotConfiguredError} Provider URL or key not configured
   * @throws {EvolutionApiError} Network error, non-2xx, or a response without a QR code
   */
  async fetchQrCode(instanceName: string): Promise<string> {
    const path = `/instance/connect/${encodeURIComponent(instanceName)}`;
    const response = await this.request(path, { method: "GET" });
    if (!response.ok) {
      const failure = await this.readFailure(response);
      throw this.toApiError("fetch QR code", instanceName, failure);
    }
    const data: any = await response.json();
    if (typeof data?.base64 === "string" && data.base64) {
      return data.base64.startsWith("data:")
        ? data.base64
        : `data:image/png;base64,${data.base64}`;
    }
    if (typeof data?.code === "string" && data.code) {
      return QRCode.toDataURL(data.code, QR_OPTIONS);
    }
    throw new EvolutionApiError(
      `Evolution API returned no QR code for instance '${instanceName}'`,
      response.status,
    );
  }

  /**
   * Live connection state (`GET /instance/connectionState/{instanceName}`).
   * A 404 means the instance does not exist, which is DISCONNECTED.
   *
   * @throws {EvolutionNotConfiguredError} Provider URL or key not configured
   * @throws {EvolutionApiError} Network error, timeout or any other non-2xx
   */
  async checkInstanceStatus(instanceName: string): Promise<LiveInstanceStatus> {
    const path = `/instance/connectionState/${encodeURIComponent(instanceName)}`;
    const response = await this.request(path, { method: "GET" });
    if (response.status === 404) return "DISCONNECTED";
    if (!response.ok) {
      const failure = await this.readFailure(response);
      throw this.toApiError("check status of", instanceName, failure);
    }
    const data: any = await response.json();
    const state = data?.instance?.state || data?.state;
    if (state === "open" || state === "connected") return "CONNECTED";
    if (state === "connecting") return "CONNECTING";
    return "DISCONNECTED";
  }

  /**
   * Logs the instance out (`DELETE /instance/logout/{instanceName}`). A 404 is
   * success: there is nothing left to disconnect.
   *
   * @throws {EvolutionNotConfiguredError} Provider URL or key not configured
   * @throws {EvolutionApiError} Network error, timeout or any other non-2xx
   */
  async disconnectInstance(instanceName: string): Promise<void> {
    const path = `/instance/logout/${encodeURIComponent(instanceName)}`;
    const response = await this.request(path, { method: "DELETE" });
    if (response.ok || response.status === 404) return;
    const failure = await this.readFailure(response);
    throw this.toApiError("disconnect", instanceName, failure);
  }

  private async callForDelivery(
    instanceName: string,
    payload: { number: string; text: string },
  ): Promise<Response> {
    const path = `/message/sendText/${encodeURIComponent(instanceName)}`;
    let response: Response;
    try {
      response = await this.request(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (error instanceof EvolutionApiError) {
        throw new WhatsAppTransientError(error.message);
      }
      throw error;
    }
    if (!response.ok) {
      throw this.toDeliveryError(
        instanceName,
        await this.readFailure(response),
      );
    }
    return response;
  }

  private toDeliveryError(instanceName: string, failure: ProviderFailure) {
    const { status, message } = failure;
    this.logger.error(
      `Evolution API HTTP ${status} sending via instance '${instanceName}': ${message}`,
    );
    if (status === 429 || status >= 500) {
      return new WhatsAppTransientError(message, status);
    }
    if (status === 400 && failure.recipientMissing) {
      return new InvalidRecipientError(
        `Número sem conta no WhatsApp: ${message}`,
        status,
      );
    }
    if (INSTANCE_ERROR_STATUSES.includes(status)) {
      return new WhatsAppInstanceError(message, status);
    }
    return new EvolutionApiError(
      `Evolution API HTTP ${status}: ${message}`,
      status,
    );
  }

  private toApiError(
    action: string,
    instanceName: string,
    failure: ProviderFailure,
  ): EvolutionApiError {
    const text = `Evolution API HTTP ${failure.status}: ${failure.message}`;
    this.logger.error(
      `Failed to ${action} instance '${instanceName}': ${text}`,
    );
    return new EvolutionApiError(text, failure.status);
  }

  private async readFailure(response: Response): Promise<ProviderFailure> {
    const body = await response.text();
    return { status: response.status, ...parseFailureBody(body) };
  }

  private resolveConfig(): { baseUrl: string; apiKey: string } {
    const url = this.config.get<string>("EVOLUTION_API_URL");
    const apiKey = this.config.get<string>("EVOLUTION_API_KEY");
    if (!url || !apiKey) {
      throw new EvolutionNotConfiguredError();
    }
    return { baseUrl: url.replace(/\/$/, ""), apiKey };
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>("EVOLUTION_API_TIMEOUT_MS"));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  /** One HTTP call with the API key and a timeout. Network failures become EvolutionApiError. */
  private async request(
    path: string,
    init: { method: string; body?: string },
  ): Promise<Response> {
    const { baseUrl, apiKey } = this.resolveConfig();
    const headers: Record<string, string> = { apikey: apiKey };
    if (init.body) headers["Content-Type"] = "application/json";
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      const timedOut = ["AbortError", "TimeoutError"].includes(cause.name);
      const text = timedOut
        ? `Evolution API timed out after ${this.timeoutMs()} ms (${init.method} ${path})`
        : `Network error calling Evolution API (${init.method} ${path}): ${cause.message}`;
      this.logger.error(text, cause.stack);
      throw new EvolutionApiError(text);
    }
  }
}
