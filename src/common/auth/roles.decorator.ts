import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/**
 * Restricts a handler or controller to the given roles. Must be combined with
 * JwtAuthGuard and RolesGuard, in that order.
 *
 * @example
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles(ROLE_ADMIN)
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
