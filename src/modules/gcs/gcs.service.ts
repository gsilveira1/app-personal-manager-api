import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage } from "@google-cloud/storage";

@Injectable()
export class GcsService {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly privateKey: string;
  private readonly logger = new Logger(GcsService.name);

  constructor(private readonly config: ConfigService) {
    const projectId = this.config.getOrThrow<string>("GCP_PROJECT_ID");
    const clientEmail = this.config.getOrThrow<string>("GCP_CLIENT_EMAIL");
    const rawPrivateKey = this.config.getOrThrow<string>("GCP_PRIVATE_KEY");
    this.privateKey = this.formatPrivateKey(rawPrivateKey);
    this.bucketName = this.config.getOrThrow<string>("GCS_BUCKET_NAME");

    if (!this.privateKey.includes("-----BEGIN")) {
      this.logger.warn(
        "GCP_PRIVATE_KEY does not appear to be a valid PEM private key (missing -----BEGIN PRIVATE KEY-----). " +
          "Outside production the local dev upload fallback is used; in production upload URLs answer 503.",
      );
    }

    this.storage = new Storage({
      projectId,
      credentials: { client_email: clientEmail, private_key: this.privateKey },
    });
  }

  private formatPrivateKey(key: string): string {
    if (!key) return "";
    let sanitized = key.trim();

    // Strip wrapping quotes if present (e.g. "..." or '...')
    if (
      (sanitized.startsWith('"') && sanitized.endsWith('"')) ||
      (sanitized.startsWith("'") && sanitized.endsWith("'"))
    ) {
      sanitized = sanitized.slice(1, -1);
    }

    // Replace literal '\n' sequences with actual line breaks
    return sanitized.replace(/\\n/g, "\n");
  }

  async generateSignedUploadUrl(
    objectPath: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${objectPath}`;

    if (!this.privateKey.includes("-----BEGIN")) {
      return this.unavailable(
        objectPath,
        publicUrl,
        "GCP_PRIVATE_KEY is not a valid PEM key",
      );
    }

    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(objectPath);

      const [uploadUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType,
        extensionHeaders: {
          "x-goog-content-length-range": "0,5242880", // 5MB max
        },
      });

      this.logger.log(`Generated signed upload URL for ${objectPath}`);

      return { uploadUrl, publicUrl };
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return this.unavailable(
        objectPath,
        publicUrl,
        `GCS getSignedUrl failed: ${cause}`,
      );
    }
  }

  /**
   * Signing did not work. In production that is a 503 (a fake URL would make the
   * upload look successful); elsewhere the mock upload URL keeps local setups
   * without GCS credentials usable.
   *
   * @throws {ServiceUnavailableException} In production
   */
  private unavailable(
    objectPath: string,
    publicUrl: string,
    cause: string,
  ): { uploadUrl: string; publicUrl: string } {
    if (process.env.NODE_ENV === "production") {
      this.logger.error(
        `Cannot sign an upload URL for ${objectPath}: ${cause}`,
      );
      throw new ServiceUnavailableException(
        "File upload is temporarily unavailable",
      );
    }
    this.logger.warn(
      `${cause}. Using the local dev upload fallback for ${objectPath}.`,
    );
    return { uploadUrl: `mock-dev-upload://${objectPath}`, publicUrl };
  }
}
