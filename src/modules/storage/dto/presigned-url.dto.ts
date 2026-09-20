import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const ALLOWED_STORAGE_MIME_TYPES = [
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/jpeg',
] as const;

export type AllowedStorageMimeType = (typeof ALLOWED_STORAGE_MIME_TYPES)[number];

export class PresignedUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsIn(ALLOWED_STORAGE_MIME_TYPES, {
    message: `mimeType must be one of: ${ALLOWED_STORAGE_MIME_TYPES.join(', ')}`,
  })
  mimeType!: AllowedStorageMimeType;

  @IsString()
  @IsOptional()
  folder?: string = 'logos';
}
