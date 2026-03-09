import { IsString, Matches } from 'class-validator';

export class AvatarUploadDto {
  @IsString()
  @Matches(/^image\/(jpeg|png|webp|gif)$/, {
    message: 'contentType must be one of: image/jpeg, image/png, image/webp, image/gif',
  })
  contentType!: string;
}
