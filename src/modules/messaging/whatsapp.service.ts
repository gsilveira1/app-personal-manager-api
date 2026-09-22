import { Injectable, Logger } from "@nestjs/common";

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  /**
   * Cleans and formats phone numbers to standard international format (digits only).
   * For standard Brazilian 10 or 11 digit numbers without DDI, automatically adds '55'.
   */
  cleanPhoneNumber(phone: string): string {
    if (!phone) return "";
    const trimmed = phone.trim();
    const hasPlusPrefix = trimmed.startsWith("+");
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return "";

    // If explicitly starts with + (international format)
    if (hasPlusPrefix) {
      return digits;
    }

    // Brazilian numbers without +: 10 digits (DDD + 8 digits) or 11 digits (DDD + 9 digits)
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }

    return digits;
  }

  /**
   * Sends a text message via Evolution API instance.
   * Endpoint: POST /message/sendText/{instanceName}
   */
  async sendTextMessage(
    instanceName: string,
    recipientPhone: string,
    text: string,
  ): Promise<SendWhatsAppResult> {
    const rawUrl = process.env.EVOLUTION_API_URL || "http://localhost:8080";
    const baseUrl = rawUrl.replace(/\/$/, "");
    const apiKey =
      process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "";

    if (!instanceName) {
      this.logger.warn("WhatsApp instance name is empty. Cannot send message.");
      return {
        success: false,
        error: "WhatsApp instance name is not configured.",
      };
    }

    const cleanNumber = this.cleanPhoneNumber(recipientPhone);
    if (!cleanNumber || cleanNumber.length < 10) {
      this.logger.warn(
        `Invalid recipient phone number '${recipientPhone}' (cleaned: '${cleanNumber}')`,
      );
      return {
        success: false,
        error: `Número de telefone inválido: ${recipientPhone}`,
      };
    }

    if (!text || !text.trim()) {
      return {
        success: false,
        error: "O conteúdo da mensagem não pode ser vazio.",
      };
    }

    const url = `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;

    try {
      this.logger.log(
        `Sending WhatsApp message to ${cleanNumber} via instance '${instanceName}'`,
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({
          number: cleanNumber,
          text: text.trim(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedMessage = errorText;
        try {
          const parsed = JSON.parse(errorText);
          if (
            parsed?.response?.message &&
            Array.isArray(parsed.response.message)
          ) {
            parsedMessage = parsed.response.message.join(", ");
          } else if (typeof parsed?.response?.message === "string") {
            parsedMessage = parsed.response.message;
          } else if (parsed?.message) {
            parsedMessage = Array.isArray(parsed.message)
              ? parsed.message.join(", ")
              : parsed.message;
          } else if (parsed?.error) {
            parsedMessage = parsed.error;
          }
        } catch {}
        const errorMessage = `Evolution API HTTP ${response.status}: ${parsedMessage}`;
        this.logger.error(
          `Failed to send WhatsApp message via ${instanceName}: ${errorMessage}`,
        );
        return {
          success: false,
          error: errorMessage,
        };
      }

      const data = (await response.json()) as any;
      const messageId =
        data?.key?.id || data?.messageId || data?.id || `msg_${Date.now()}`;

      this.logger.log(
        `WhatsApp message sent successfully to ${cleanNumber}. Message ID: ${messageId}`,
      );

      return {
        success: true,
        messageId,
      };
    } catch (err: any) {
      const errorMessage = `Network error calling Evolution API: ${err.message}`;
      this.logger.error(errorMessage, err.stack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Creates an instance on Evolution API if it does not exist.
   * Endpoint: POST /instance/create
   */
  async createInstance(instanceName: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    const rawUrl = process.env.EVOLUTION_API_URL || "http://localhost:8080";
    const baseUrl = rawUrl.replace(/\/$/, "");
    const apiKey =
      process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "";

    if (!instanceName) {
      return { success: false, error: "WhatsApp instance name is empty." };
    }

    try {
      const response = await fetch(`${baseUrl}/instance/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Evolution API HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json()) as any;
      return {
        success: true,
        data,
      };
    } catch (err: any) {
      const errorMessage = `Network error calling Evolution API create: ${err.message}`;
      this.logger.error(errorMessage, err.stack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Checks the connection state of a specific instance on Evolution API.
   */
  async checkInstanceStatus(instanceName: string): Promise<{
    status: "CONNECTED" | "DISCONNECTED" | "CONNECTING";
    error?: string;
  }> {
    const rawUrl = process.env.EVOLUTION_API_URL || "http://localhost:8080";
    const baseUrl = rawUrl.replace(/\/$/, "");
    const apiKey =
      process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "";

    if (!instanceName) {
      return { status: "DISCONNECTED", error: "Instance name is empty" };
    }

    try {
      const url = `${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          apikey: apiKey,
        },
      });

      if (!response.ok) {
        return { status: "DISCONNECTED", error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as any;
      const state = data?.instance?.state || data?.state;

      if (state === "open" || state === "connected") {
        return { status: "CONNECTED" };
      } else if (state === "connecting") {
        return { status: "CONNECTING" };
      } else {
        return { status: "DISCONNECTED" };
      }
    } catch (err: any) {
      return { status: "DISCONNECTED", error: err.message };
    }
  }

  /**
   * Disconnects / logs out an instance on Evolution API.
   * Endpoint: DELETE /instance/logout/{instanceName}
   */
  async disconnectInstance(instanceName: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const rawUrl = process.env.EVOLUTION_API_URL || "http://localhost:8080";
    const baseUrl = rawUrl.replace(/\/$/, "");
    const apiKey =
      process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "";

    if (!instanceName) {
      return { success: false, error: "WhatsApp instance name is empty." };
    }

    try {
      this.logger.log(`Disconnecting WhatsApp instance '${instanceName}'`);
      const response = await fetch(
        `${baseUrl}/instance/logout/${encodeURIComponent(instanceName)}`,
        {
          method: "DELETE",
          headers: {
            apikey: apiKey,
          },
        },
      );

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        this.logger.warn(
          `Evolution API disconnect returned HTTP ${response.status}: ${errorText}`,
        );
        return {
          success: false,
          error: `Evolution API HTTP ${response.status}: ${errorText}`,
        };
      }

      return { success: true };
    } catch (err: any) {
      const errorMessage = `Network error calling Evolution API logout: ${err.message}`;
      this.logger.error(errorMessage, err.stack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
