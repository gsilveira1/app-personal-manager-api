import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { StudentPortalService } from "./student-portal.service";
import { CompleteStudentSessionDto } from "./dto/student-portal.dto";
import { RequestWithUser } from "../../types/global";

@Controller("student")
export class StudentPortalController {
  constructor(private readonly studentPortalService: StudentPortalService) {}

  private extractToken(authHeader?: string, queryToken?: string): string {
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    if (queryToken) {
      return queryToken;
    }
    throw new UnauthorizedException("Token de acesso não fornecido.");
  }

  // Public PWA endpoint for student to load their workout sheet
  @Get("workout-sheet")
  getWorkoutSheet(
    @Headers("authorization") authHeader?: string,
    @Query("token") queryToken?: string,
  ) {
    const token = this.extractToken(authHeader, queryToken);
    return this.studentPortalService.getStudentActiveWorkoutSheet(token);
  }

  // Public PWA endpoint for student to complete their workout session
  @Post("sessions")
  @HttpCode(HttpStatus.OK)
  recordSession(
    @Body() dto: CompleteStudentSessionDto,
    @Headers("authorization") authHeader?: string,
    @Query("token") queryToken?: string,
  ) {
    const token = this.extractToken(authHeader, queryToken);
    return this.studentPortalService.recordStudentSession(token, dto);
  }
}

@UseGuards(AuthGuard("jwt"))
@Controller("students/:id/magic-link")
export class StudentMagicLinkController {
  constructor(private readonly studentPortalService: StudentPortalService) {}

  @Post()
  generateMagicLink(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
  ) {
    return this.studentPortalService.generateWorkoutMagicLink(
      req.user.userId,
      clientId,
    );
  }
}
