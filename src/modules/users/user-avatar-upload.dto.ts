import { IsNotEmpty, IsString } from 'class-validator';

export class UserAvatarUploadDto {
  @IsString()
  @IsNotEmpty()
  contentType!: string;
}
