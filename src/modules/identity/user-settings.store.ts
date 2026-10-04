import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  mergeUserSettings,
  ResolvedUserSettings,
  resolveUserSettings,
  toJsonValue,
  UserSettings,
} from "../../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { userNotFound } from "./errors";

/** Builds the keys to replace from the settings currently stored (defaults applied). */
export type SettingsPatchBuilder = (
  current: ResolvedUserSettings,
) => UserSettings;

/**
 * Reads and writes the `User.settings` document.
 *
 * A write is a read-modify-write of one JSONB column, so the row is locked
 * (`SELECT ... FOR UPDATE`) for the duration: two concurrent changes to different
 * keys (e.g. a trainer saving work hours while an admin edits limits) both survive.
 */
@Injectable()
export class UserSettingsStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @returns The settings with defaults applied
   * @throws {NotFoundException} When the user does not exist
   *
   * @example
   * const { language } = await store.read(userId);
   */
  async read(userId: string): Promise<ResolvedUserSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) throw userNotFound(userId);
    return resolveUserSettings(user.settings);
  }

  /**
   * Replaces top-level keys of the document in its own transaction.
   *
   * @throws {NotFoundException} When the user does not exist
   * @throws {BadRequestException} When the resulting document is invalid
   *
   * @example
   * await store.patch(userId, () => ({ language: "en" }));
   */
  patch(
    userId: string,
    buildPatch: SettingsPatchBuilder,
  ): Promise<ResolvedUserSettings> {
    return this.prisma.$transaction((tx) =>
      this.patchWithin(tx, userId, buildPatch),
    );
  }

  /** Same as {@link patch}, inside a transaction the caller already opened. */
  async patchWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    buildPatch: SettingsPatchBuilder,
  ): Promise<ResolvedUserSettings> {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`
      SELECT "settings" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (rows.length === 0) throw userNotFound(userId);

    const stored = rows[0].settings;
    const next = mergeUserSettings(
      stored,
      buildPatch(resolveUserSettings(stored)),
    );
    await tx.user.update({
      where: { id: userId },
      data: { settings: toJsonValue(next) },
    });
    return resolveUserSettings(next);
  }
}

/** Drops `undefined` values so they do not overwrite stored ones when spread. */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
