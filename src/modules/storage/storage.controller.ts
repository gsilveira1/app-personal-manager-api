import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { StorageService } from "./storage.service";
import { PresignedUrlDto } from "./dto/presigned-url.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller("storage")
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post("presigned-url")
  @HttpCode(HttpStatus.OK)
  async getPresignedUrl(
    @Request() req: RequestWithUser,
    @Body() dto: PresignedUrlDto,
  ) {
    return this.storageService.generatePresignedUrl(dto, req.user.userId);
  }
}
