import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class GcsService {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly logger = new Logger(GcsService.name);

  constructor(private readonly config: ConfigService) {
    const projectId = this.config.getOrThrow<string>('GCP_PROJECT_ID');
    const clientEmail = this.config.getOrThrow<string>('GCP_CLIENT_EMAIL');
    const privateKey = this.config
      .getOrThrow<string>('GCP_PRIVATE_KEY')
      .replace(/\\n/g, '\n');
    this.bucketName = this.config.getOrThrow<string>('GCS_BUCKET_NAME');

    this.storage = new Storage({
      projectId,
      credentials: { client_email: clientEmail, private_key: privateKey },
    });
  }

  async generateSignedUploadUrl(
    objectPath: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(objectPath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
      extensionHeaders: {
        'x-goog-content-length-range': '0,5242880', // 5MB max
      },
    });

    const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${objectPath}`;

    this.logger.log(`Generated signed upload URL for ${objectPath}`);

    return { uploadUrl, publicUrl };
  }
}
