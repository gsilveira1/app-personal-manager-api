import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Requires a valid access token. The passport "jwt" strategy is registered by the
 * identity module (JwtStrategy); any module can use this guard without importing it.
 *
 * @example
 * @UseGuards(JwtAuthGuard)
 * @Controller("clients")
 * export class ClientsController {}
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
