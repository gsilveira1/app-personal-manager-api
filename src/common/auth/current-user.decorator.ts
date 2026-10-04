import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedUser, RequestWithUser } from "./request-with-user";

/**
 * Injects the authenticated user's id.
 *
 * @example
 * findAll(@CurrentUserId() userId: string) {}
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<RequestWithUser>().user.userId,
);

/**
 * Injects the whole authenticated principal.
 *
 * @example
 * me(@CurrentUser() user: AuthenticatedUser) {}
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<RequestWithUser>().user,
);
