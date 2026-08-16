import {
  Injectable,
  Logger,
  InternalServerErrorException,
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
          "Using local dev upload fallback.",
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

    // If private key is missing valid PEM header (e.g. key ID or placeholder in dev), use mock fallback
    if (!this.privateKey.includes("-----BEGIN")) {
      this.logger.warn(
        `GCP_PRIVATE_KEY is not a valid PEM key. Using local dev upload fallback for ${objectPath}.`,
      );
      return {
        uploadUrl: `mock-dev-upload://${objectPath}`,
        publicUrl,
      };
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
    } catch (error: any) {
      this.logger.warn(
        `Failed to generate GCS signed URL: ${error?.message || error}. Falling back to dev upload.`,
      );
      return {
        uploadUrl: `mock-dev-upload://${objectPath}`,
        publicUrl,
      };
    }
  }
}
