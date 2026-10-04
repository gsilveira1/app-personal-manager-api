import { AccountStatus, User, WhatsappStatus } from "@prisma/client";
import { TrainerProfile } from "../../common/ports";
import {
  AccountLimits,
  ResolvedUserSettings,
  resolveUserSettings,
} from "../../common/types";

export const DEFAULT_PRIMARY_COLOR = "#10B981";

/** The account as its owner (or an admin) sees it. Never carries `password`. */
export interface UserView {
  id: string;
  name: string;
  email: string;
  role: string;
  status: AccountStatus;
  avatar: string | null;
  phone: string | null;
  bio: string | null;
  slug: string;
  primaryColor: string | null;
  logoUrl: string | null;
  whatsappInstanceName: string | null;
  whatsappStatus: WhatsappStatus;
  setupCompleted: boolean;
  settings: ResolvedUserSettings;
  createdAt: Date;
  updatedAt: Date;
}

/** Row of the admin user list. */
export interface AdminUserView {
  id: string;
  name: string;
  email: string;
  slug: string;
  role: string;
  status: AccountStatus;
  /** Live (not soft-deleted) clients of the trainer. */
  studentsCount: number;
  limits: AccountLimits;
  createdAt: Date;
}

export interface LoginResponse {
  /** Read by app-personal-manager-client. */
  access_token: string;
  /** Same value; read by client-v2. */
  accessToken: string;
  tokenType: "Bearer";
  /** Seconds. */
  expiresIn: number;
  user: UserView;
}

/**
 * Explicit projection of a User row: a column added to the model later is not
 * exposed until it is listed here, and `password` can never leak.
 *
 * @example
 * return toUserView(await prisma.user.findUniqueOrThrow({ where: { id } }));
 */
export function toUserView(user: User): UserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    avatar: user.avatar,
    phone: user.phone,
    bio: user.bio,
    slug: user.slug,
    primaryColor: user.primaryColor,
    logoUrl: user.logoUrl,
    whatsappInstanceName: user.whatsappInstanceName,
    whatsappStatus: user.whatsappStatus,
    setupCompleted: user.setupCompleted,
    settings: resolveUserSettings(user.settings),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * @param user - The account
 * @param studentsCount - Live clients, from ClientDirectory.countByOwners
 */
export function toAdminUserView(
  user: User,
  studentsCount: number,
): AdminUserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    slug: user.slug,
    role: user.role,
    status: user.status,
    studentsCount,
    limits: resolveUserSettings(user.settings).limits,
    createdAt: user.createdAt,
  };
}

export const TRAINER_PROFILE_SELECT = {
  id: true,
  name: true,
  phone: true,
  slug: true,
  status: true,
  primaryColor: true,
  logoUrl: true,
} as const;

type TrainerProfileRow = Pick<User, keyof typeof TRAINER_PROFILE_SELECT>;

/** What the other modules may know about a trainer (USER_DIRECTORY port). */
export function toTrainerProfile(user: TrainerProfileRow): TrainerProfile {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    slug: user.slug,
    status: user.status,
    primaryColor: user.primaryColor ?? DEFAULT_PRIMARY_COLOR,
    logoUrl: user.logoUrl,
  };
}
