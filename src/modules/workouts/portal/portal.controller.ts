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
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import { ClientActivityService } from "./client-activity.service";
import { MagicLinkService } from "./magic-link.service";
import {
  ActivityHeatmapQueryDto,
  CompleteStudentSessionDto,
} from "./portal.dto";
import { StudentPortalService } from "./student-portal.service";

const BEARER_PREFIX = "Bearer ";

/**
 * @returns The magic token from `Authorization: Bearer` or, failing that, `?token=`
 * @throws {UnauthorizedException} When neither carries a token
 */
export function extractStudentToken(
  authHeader?: string,
  queryToken?: string,
): string {
  if (authHeader?.startsWith(BEARER_PREFIX)) {
    return authHeader.substring(BEARER_PREFIX.length);
  }
  if (queryToken) return queryToken;
  throw new UnauthorizedException("Token de acesso não fornecido.");
}

/** Student PWA endpoints: no trainer session, the magic token is the credential. */
@Controller("student")
export class StudentPortalController {
  constructor(private readonly portal: StudentPortalService) {}

  @Get("workout-sheet")
  getWorkoutSheet(
    @Headers("authorization") authHeader?: string,
    @Query("token") queryToken?: string,
  ) {
    return this.portal.getActiveSheet(
      extractStudentToken(authHeader, queryToken),
    );
  }

  @Post("sessions")
  @HttpCode(HttpStatus.OK)
  recordSession(
    @Body() dto: CompleteStudentSessionDto,
    @Headers("authorization") authHeader?: string,
    @Query("token") queryToken?: string,
  ) {
    return this.portal.recordSession(
      extractStudentToken(authHeader, queryToken),
      dto,
    );
  }
}

/** Trainer-side endpoints about one client's portal: links and activity. */
@UseGuards(JwtAuthGuard)
@Controller("clients/:id")
export class ClientPortalController {
  constructor(
    private readonly magicLinks: MagicLinkService,
    private readonly activity: ClientActivityService,
  ) {}

  @Post("magic-link")
  @HttpCode(HttpStatus.CREATED)
  generateMagicLink(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
  ) {
    return this.magicLinks.generate(userId, clientId);
  }

  @Post("magic-link/send")
  @HttpCode(HttpStatus.OK)
  sendMagicLink(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
  ) {
    return this.magicLinks.send(userId, clientId);
  }

  @Get("activity-heatmap")
  getActivityHeatmap(
    @CurrentUserId() userId: string,
    @Param("id") clientId: string,
    @Query() query: ActivityHeatmapQueryDto,
  ) {
    return this.activity.getHeatmap(userId, clientId, query.days);
  }
}
