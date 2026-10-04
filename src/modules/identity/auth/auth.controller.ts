import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import { SignupDto } from "../users/dto/signup.dto";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { AuthLoginDTO } from "./dto/login.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";

/**
 * Session endpoints. The second path of each array is the alias that
 * app-personal-manager-client-v2 calls (contract, section 8); `GET /users/me`
 * is why this controller has no path prefix.
 */
@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  login(@Body() body: AuthLoginDTO) {
    return this.authService.login(body.email, body.password);
  }

  /** Tokens are stateless: the client discards its copy; this only confirms. */
  @Post("auth/logout")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout() {
    return { message: "Logout realizado com sucesso" };
  }

  @Post(["auth/signup", "auth/register"])
  signup(@Body() body: SignupDto) {
    return this.authService.signup(body);
  }

  @Get(["auth/me", "users/me"])
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUserId() userId: string) {
    return this.usersService.findOne(userId);
  }

  @Post(["auth/forgot-password", "auth/password-reset/request"])
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post(["auth/reset-password", "auth/password-reset/confirm"])
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }
}
