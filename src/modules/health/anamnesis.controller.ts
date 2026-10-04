import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { AnamnesisService } from "./anamnesis.service";
import { SubmitAnamnesisDto } from "./dto/submit-anamnesis.dto";

const BEARER = /^Bearer\s+(\S+)$/i;

/** The magic token travels as `?token=` or as `Authorization: Bearer`. */
export function magicTokenOf(
  query: unknown,
  authorization: string | undefined,
): string | undefined {
  if (typeof query === "string" && query.length > 0) return query;
  return BEARER.exec(authorization ?? "")?.[1];
}

@Controller("anamnesis")
export class AnamnesisController {
  constructor(private readonly anamnesis: AnamnesisService) {}

  /** Magic token: branding and student name for the public form. */
  @Get("form")
  getFormMetadata(
    @Query("token") token: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    return this.anamnesis.getFormMetadata(magicTokenOf(token, authorization));
  }

  /** Magic token: the student submits the answers; the token is consumed. */
  @Post("submit")
  @HttpCode(HttpStatus.OK)
  submit(@Body() dto: SubmitAnamnesisDto) {
    return this.anamnesis.submit(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get("student/:id")
  listForClient(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
  ) {
    return this.anamnesis.listForClient(userId, clientId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("student/:id/magic-link")
  createMagicLink(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
  ) {
    return this.anamnesis.createMagicLink(userId, clientId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("student/:id/request-reassessment")
  requestReassessment(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
  ) {
    return this.anamnesis.requestReassessment(userId, clientId);
  }
}
