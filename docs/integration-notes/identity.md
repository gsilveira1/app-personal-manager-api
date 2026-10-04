# Integration notes — identity stream

Module: `src/modules/identity/` (`IdentityModule`). Endpoints 1–21 of `docs/api-contract-v2.md` (section 6.1).
Deleted: `src/modules/auth/`, `users/`, `tenants/`, `admin/`, `settings/` and `src/types/global.ts`.

## 1. `src/modules/app.module.ts`

- Import `IdentityModule` from `./identity/identity.module`.
- Remove the imports of `AuthModule`, `UsersModule`, `TenantsModule`, `AdminModule` and `SettingsModule` (their files no longer exist).
- `ConfigModule` must be global (`isGlobal: true`) or imported before identity: `JwtStrategy` injects `ConfigService`.

`IdentityModule` imports `PassportModule`, `JwtModule.registerAsync(jwtModuleAsyncOptions)`, `MailerModule` and `ClientDirectoryModule`, and needs at runtime:

| Dependency | Must come from | Used for |
|---|---|---|
| `PrismaService` | global `PrismaModule` | `User`, `PasswordResetToken` |
| `GcsService` | global `GcsModule` | avatar upload URL |
| `MailerService` | `MailerModule` (imported by identity) | password-reset e-mail |
| `CLIENT_DIRECTORY` | `ClientDirectoryModule` (imported by identity) | `countByOwners` in the admin list and admin update |
| `ConfigService` | `ConfigModule` | JWT secret |

It exports only `USER_DIRECTORY` (`useExisting: UserDirectoryService`). `UsersService`, `AuthService`, `SettingsService` and `JwtModule` are not exported: a module that signs its own tokens registers `JwtModule.registerAsync(jwtModuleAsyncOptions)` itself. `JwtAuthGuard` works in every module once `IdentityModule` is loaded, because the passport `jwt` strategy is registered globally by `JwtStrategy`.

## 2. References to the deleted paths in other streams' files

Still present when this stream finished; all of them are in old directories that the crm and calendar streams delete, so they should disappear on their own. If any survives, the replacement is in `src/common/auth`:

- `src/types/global` (`RequestWithUser`): `src/modules/plans/plans.controller.ts`, `sessions/sessions.controller.ts`, `clients/students.controller.ts`, `clients/clients.controller.ts`, `availability-blocks/availability-blocks.controller.ts`.
- `../auth/roles.guard`, `../auth/roles.decorator`: `src/modules/system-features/system-features.controller.ts`.
- `../settings/settings.module`, `../settings/settings.service`: `src/modules/sessions/sessions.module.ts`, `sessions.service.ts`, `sessions.service.spec.ts`. Work hours are now read with `UserDirectory.getSettings(userId).workHours`; `SettingsService` is not exported.

## 3. Environment variables (`.env.example`)

