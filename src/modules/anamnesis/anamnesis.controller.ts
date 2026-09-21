import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AnamnesisService } from "./anamnesis.service";
import { SubmitAnamnesisDto } from "./dto/anamnesis-submit.dto";
import { RequestWithUser } from "../../types/global";

@Controller("anamnesis")
export class AnamnesisController {
  constructor(private readonly anamnesisService: AnamnesisService) {}

  // Public endpoint for student to load branding and student info
  @Get("form")
  getFormMetadata(@Query("token") token: string) {
    return this.anamnesisService.getFormMetadata(token);
  }

  // Public endpoint for student to submit anamnesis
  @Post("submit")
  @HttpCode(HttpStatus.OK)
  submitAnamnesis(@Body() dto: SubmitAnamnesisDto) {
    return this.anamnesisService.submitAnamnesis(dto);
  }

  // Protected endpoint for trainer to get student anamnesis history
  @UseGuards(AuthGuard("jwt"))
  @Get("student/:id")
  getStudentAnamneses(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
  ) {
    return this.anamnesisService.getStudentAnamneses(req.user.userId, clientId);
  }

  // Protected endpoint for trainer to generate magic link
  @UseGuards(AuthGuard("jwt"))
  @Post("student/:id/magic-link")
  generateMagicLink(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
  ) {
    return this.anamnesisService.generateMagicLinkToken(
      req.user.userId,
      clientId,
    );
  }

  // Protected endpoint to request reassessment
  @UseGuards(AuthGuard("jwt"))
  @Post("student/:id/request-reassessment")
  requestReassessment(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
  ) {
    return this.anamnesisService.requestReassessment(req.user.userId, clientId);
  }
}
