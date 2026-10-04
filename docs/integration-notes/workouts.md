# Integration notes — workouts stream

Contract: `docs/api-contract-v2.md`, sections 5.2, 5.3, 6.3 (endpoints 41–58), stream 3.

## 1. `src/modules/app.module.ts`

- Import `WorkoutsModule` from `./workouts/workouts.module` and keep `AiModule` (`./ai/ai.module`).
- Remove the imports of `WorkoutSheetsModule`, `ExercisesModule` and `StudentPortalModule`: the directories `workout-sheets/`, `exercises/` and `student-portal/` are deleted.
- `ConfigModule.forRoot({ isGlobal: true })` and the global `PrismaModule` must stay: `WorkoutsModule` relies on both.

`WorkoutsModule` imports `IdentityModule`, `ClientDirectoryModule` and `MessagingModule`, and needs them to export `USER_DIRECTORY`, `CLIENT_DIRECTORY` and `NOTIFICATION_SENDER`. It exports `WORKOUT_SHEET_READER`. It registers its own `JwtModule.registerAsync(jwtModuleAsyncOptions)` to sign and verify magic links.

`AiController` now uses `JwtAuthGuard`, so the passport `"jwt"` strategy (identity's `JwtStrategy`) must be registered in the application; `AiModule` itself imports nothing new.

## 2. Other streams still pointing at deleted code

- `src/modules/messaging/messaging.module.ts` imports `../student-portal/student-portal.module` (old code, messaging stream rewrites it). Messaging must not depend on workouts: the dependency direction is workouts → messaging.
- The old `clients/` module held `getActivityHeatmap` and `getExpiringSheets`; both now live here (`ClientActivityService`, `WorkoutSheetsService.findExpiring`).

## 3. Environment (`.env.example`)

| Variable | Use | Required |
|---|---|---|
| `FRONTEND_URL` | Base URL of the magic link (`${FRONTEND_URL}/#/p/${slug}?token=…`) | No — falls back to `APP_CLIENT_URL`, then `http://localhost:5173`. Must be set in production, or students receive localhost links. |
| `APP_CLIENT_URL` | Fallback for the above | No |
| `JWT_SECRET` | Signs magic links (shared `jwtModuleAsyncOptions`) | Yes in production |

Both URL variables are now read through `ConfigService`, not `process.env`.

## 4. Seed (`prisma/seed.ts`)

**Global exercises.** The hard-coded `GLOBAL_EXERCISES` array is gone with `exercises.service.ts`; `GET /exercises` returns only database rows. Seed these eight with `userId: null`. Keeping the old ids is recommended, because stored sheets may carry them in `exerciseId`:

| id | name | bodyPart | targetMuscle | equipment | gifUrl |
|---|---|---|---|---|---|
| `global-bench-press` | Barbell Bench Press | chest | pectorals | barbell | `https://pub-r2.com/exercises/bench-press.gif` |
| `global-squat` | Barbell Back Squat | legs | quadriceps | barbell | `https://pub-r2.com/exercises/squat.gif` |
| `global-deadlift` | Barbell Deadlift | back | erector spinae | barbell | `https://pub-r2.com/exercises/deadlift.gif` |
| `global-pullup` | Pull Up | back | latissimus dorsi | bodyweight | `https://pub-r2.com/exercises/pull-up.gif` |
| `global-dumbell-curl` | Dumbbell Bicep Curl | arms | biceps | dumbbell | `https://pub-r2.com/exercises/dumbbell-curl.gif` |
| `global-tricep-pushdown` | Tricep Pushdown | arms | triceps | cable | `https://pub-r2.com/exercises/tricep-pushdown.gif` |
| `global-shoulder-press` | Dumbbell Shoulder Press | shoulders | deltoids | dumbbell | `https://pub-r2.com/exercises/shoulder-press.gif` |
| `global-leg-press` | Leg Press | legs | quadriceps | machine | `https://pub-r2.com/exercises/leg-press.gif` |

**Sheets and templates.** `structure: toJsonValue(buildWorkoutStructure({ workouts, description?, tags? }))`. Client sheet: `isTemplate: false`, `clientId` set, at most one `active: true` per client (partial unique index). Template: `isTemplate: true`, `clientId: null`, `active: true`.

**Student sessions.** `executionData: toJsonValue(buildExecutionData({ sheetId, itemId, loads }))`, where `itemId` is a `WorkoutItem.id` and `loads[].workoutExerciseId` a `WorkoutExerciseEntry.id` of that sheet. Give seeded items and exercises explicit ids so events (`workoutSegmentId`) and sessions can point at them. The old columns `workoutId` and `loads` no longer exist.

## 5. e2e specs (`test/`)

- `test/messaging-queue.e2e-spec.ts` calls `POST /api/students/:id/resend-link`. For `type: "WORKOUT_SHEET"` the replacement is `POST /api/clients/:id/magic-link/send` (no body; `200 SendLinkResult`, `status` always `"QUEUED"`, needs Redis).
- No e2e spec covers endpoints 41–58 today. Suggested scenarios once the app boots: exercise search with two trainers (the leak regression against a real query), two concurrent `POST /clients/:id/workout-sheets` for one client (exactly one active sheet afterwards), magic link → `GET /student/workout-sheet` → `POST /student/sessions` → `lastLoadKg` on the next read, `POST /ai/workout-plan` without a token → `401`.

## 6. Dependencies

None to install. The specs use `supertest`, `passport-jwt` and `@nestjs/passport`, all already in `package.json`.

## 7. Test harness other streams may reuse

`src/modules/workouts/testing/http-test-app.ts` boots controllers behind the same `ValidationPipe` as `main.ts` with a stand-in passport `"jwt"` strategy (`createHttpTestApp`, `bearerFor`). `ai/ai.controller.spec.ts` uses it. If the integrator wants it shared, `src/common/testing/` would be the place (not moved: `src/common` is frozen).

## 8. Database behaviour not verified here

Tests run against a mocked Prisma, so these were not exercised against PostgreSQL:

- the partial unique index `WorkoutSheet_one_active_per_client_key` surfacing as `P2002` on a concurrent create (the service retries once, then answers `409`);
- the check `WorkoutSheet_template_xor_client_chk` (the service always writes consistent pairs);
- the exercise catalogue `where` (`AND: [ownership OR, filters, search OR]`) as generated SQL.
