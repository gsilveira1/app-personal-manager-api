# Integration notes — health stream

Module: `src/modules/health/` (`HealthModule`). Endpoints 70–79 of `docs/api-contract-v2.md`.
Old directories `src/modules/evaluations/` and `src/modules/anamnesis/` are deleted.

## 1. `src/modules/app.module.ts`

- Import `HealthModule` from `./health/health.module`.
- Remove the imports of `EvaluationsModule` and `AnamnesisModule` (their files no longer exist).

`HealthModule` imports `IdentityModule`, `ClientDirectoryModule` and `MessagingModule` and needs, at runtime:

| Token | Must be exported by | Used for |
|---|---|---|
| `USER_DIRECTORY` | `IdentityModule` | `getProfile` (form branding) |
| `CLIENT_DIRECTORY` | `ClientDirectoryModule` | `requireOwned`, `findById` |
| `NOTIFICATION_SENDER` | `MessagingModule` | `enqueue` (WELCOME_ANAMNESIS) |
| `PrismaService` | global `PrismaModule` | `Assessment` |
| passport `jwt` strategy | `IdentityModule` | `JwtAuthGuard` on the trainer routes |

It exports only `ANAMNESIS_REQUESTER` (`useExisting: AnamnesisService`). `AnamnesisService`,
`EvaluationsService` and `EvaluationsCalculatorService` are no longer exported.

## 2. References to the deleted modules in other streams' files

These still pointed at the old directories when this stream finished; their owners / the integrator must drop them:

- `src/modules/messaging/messaging.module.ts` imported `../anamnesis/anamnesis.module` (and `messaging.service.ts` used `AnamnesisService`). Messaging must not import health at all (the DAG is health → messaging).
- `src/modules/clients/*` (crm stream, being deleted) used `AnamnesisService`; crm now injects `ANAMNESIS_REQUESTER`.

## 3. Environment variables

- `FRONTEND_URL` (then `APP_CLIENT_URL`, then `http://localhost:5173`) — base of the anamnesis link `${base}/#/anamnesis?token=…`. Add `FRONTEND_URL` to `.env.example` (already in the integrator checklist).
- The anamnesis link no longer uses `JWT_SECRET`; health registers no `JwtModule`.

## 4. Seed (`prisma/seed.ts`)

Assessments must be built with `buildAssessmentData` and include `userId` (the trainer):

- PHYSICAL_EVALUATION rows: `date` = evaluation date, `data` = `buildPhysicalEvaluationData({ weight, … })`, `magicToken` null.
- A submitted ANAMNESIS: `magicToken` null, `tokenExpiresAt` null, `date` = submission time.
- A pending ANAMNESIS (useful for e2e): `data` = `{ version: 1 }`, `magicToken` = 64 hex chars, `tokenExpiresAt` in the future.
- Optionally an expired one (`tokenExpiresAt` in the past) to show the EXPIRED status.

Every stored document must carry `version: 1` and, for evaluations, a numeric `weight`; anything else is answered with `500` on read (by design).

## 5. e2e specs

- `test/messaging-queue.e2e-spec.ts` references the old anamnesis flow (already listed for rewrite by the integrator).
- No e2e spec exists for health. Recommended against a scratch database (not possible with a mocked Prisma):
  1. magic-link → form → submit → second submit is `401`;
  2. two parallel `POST /anamnesis/submit` with the same token → exactly one `200`, one `401`, one PHYSICAL_EVALUATION row;
  3. `PATCH /evaluations/:id` with `clientId` in the body → `400`;
  4. evaluation of a soft-deleted client disappears from `GET /evaluations` and answers `404` by id.

## 6. Dependencies

None to install.

## 7. Contract gaps and choices made in this stream

1. **No reader for `Assessment.data` in `src/common/types`.** Section 5 says every read goes through a `read*` function that throws `500` on a malformed document, but `assessment-data.ts` only has builders. The readers live in `src/modules/health/assessment.views.ts` (`readPhysicalEvaluationData`, `readAnamnesisData`): they check the `version` envelope (and a numeric `weight`), log with `Logger.error` and throw `500`. If the integrator prefers them in `src/common/types`, they can be moved as is.
2. **`request-reassessment` when the queue reports `DUPLICATE`.** The contract types `notification.status` as the literal `"QUEUED"`. The key is per assessment and each call creates a new assessment, so a duplicate cannot happen in practice; the response reports `QUEUED` in both cases.
3. **`request-reassessment` when the queue is down (`503`).** The pending assessment is already created (as the port documents) and stays as an unused PENDING row; the failure is logged with the assessment id and rethrown. It is not rolled back because Redis and Postgres cannot share a transaction.
4. **Evaluations of a soft-deleted client** answer `404` on `GET/PATCH/DELETE /evaluations/:id` (the contract only names the list filter; this follows the "soft-deleted → 404" ground rule).
5. **`PATCH /evaluations/:id` with empty `skinfolds: {}` / `perimeters: {}`** — the old update stored the empty object and ran the calculator on zero skinfolds (producing meaningless metrics). Now an empty group is dropped and the calculator runs only when at least one skinfold exists, as `create` always did.
6. **`GET /anamnesis/form`** accepts the token as `?token=` and, as section 1 defines the access level, as `Authorization: Bearer`. `POST /anamnesis/submit` takes it from the body only, as the endpoint table says.
7. **`EvaluationsCalculatorService.calculate` is 77 lines** (over the 50-line rule). It was moved byte-for-byte because the contract requires it unchanged; splitting it is a separate refactor.
8. **`weightKg: 0`** in a submission counts as "present" and creates an evaluation with weight 0 (`AnamnesisAnswersDto` in `src/common` has no minimum). A `@Min` on that shared DTO would be the fix.
