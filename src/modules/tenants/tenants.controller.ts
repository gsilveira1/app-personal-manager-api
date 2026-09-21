import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { TenantsService } from "./tenants.service";
import { UpdateBrandingDto } from "./dto/branding.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller(["tenants", "tenant"])
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get("me")
  async getMyTenant(@Request() req: RequestWithUser) {
    return this.tenantsService.getOrCreateTenantForUser(req.user.userId);
  }

  @Patch("branding")
  async updateBranding(
    @Request() req: RequestWithUser,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.tenantsService.updateBranding(req.user.userId, dto);
  }

  @Post("setup/connect-whatsapp")
  @HttpCode(HttpStatus.OK)
  async connectWhatsappSetup(@Request() req: RequestWithUser) {
    return this.tenantsService.connectWhatsapp(req.user.userId);
  }

  @Post("whatsapp/connect")
  @HttpCode(HttpStatus.OK)
  async connectWhatsapp(@Request() req: RequestWithUser) {
    return this.tenantsService.connectWhatsapp(req.user.userId);
  }

  @Get("whatsapp/status")
  async getWhatsappStatus(@Request() req: RequestWithUser) {
    return this.tenantsService.getWhatsappStatus(req.user.userId);
  }

  @Post("setup/complete")
  @HttpCode(HttpStatus.OK)
  async completeSetup(@Request() req: RequestWithUser) {
    return this.tenantsService.completeSetup(req.user.userId);
  }
}
