import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { jwtModuleAsyncOptions, RolesGuard } from "../../common/auth";
import { USER_DIRECTORY } from "../../common/ports";
import { ClientDirectoryModule } from "../crm/client-directory.module";
import { MailerModule } from "../mailer/mailer.module";
import { AdminUsersController } from "./admin/admin-users.controller";
import { AdminUsersService } from "./admin/admin-users.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { SettingsController } from "./settings/settings.controller";
import { SettingsService } from "./settings/settings.service";
import { UserDirectoryService } from "./user-directory.service";
import { UserSettingsStore } from "./user-settings.store";
import { UsersController } from "./users/users.controller";
import { UsersService } from "./users/users.service";

/**
 * Auth, profile, branding, settings and admin user management. Owns User and
 * PasswordResetToken; the other modules reach them through USER_DIRECTORY.
 *
 * Relies on the global PrismaModule, GcsModule and ConfigModule.
 * Contract: docs/api-contract-v2.md, sections 4, 6.1 and 8.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync(jwtModuleAsyncOptions),
    MailerModule,
    ClientDirectoryModule,
  ],
  controllers: [
    AuthController,
    UsersController,
    SettingsController,
    AdminUsersController,
  ],
  providers: [
    JwtStrategy,
    RolesGuard,
    UserSettingsStore,
    UsersService,
    AuthService,
    SettingsService,
    AdminUsersService,
    UserDirectoryService,
    { provide: USER_DIRECTORY, useExisting: UserDirectoryService },
  ],
  exports: [USER_DIRECTORY],
})
export class IdentityModule {}
