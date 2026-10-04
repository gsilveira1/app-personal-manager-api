# Integration report — schema consolidation (v2)

Branch `feature/schema-consolidation`, 2026-10-04. Nothing is committed.

## Needs the owner's attention first

**The dev database already carries a failed migration record, written before this pass started.** The container `personalops-api-dev` bind-mounts this repository and runs `prisma migrate deploy` on every restart. At 2026-10-04 02:25:59 UTC it tried to apply `20261003000000_baseline_v2` to `gym_management` on `personalops-postgres-dev`, failed, and has been crash-looping on `P3009` since. I did not stop the container, connect to that database, or try to repair it.

- What is known: `_prisma_migrations` in the dev database has a failed row for the baseline. The log does not show how far the SQL got before failing.
- Consequence: the dev API will not start until the owner decides what to do with that database (reset it and apply the baseline, or `prisma migrate resolve`). There is no data migration from the old 23-table schema.
- It also left `dist/` owned by root, which breaks `npm run build` on the host (see below).

## Gate results

| Step | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no output (was 17 errors) |
| Lint | `npm run lint` | exit 0, no findings, no files changed by `--fix` |
| Build | `npm run build` | **fails on the host**: `Error  EACCES: permission denied, rmdir '.../dist/common'` — `dist/` is owned by root (written by the dev container). Not a code problem. |
| Build (same compiler, other output dir) | `npx tsc -p tsconfig.json --outDir <scratch>/dist` | exit 0, 248 JS files; the app was booted from this output |
| Unit | `npx jest --no-cache` | `Test Suites: 94 passed, 94 total` / `Tests:       1453 passed, 1453 total` |
| crm open handles | `npx jest --no-cache src/modules/crm --detectOpenHandles` | `Test Suites: 18 passed, 18 total` / `Tests:       379 passed, 379 total`, no open handle reported |
| Migrate | `prisma migrate deploy` (empty throwaway database) | `Applying migration 20261003000000_baseline_v2` … `All migrations have been successfully applied.` |
| Drift | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | `No difference detected.` (exit 0) |
| Seed | `prisma db seed` | `[seed] done {"users":4,"clients":24,"plans":7,"payments":6,"exercises":11,"workoutSheets":6,"studentSessions":4,"events":14,"assessments":7,"notificationLogs":6}` — identical on a second run |
| Reset | `npm run db:reset` | `✅ Banco de dados zerado com sucesso!` (works unchanged) |
| e2e | `npm run test:e2e` | `Test Suites: 8 passed, 8 total` / `Tests:       46 passed, 46 total` (three consecutive runs, the last on a freshly created database) |
| Boot | `node dist/main.js` | 92 routes mapped, `Nest application successfully started`, no DI error |
| Smoke | login `admin@gym.com` / `admin123` | `HTTP 200`, role `admin`; then `200` on `/api/auth/me`, `/api/clients`, `/api/plans`, `/api/exercises`, `/api/workout-templates`, `/api/sessions`, `/api/availability-blocks`, `/api/evaluations`, `/api/messaging/logs`, `/api/messaging/pending`, `/api/whatsapp/status`, `/api/admin/users`, `/api/public/vivi-personal/plans` and `/availability`; `401` on `/api/clients` without a token; `404` for an unknown slug |

To make `npm run build` work on the host: `sudo rm -rf dist` (the dev container recreates it as root each time it builds).

## Bugs found at integration

| # | File | Cause | Fix | Test |
|---|---|---|---|---|
| 1 | `src/modules/calendar/session-exceptions.service.ts` | Two concurrent first edits (PATCH, toggle-complete or DELETE) of one series occurrence both took the "create" branch of `prisma.event.upsert`; the loser got `P2002` and the API answered `500`. Reproduced on every run with 3–6 parallel requests. | On `P2002` the write is retried once and lands on the "update" branch, so the change is merged. Logged with `Logger.warn`. Any other error propagates. | Failing first: `session-exceptions.service.spec.ts` ("should retry as an update…") and `test/calendar-series.e2e-spec.ts` (two concurrency cases) |
| 2 | `src/modules/prisma/prisma.service.ts` | The service hands its own `pg.Pool` to the driver adapter; `$disconnect()` does not end a pool it did not create, so PostgreSQL sockets stayed open after `app.close()` (3 measured). This is what kept Jest from exiting after e2e runs. | `onModuleDestroy` now also calls `pool.end()`. | Failing first: `test/shutdown.e2e-spec.ts` |
| 3 | `src/common/types/assessment-data.ts` (handed over by the health stream) | `weightKg: 0` passed validation and created a weight-0 evaluation. | `@Min(1)` on `AnamnesisAnswersDto.weightKg`. | Failing first: `assessment-data.spec.ts`; also `test/health-anamnesis.e2e-spec.ts` |

