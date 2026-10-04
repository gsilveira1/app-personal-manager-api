import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import { UserAvatarUploadDto } from "./dto/avatar-upload.dto";
import { UpdateBrandingDto } from "./dto/branding.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UsersService } from "./users.service";

/** The authenticated trainer's own account (GET /users/me lives in AuthController). */
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch("profile")
  updateProfile(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Post("avatar-upload-url")
  generateAvatarUploadUrl(
    @CurrentUserId() userId: string,
    @Body() dto: UserAvatarUploadDto,
  ) {
    return this.usersService.generateAvatarUploadUrl(userId, dto.contentType);
  }

  @Patch("branding")
  updateBranding(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.usersService.updateBranding(userId, dto);
  }

  @Post("setup/complete")
  @HttpCode(HttpStatus.OK)
  completeSetup(@CurrentUserId() userId: string) {
    return this.usersService.completeSetup(userId);
  }
}