- `JWT_SECRET` — required in production: `resolveJwtSecret` throws at start-up when `NODE_ENV=production` and it is missing (contract A23).
- `FRONTEND_URL` (then `APP_CLIENT_URL`) — base of the password-reset link built by `MailerService`.
- `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_FROM` — unchanged, used by `MailerService`.
- `GCP_PROJECT_ID`, `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, `GCS_BUCKET_NAME` — unchanged, used by `GcsService`.
- `TRAINER_USER_ID` is not read by identity.

## 4. Seed (`prisma/seed.ts`)

The current seed still writes `Tenant` / `TenantStatus` / `tenantId` and no longer compiles. For `User`:

- `slug` is required and unique, 3–40 chars, matching `^[a-z0-9]+(-[a-z0-9]+)*$` (e.g. `vivi-personal`). The website and the public routes need a known slug for the demo trainer.
- `email` lower-cased and trimmed; `password` hashed with bcrypt (10 rounds).
- `role`: `"admin"` or `"trainer"`. Sign-up can only create trainers, so **the seed is the only way to get an admin account**; at least one is needed to use `/admin/users`.
- `status`: one `ACTIVE`, one `OVERDUE` and one `BLOCKED` trainer reproduce the four old tenants.
- `settings`: write it with `mergeUserSettings({}, { aiInstructions, language, workHours, dnd, limits })` + `toJsonValue`, never a hand-built object: a malformed document makes every read of that user answer `500`. `{}` is valid (defaults apply).
- `whatsappInstanceName` is unique; use `user-<id[0..8]>` or leave it null.
- `primaryColor`, `logoUrl`, `setupCompleted` live on the user now.

## 5. e2e specs (`test/`)

- `test/settings-language.e2e-spec.ts` must be rewritten: it calls `prisma.userSetting.*` (lines 56, 63, 163), which no longer exists. Assert on `User.settings.language` instead. It also reads `signupRes.body.access_token` and `.user.id`, which the new sign-up response does provide.
- No e2e spec exists for the rest of identity. Recommended against a scratch database, because a mocked Prisma cannot show them:
  1. sign-up twice with the same name → the second account gets a `-xxxx` slug suffix; twice with the same e-mail → `409`;
  2. `PATCH /users/profile` with a slug or e-mail owned by another account → `409` with the specific message (checks how adapter-pg reports the violated column, see 7.3);
  3. `PATCH /settings/dnd` and `PATCH /admin/users/:id` with `limits`, in parallel for the same user → both changes survive (row lock, see 7.2);
  4. two parallel `POST /auth/reset-password` with the same token → one `200`, one `400`;
  5. `DELETE /admin/users/:id` → `204` and the trainer's clients, sheets, events and logs are gone (schema cascade).

## 6. Dependencies

None to install. Identity uses `@nestjs/mapped-types` (`PartialType`), which `package.json` already declares, but with the version `"*"`; pinning it (`^2.1.0`, the installed one) would be safer.

## 7. Contract gaps and choices made in this stream

1. **`AuthController` has no path prefix** (`@Controller()`), because `GET /users/me` is an alias of `GET /auth/me` on the same handler, as section 8 requires. The paths are written in full on each handler.
2. **Settings writes lock the row.** `User.settings` is one JSONB column changed by read-modify-write, by the trainer (`/settings/*`) and by admins (`limits`). `UserSettingsStore.patchWithin` runs `SELECT "settings" FROM "User" WHERE "id" = $1 FOR UPDATE` inside a transaction so concurrent writes to different keys do not overwrite each other. This raw query was **not run against a database** (the dev database must not be touched); the table and column names match the baseline migration. Verify with scenario 5.3.
3. **Which column a `P2002` refers to.** With `@prisma/adapter-pg` the violated constraint is reported in `meta.driverAdapterError.cause.constraint`, not in `meta.target`. `uniqueViolationFields` reads both; when neither is present, sign-up falls back to a lookup of the e-mail and the profile update answers the generic `409` "E-mail ou endereço público (slug) já está em uso.". Unit-tested with both shapes, not against a real driver error.
4. **Slug exhaustion.** After the first attempt plus 5 suffixed retries without a free slug, sign-up logs with `Logger.error` and answers `500` (the contract names the retries, not the outcome). A name with no latin letters or digits (or shorter than 3 chars after slugifying) starts from `trainer-xxxx` or `<name>-xxxx`.
5. **A bcrypt failure during login propagates as `500`.** The old spec had "returns null when bcrypt comparison throws" but the old code never caught it either; treating it as a wrong password would be a silent failure.
6. **Password reset is claimed atomically.** The token is marked used with `updateMany({ where: { id, used: false } })` in the same transaction as the password update, so one token cannot be redeemed twice by concurrent requests (the old code checked and then wrote).
7. **`PATCH /settings/dnd` validates `timezone`** against the runtime's IANA list (`400` otherwise). The old DTO accepted any string, which would have broken `calculateDndDelayMs` later, inside the worker.
8. **`PUT /settings/work-hours` requires all seven days** and `slotDurationMinutes`; `WorkHoursDto` in `src/common` only has `@ValidateNested()` on the days, which passes when a day is missing, so `UpdateWorkHoursDto` adds `@IsDefined()` on each. Moving `@IsDefined()` into the shared DTO would be the cleaner fix.
9. **`POST /users/avatar-upload-url`** only accepts `image/*` content types (`400` otherwise). The old DTO accepted any string and used the text after `/` as the file extension of the object name.
10. **Admin endpoints.** `GET /admin/users` pages with `page` ≥ 1 and `limit` 1–100 (default 20), newest first; `status` must be an `AccountStatus`. `PATCH /admin/users/:id` merges `limits` over the current limits. `GET /admin/users/:id` returns the full `UserView`, including `settings`. An admin can block or delete any account, including another admin or itself: the contract sets no restriction and none was added — **owner decision needed** if that should be forbidden.
11. **Not changed, by contract:** a BLOCKED / OVERDUE account can still log in and use the trainer API (A17: only the student portal is blocked); password minimum 6 on sign-up and profile, 8 on reset (A22); changing the password through `PATCH /users/profile` does not ask for the current one; tokens already issued stay valid after a password reset or a logout (stateless, section 8).
12. **`enableImplicitConversion` in `main.ts`** converts body values before validation, so `{"limits": {"canUploadVideos": "false"}}` is read as `true` and a numeric `name` on sign-up becomes a string. This is global behaviour that predates this change; noted because it weakens the DTOs of every stream.
13. **`forgot-password` logs the requested e-mail address** in the error line when the flow fails (kept from the current behaviour, as the contract asks; it is personal data in the logs).
