import { type Request as ExpressRequest } from "express";

/** What JwtStrategy.validate() puts on `req.user`. */
export interface AuthenticatedUser {
  userId: string;
  username: string;
  /** 'admin' | 'trainer' */
  role: string;
}

export interface RequestWithUser extends ExpressRequest {
  user: AuthenticatedUser;
}

export const ROLE_ADMIN = "admin";
export const ROLE_TRAINER = "trainer";
