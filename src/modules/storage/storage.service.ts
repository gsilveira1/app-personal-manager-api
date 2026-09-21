import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { PresignedUrlDto } from "./dto/presigned-url.dto";

export interface PresignedUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>("R2_ACCOUNT_ID");
    const accessKeyId = this.configService.get<string>("R2_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>(
      "R2_SECRET_ACCESS_KEY",
    );
    this.bucketName =
      this.configService.get<string>("R2_BUCKET_NAME") || "viviops-assets";
    this.publicBaseUrl =
      this.configService.get<string>("R2_PUBLIC_URL") ||
      "https://pub-r2.viviops.com";

    if (accountId && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log("Cloudflare R2 Storage initialized.");
    } else {
      this.logger.warn(
        "Cloudflare R2 credentials not fully configured. Using development mock presigned URLs.",
      );
    }
  }

  async generatePresignedUrl(
    dto: PresignedUrlDto,
    tenantId?: string,
  ): Promise<PresignedUrlResponse> {
    const folder = dto.folder || "logos";
    const extension = dto.fileName.includes(".")
      ? dto.fileName.substring(dto.fileName.lastIndexOf("."))
      : this.getExtensionFromMime(dto.mimeType);

    const prefix = tenantId ? `${tenantId}/` : "";
    const key = `${folder}/${prefix}${uuidv4()}${extension}`;

    if (this.s3Client) {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: dto.mimeType,
      });

      // Presigned URL valid for 15 minutes (900 seconds)
      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 900,
      });
      const publicUrl = `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;

      return { uploadUrl, publicUrl, key };
    }

    // Fallback for local development and test environments
    const mockUploadUrl = `http://localhost:9090/api/storage/mock-upload/${key}`;
    const mockPublicUrl = `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;

    return {
      uploadUrl: mockUploadUrl,
      publicUrl: mockPublicUrl,
      key,
    };
  }

  private getExtensionFromMime(mime: string): string {
    switch (mime) {
      case "image/png":
        return ".png";
      case "image/svg+xml":
        return ".svg";
      case "image/webp":
        return ".webp";
      case "image/jpeg":
        return ".jpg";
      default:
        return ".bin";
    }
  }
}
