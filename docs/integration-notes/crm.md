# Integration notes — crm stream

Contract: `docs/api-contract-v2.md`, sections 5.5, 6.2 (endpoints 22–40), 7, stream 2.

## 1. `src/modules/app.module.ts`

- Import `CrmModule` from `./crm/crm.module`.
- Remove the imports of `ClientsModule`, `LeadsModule`, `PlansModule` and `SystemFeaturesModule`: the directories `clients/`, `leads/`, `plans/` and `system-features/` are deleted, so the file does not compile until this is done.
- `ClientDirectoryModule` (`./crm/client-directory.module`) does not need to be listed in `AppModule`; every consumer imports it itself. It imports nothing and relies on the global `PrismaModule`.

`CrmModule` imports `IdentityModule`, `ClientDirectoryModule`, `WorkoutsModule` and `HealthModule`, and needs them to export `USER_DIRECTORY`, `CLIENT_DIRECTORY`, `WORKOUT_SHEET_READER` and `ANAMNESIS_REQUESTER`. It also needs, from global modules, `PrismaService` and `GcsService` (`GcsModule` must stay global or be imported by `CrmModule`). It exports `FeatureCheckService` (no caller yet, assumption A20).

Every crm controller except `PublicCrmController` uses `JwtAuthGuard`, so the passport `"jwt"` strategy (identity's `JwtStrategy`) must be registered in the application.

Controllers and providers are listed once in `src/modules/crm/crm.providers.ts`; `crm.http.spec.ts` boots that same list, so a provider added to one place cannot be forgotten in the other.

## 2. Environment (`.env.example`)

- `TRAINER_USER_ID` is no longer read by crm: the public lead form and the public plans resolve the trainer from the `:slug` path segment through `USER_DIRECTORY.requireBySlug`. Remove the variable once calendar no longer reads it either.
- No new variable.

## 3. Seed (`prisma/seed.ts`)

- `prisma.systemFeature.upsert` (five rows) and `prisma.planFeature.deleteMany` / `createMany` no longer exist. The catalogue is `PLAN_FEATURE_CATALOG` in `src/common/types/plan-features.ts`; a plan gets its features as `features: [PlanFeatureKey.AUTOMATED_PIX, ...]` (a `String[]` column).
- `Plan.type` stays the string `'PRESENCIAL' | 'CONSULTORIA'`.
- Client e-mails must be seeded lower-cased and trimmed: every crm lookup on `(email, userId)` normalises the e-mail first, so a seeded `Maria@Example.com` would never match and could be duplicated.
- `ManualPayment` rows become `Payment` rows: `provider: MANUAL`, `status: PAID`, `amount` (required), `method` (`'PIX' | 'CASH' | 'CARD'`), `periodEnd` (was `validUntil`), `notes`, `clientId`, `userId`. A client with a paid period should also carry `subscriptionStatus: ACTIVE` and `currentPeriodEnd`.
- Useful for manual testing of section 7: one soft-deleted client (`deletedAt` set, `subscriptionStatus: CANCELED`) so that resurrection through `POST /public/:slug/leads` and `POST /clients` can be tried.
- Every trainer needs a `slug`, or the public routes answer `404`.

## 4. e2e specs (`test/`)

- No existing e2e spec calls a crm route (`test/messaging-queue.e2e-spec.ts` calls `/api/students/:id/resend-link`, which belongs to workouts / health).
- Not verified here (the unit and HTTP specs mock Prisma). These need a real database and are worth an e2e scenario each:
  - `prisma.client.update({ where: { id, userId, deletedAt: null } })` — relies on Prisma accepting non-unique fields next to the unique `id` in `where`; it typechecks against the generated client but was never executed.
  - Lead resurrection end to end: create → `DELETE /clients/:id` → `POST /public/:slug/leads` with the same e-mail in another letter case → same `id`, `status` LEAD, old payments still listed by `GET /clients/:id`.
  - `409` for a live client's e-mail on both `POST /clients` and the lead form (the `P2002` raised inside the interactive transaction).
  - `Plan._count.clients` with a filtered relation count (`_count: { select: { clients: { where: { deletedAt: null } } } }`) excludes a soft-deleted client.
  - Payment transaction: a client soft-deleted between the ownership check and the write leaves no `Payment` row.
  - `GET /clients?search=...&status=ativo&sortBy=createdAt&sortOrder=desc&page=2&limit=5`.

## 5. Dependencies

None to install. `crm.http.spec.ts` uses `supertest` (already in `package.json`); the DTOs use `@nestjs/mapped-types` (already there, pinned to `"*"` — worth pinning to a real version).

## 6. Behaviour the frontends must know (beyond section 13 of the contract)

- `GET /clients` rejects unknown query parameters with `400` (global `forbidNonWhitelisted`), and `limit` above 500 or `page` below 1 is `400`, not clamped.
- `GET /clients/export/csv` downloads `clients.csv` (was `students.csv`). Cells that a spreadsheet would run as a formula (`=`, `+`, `-`, `@` first, unless it is a signed phone number) are prefixed with `'`: names come from the public lead form.
- `PATCH /clients/:id` with `planId: null` unlinks the plan; `planId: ""` is ignored.
- `POST /clients/:id/payments`: `amount` is required (assumption A5) and the old body keys (`paymentType`, `validUntil`) are `400`.

## 7. Choices made where the contract was silent

| Topic | Choice |
|---|---|
| `POST /clients` resurrecting a deleted client | Body values overwrite; optional fields the body omits (`goal`, `avatar`, `notes`, `dateOfBirth`, `checkInFreq`, `medicalHistory`) keep what the deleted row had. `planId` becomes the body's or null; `subscriptionStatus` and `currentPeriodEnd` are reset to null. |
| Welcome message on a resurrected client | Sent like for a new client (a new pending anamnesis is requested). |
| `welcomeMessage: "SKIPPED"` | Also when the phone is blank, not only when notifications are off. |
| `planId` on `POST /clients` and `PATCH /clients/:id` | Must be one of the trainer's plans, else `400` — the contract states this only for convert. Without it a trainer could link a client to another trainer's plan and read it back through `GET /clients/:id`. |
| `PATCH /clients/:id/convert` | Does not require the current status to be LEAD (as before). |
| Payment write | The client update inside the transaction carries `userId` and the soft-delete filter; a client deleted after the ownership check answers `404` and the payment is rolled back. |
| `PlanView.features` | Stored keys that are no longer in the catalogue are left out of the view (same rule as `describePlanFeatures`). |
| `DELETE /plans/:id` | Hard delete, as before; the FK sets `Client.planId` to null. |
