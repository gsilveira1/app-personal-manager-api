import { IsString, Matches } from "class-validator";

/** Body of `POST /clients/:id/avatar-upload-url`. */
export class AvatarUploadDto {
  @IsString()
  @Matches(/^image\/(jpeg|png|webp|gif)$/, {
    message:
      "contentType must be one of: image/jpeg, image/png, image/webp, image/gif",
  })
  contentType!: string;
}