Not a bug: the "worker process has failed to exit gracefully" warning in the crm suite did not reproduce in three full unit runs or under `--detectOpenHandles`; `crm.http.spec.ts` closes its app after each test. No change made.

## What the e2e suite now proves against real PostgreSQL and Redis

- **Anamnesis token**: three concurrent submissions of one token, five rounds → exactly one `200`, the rest `401`, one evaluation row.
- **Payment vs. soft delete**: a client deleted between the ownership check and the write → `404`, no `Payment` row, client untouched. `update` with `where: { id, userId, deletedAt: null }` works on Prisma 7.
- **Lead resurrection**: same id, payments kept, e-mail matched case-insensitively; a live client's e-mail → `409`.
- **Identity**: with adapter-pg the unique violation names the column, so e-mail and slug conflicts get their specific `409` message; a second sign-up with the same name gets a `-xxxx` slug suffix; `SELECT … FOR UPDATE` keeps all four keys when the trainer and an admin write `User.settings` at once (five rounds); a reset token redeemed by two racing requests → one `200`, one `400`.
- **Calendar**: series delete cascades to its exceptions; concurrent first edits leave one exception; `409` over a session and over a block; a soft-deleted client's sessions leave the list and stop conflicting.
- **Messaging**: one SENT row per job; a duplicate key answers `DUPLICATE`; a re-delivered job sends nothing and adds no row; the workout link twice in a minute is one job; a disconnected trainer gets one FAILED row after one attempt; flush promotes only the caller's delayed jobs; cancel answers `404` for another trainer's job.

WhatsApp and e-mail are replaced by stubs in every e2e file; the Evolution variables are pinned empty.

## Answers for the client v1 stream

1. **Template linked to a session** — accepted. The segment check only requires that the sheet belongs to the trainer, so a template works for any of the trainer's clients; another trainer's template is `404`, an unknown segment `400`. No code change; covered by e2e.
2. **`PATCH /availability-blocks/:id` with `rrule: null` / `notes: null`** — accepted (`200`), both stored as null, the block materialises once. Covered by e2e.
3. **Occurrence PATCH response id** — the occurrence id (`<seriesId>_<ISO>`); the stored row's UUID is in `exceptionId`.
4. **`POST /sessions` with `rrule`** — `201` with the master as a `SessionView` (`isVirtual: false`, `rrule` set, `recurringEventId: null`).
5. **`GET /anamnesis/student/:id`** — PENDING and EXPIRED rows are included, newest first; the token is never returned.
6. **Uploads** — only `POST /users/avatar-upload-url` and `POST /clients/:id/avatar-upload-url` exist. There is no `/storage/presigned-url` and no logo or video upload route; `storageApi.ts` has no replacement and needs an owner decision.
7. **Route diff** — the 92 routes the app maps (88 + 4 aliases) match the contract's endpoint tables exactly; nothing removed is still served and nothing is missing. `GET /health` is served outside `/api`.

Items 1–5 and the upload answer are recorded in a new "Clarifications (integration)" section at the end of `docs/api-contract-v2.md`; no existing text was changed.

## Contract contradictions

None found between code and contract. One existing e2e expectation was wrong, not the code: `settings-language` expected the default language `en`; the contract says `pt-BR`.

## Not verified

- `npm run build` itself on the host (root-owned `dist/`, above) and the Docker image build.
- Anything against the dev database, Evolution API, SMTP or GCS: sending, QR pairing, signed upload URLs and the AI endpoints were not exercised. `POST /whatsapp/connect` → `503` without provider config is unit-tested only (the e2e stub replaces the class that makes that check).
- Not covered by e2e, lower in the priority list: two concurrent `POST /clients/:id/workout-sheets` (partial unique index → retry → `409`), the exercise search leak with two trainers, `DELETE /admin/users/:id` cascade, `Plan._count.clients` excluding deleted clients, BullMQ retry backoff on transient errors.
- Two concurrent `toggle-complete` calls on the same occurrence are last-writer-wins (each computes the new status from what it read). Not changed.
- `test/` is in ESLint's `ignorePatterns`, so `npm run lint` does not lint the e2e files; they are Prettier-clean.

