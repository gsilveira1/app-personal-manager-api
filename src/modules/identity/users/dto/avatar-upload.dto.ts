import { IsString, Matches } from "class-validator";

/**
 * Raster image types an avatar may have; the subtype becomes the file extension
 * of the stored object. SVG is excluded on purpose: it can carry script.
 *
 * Same four values as crm's client-avatar DTO (crm/clients/dto/avatar-upload.dto.ts).
 * TODO(review L4): move the list to src/common and import it from both DTOs.
 */
export const AVATAR_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const AVATAR_CONTENT_TYPE = /^image\/(jpeg|png|webp|gif)$/;

/** Body of `POST /users/avatar-upload-url`. */
export class UserAvatarUploadDto {
  @IsString()
  @Matches(AVATAR_CONTENT_TYPE, {
    message: `contentType must be one of: ${AVATAR_CONTENT_TYPES.join(", ")}`,
  })
  contentType!: string;
}
