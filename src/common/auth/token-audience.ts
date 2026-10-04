/**
 * JWT `aud` claims. Every token signed with JWT_SECRET names the one verifier it
 * is meant for, and every verifier requires its own audience: a student-portal
 * link can never be replayed as a trainer session, nor the other way around.
 */

/** Access tokens of trainers and admins (JwtStrategy, behind JwtAuthGuard). */
export const SESSION_TOKEN_AUDIENCE = "vivi:session";

/** Student-portal magic links (workouts/portal). */
export const PORTAL_TOKEN_AUDIENCE = "vivi:portal";