## Observations left for the owner

- `main.ts` never calls `app.enableShutdownHooks()`, so on SIGTERM the BullMQ worker and the pool are not closed gracefully.
- `GcsService` reads `GCP_*` with `getOrThrow` in its constructor: the app does not boot without those four variables, even with placeholder values.
- The seed leaves every demo account's WhatsApp `DISCONNECTED` with no instance name (the old seed had `CONNECTED`). The demo clients carry real-looking phone numbers; a connected demo account next to a configured Evolution API would message them.
- The README's API reference still describes the old `/tenants`, `/students` and `/storage` routes; only its environment table was updated.
- `@nestjs/mapped-types` is still pinned to `"*"` (two streams suggested `^2.1.0`); not changed.
- Public availability offers slots earlier today that are already in the past (algorithm unchanged from before).

## Files

Deleted: `test/messaging-queue.e2e-spec.ts` (every route it called is gone; replaced by `test/messaging.e2e-spec.ts`) and the empty directory `src/scripts/`. `src/modules/gcs`, `mailer` and `prisma` are in use and stay; `src/types` and `src/utils` were already removed by the streams; `./storage/storage.module` never existed, only its import was removed.

Added: `src/app.setup.ts` (HTTP configuration shared by `main.ts` and e2e), `test/setup-env.ts`, `test/support/e2e-app.ts`, and the e2e files `calendar-series`, `crm-payments`, `health-anamnesis`, `identity-concurrency`, `messaging`, `shutdown`.

Changed: `src/modules/app.module.ts`, `src/main.ts`, `src/modules/prisma/prisma.service.ts`, `src/modules/calendar/session-exceptions.service.ts` (+ spec), `src/common/types/assessment-data.ts` (+ spec), `prisma/seed.ts` (rewritten), `test/jest-e2e.json`, `test/settings-language.e2e-spec.ts`, `test/payload-size.e2e-spec.ts`, `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`, `README.md` (env table), `docs/api-contract-v2.md` (appended section).

`test/setup-env.ts` makes `npm run test:e2e` refuse to start unless `DATABASE_URL` and `REDIS_URL` are passed on the command line and the database name contains `integ`, `test` or `e2e`; before, the suite ran against whatever `.env` pointed at.

```
DATABASE_URL=postgresql://integ:integ@127.0.0.1:55432/vivi_integ REDIS_URL=redis://127.0.0.1:56379 npm run test:e2e
```

## Environment variables the app needs

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | |
| `REDIS_URL` | yes | the app throws at start without it; `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` are not read by the app |
| `JWT_SECRET` | yes in production | start-up fails when `NODE_ENV=production` and it is missing |
| `GCP_PROJECT_ID`, `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, `GCS_BUCKET_NAME` | yes | read with `getOrThrow` at start |
| `FRONTEND_URL` | yes in production | magic links and reset links; falls back to `APP_CLIENT_URL`, then `http://localhost:5173` |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | no | missing → WhatsApp routes answer `503`, queued jobs end FAILED |
| `EVOLUTION_API_TIMEOUT_MS` | no | default 10000 |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_FROM` | no | defaults `localhost`, `1025`, `viviOps <noreply@viviops.com>` |
| `GEMINI_API_KEY` | no | AI endpoints |
| `PORT`, `NODE_ENV` | no | default port 9090 |

`TRAINER_USER_ID` is gone from `.env.example`, both compose files and the README.

## Throwaway infrastructure

`vivi-integ-postgres` (postgres:15, 127.0.0.1:55432) and `vivi-integ-redis` (redis:7, 127.0.0.1:56379) were created for this pass and are removed, with their volumes. Every command that touches a database or Redis ran with `DATABASE_URL` / `REDIS_URL` set explicitly to those ports; `.env` was never the source of a connection string (dotenv does not override defined variables), and only the variable names in `.env` were read. Nothing I ran connected to `personalops-postgres-dev` or `personalops-redis-dev`.
