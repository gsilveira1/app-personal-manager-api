# Vivi API — Contract v2 (schema consolidation)

Status: **frozen** · 2026-10-03 · branch `feature/schema-consolidation`

This is the single reference for the consolidation from 23 tables / 18 modules to 11 tables / 6 domain modules. It is written for the developers who implement it in parallel: every stream codes against this document and the code in `src/common/`, not against another stream's work in progress.

The owner's decisions (Q1–Q18 in `tasks/v2/client-last-5-commits-resume.md`) are final. Where that record left something open, the choice made here is listed in [section 12](#12-open-questions-and-assumptions).

Contents

1. [Ground rules](#1-ground-rules)
2. [Schema](#2-schema)
3. [Module map and ownership](#3-module-map-and-ownership)
4. [Cross-module ports](#4-cross-module-ports)
5. [JSONB documents](#5-jsonb-documents)
6. [Endpoints](#6-endpoints)
7. [Soft delete](#7-soft-delete)
8. [Auth and client-v2](#8-auth-and-client-v2)
9. [Messaging](#9-messaging)
10. [Old route → new route](#10-old-route--new-route)
11. [Work streams](#11-work-streams)
12. [Open questions and assumptions](#12-open-questions-and-assumptions)
13. [Frontend impact](#13-frontend-impact)
14. [Integrator checklist](#14-integrator-checklist)

---

## 1. Ground rules

- Every route is under `/api` (global prefix). Paths below omit it.
- Errors use the NestJS default body: `{ "statusCode": number, "message": string | string[], "error": string }`.
- Validation is the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`): an unknown body property is a `400`.
- Dates are ISO 8601 strings in UTC on the wire.
- Access levels:

| Level | Meaning |
|---|---|
| **JWT** | `Authorization: Bearer <access token>`; guard `JwtAuthGuard` |
| **Admin** | JWT whose `role` is `admin`; guards `JwtAuthGuard, RolesGuard` + `@Roles(ROLE_ADMIN)` |
| **Public** | no authentication |
| **Public-by-slug** | no authentication; the trainer is the `:slug` path segment (`User.slug`). Unknown slug → `404` |
| **Magic token** | a token issued to a student, sent as `?token=` or `Authorization: Bearer` |

- Ownership failures keep today's convention: `404` when the record does not exist (or is soft-deleted), `403` when it belongs to another trainer.
- No error is swallowed. A `catch` either rethrows a typed HTTP exception or logs with `Logger.error` (message, entity id, upstream HTTP status) and degrades in a way this document names. `catch { continue }`, `.catch(() => null)` and "return `[]` on error" are not allowed.
- Functions stay under 50 lines; every new behaviour arrives with a unit test; a bug fixed during the port gets a regression test first.

---

## 2. Schema

File: `prisma/schema.prisma`. Baseline migration: `prisma/migrations/20261003000000_baseline_v2/migration.sql` (the previous ten migration folders were removed; there is no data migration).

### 2.1 Models (11)

| Model | Replaces | Owner module |
|---|---|---|
| `User` | User + Tenant + UserSetting | identity |
| `PasswordResetToken` | same | identity |
| `Client` | Client (+ subscription fields, soft delete) | crm |
| `Plan` | Plan + PlanFeature + SystemFeature | crm |
| `Payment` | ManualPayment | crm |
| `WorkoutSheet` | WorkoutSheet + WorkoutSheetItem + WorkoutBlock + WorkoutExercise + WorkoutTemplate | workouts |
| `Exercise` | Exercise (hybrid: `userId` null = global) | workouts |
| `StudentSession` | StudentSession | workouts |
| `Event` | Session + RecurringEvent + SessionException + AvailabilityBlock | calendar |
| `Assessment` | Evaluation + Anamnesis | health |
| `NotificationLog` | NotificationLog (audit only) | messaging |

### 2.2 Deviations from the approved (printed) schema

Everything not listed here is exactly as approved.

| # | Model | Change | Why it is required |
|---|---|---|---|
| D1 | `Event` | `parentEventId String?` self-relation (`onDelete: Cascade`), `originalStartTime DateTime?`, `@@unique([parentEventId, originalStartTime])` | Q3 says "an exception is an event that points to the parent event id" and names `originalStartTime`, but the printed model had neither. Without them a cancelled, completed or moved occurrence of a series cannot be stored, and deleting a series would leave its exceptions behind. |
| D2 | `Event` | `sessionType String?`, `category String?` | `Session.type` ("In-Person" / "Online") and `Session.category` ("Workout" / "Check-in" / "Evaluation") are shown by the calendar and sent by the client today. The printed model reuses the name `type` for `EventType`, so the session attributes had nowhere to go. |
| D3 | `Event` | `@@index([workoutSheetId])` | The FK is `SET NULL` on sheet deletion; without the index that is a sequential scan. |
| D4 | `User` | `status AccountStatus @default(ACTIVE)` and enum `AccountStatus { ACTIVE BLOCKED OVERDUE }` | `Tenant.status` gates the student portal (BLOCKED/OVERDUE → 403) and is what the admin screen edits. The printed schema dropped `TenantStatus` without a replacement. |
| D5 | `Payment` | `method String?`, `periodEnd DateTime?`, `notes String?` | `ManualPayment` recorded how it was paid (`paymentType`), until when it is valid (`validUntil`, copied to `Client.currentPeriodEnd`) and a note. The printed model kept only the amount. |
| D6 | `Assessment` | `date DateTime @default(now())`, `@@index([clientId, type, date])` | Evaluations have a trainer-entered date and are listed by it; for an anamnesis it is the submission time, which decides which one is "current". Ordering by a JSONB field is not indexable. |
| D7 | `NotificationLog` | `clientId String?` (FK `SET NULL`), `@@index([clientId])` | `GET /students/:id/messages` matches rows by phone number today, which breaks when a phone changes or two clients share one. |
| D8 | `NotificationLog` | `jobId String? @unique` | Idempotency key of the BullMQ job: the worker writes at most one audit row per job even when it is retried or re-delivered. |

Not added, on purpose:

- **Block end time** — a BLOCK ends at `date + durationMinutes`. The API keeps `dtstart`/`dtend` and converts (section 6.4).
- **`isCurrent` on Assessment** — derived: the current anamnesis is the submitted one with the latest `date` (section 6.5).
- **Template description / tags** — live inside `WorkoutSheet.structure`.
- **`StudentSession.workoutId`** — lives inside `executionData.itemId`.
- **Tenant name** ("Fulano Studio") — dropped; the business name is `User.name`.

### 2.3 Hand-written SQL in the baseline migration

Prisma cannot express these; they are at the bottom of `migration.sql` under "Hand-written section". If the SQL is ever regenerated with `prisma migrate diff`, that block must be re-appended.

| Constraint | Rule |
|---|---|
| `WorkoutSheet_template_xor_client_chk` | `isTemplate` ⇔ `clientId IS NULL` |
| `WorkoutSheet_one_active_per_client_key` | partial unique index on `clientId` where `active AND NOT isTemplate` |
| `Event_type_client_chk` | BLOCK ⇔ `clientId IS NULL`; SESSION ⇔ `clientId IS NOT NULL` |
| `Event_exception_shape_chk` | `parentEventId` and `originalStartTime` are set together, and an exception has no `rrule` |
| `Event_duration_positive_chk` | `durationMinutes > 0` |

A violated constraint surfaces as Prisma `P2002` (unique) or `P2004`/raw `23514` (check). Services must validate first and return `400`/`409`; the constraints are the safety net for races.

### 2.4 Event rows

| Kind | `type` | `rrule` | `parentEventId` | `clientId` | Notes |
|---|---|---|---|---|---|
| One-off session | SESSION | null | null | set | `status` SCHEDULED / COMPLETED |
| Series master | SESSION | set | null | set | `date` is DTSTART; never returned as a row, only expanded |
| Exception | SESSION | null | master id | set (copied) | `originalStartTime` = the occurrence it replaces. `status` CANCELLED removes the occurrence, COMPLETED marks it done, SCHEDULED is an edited/moved occurrence. `date`, `durationMinutes`, `sessionType`, `category`, `clientId`, `workoutSheetId`, `workoutSegmentId` are copied from the master when the exception is created and then overridden. `notes` null means "use the master's notes". |
| Block | BLOCK | optional | null | null | `title` required by the API; ends at `date + durationMinutes` |

---

## 3. Module map and ownership

| Module | Directory | Absorbs (old directories, deleted by the owning stream) | Owns (exclusive writer) |
|---|---|---|---|
| **identity** | `src/modules/identity/` | `auth/`, `users/`, `tenants/` (except WhatsApp endpoints), `admin/`, `settings/` | `User`, `PasswordResetToken` |
| **crm** | `src/modules/crm/` | `clients/`, `leads/`, `plans/`, `system-features/` | `Client`, `Plan`, `Payment` |
| **workouts** | `src/modules/workouts/` | `workout-sheets/`, `exercises/`, `student-portal/` (+ guards on `ai/`) | `WorkoutSheet`, `Exercise`, `StudentSession` |
| **calendar** | `src/modules/calendar/` | `sessions/`, `availability-blocks/`, `src/utils/rrule-expander.ts` | `Event` |
| **health** | `src/modules/health/` | `evaluations/`, `anamnesis/` | `Assessment` |
| **messaging** | `src/modules/messaging/` | `messaging/` (rewritten in place), WhatsApp endpoints of `tenants/` | `NotificationLog`, the `notifications` queue |

Infrastructure modules stay where they are and own no model: `prisma/`, `gcs/`, `mailer/`, `ai/` (the workouts stream adds the guard to `ai.controller.ts`; nothing else in `ai/` changes).

Module class names and files are fixed (skeletons already exist so imports resolve during parallel work):

```
src/modules/identity/identity.module.ts          IdentityModule
src/modules/crm/crm.module.ts                    CrmModule
src/modules/crm/client-directory.module.ts       ClientDirectoryModule
src/modules/workouts/workouts.module.ts          WorkoutsModule
src/modules/calendar/calendar.module.ts          CalendarModule
src/modules/health/health.module.ts              HealthModule
src/modules/messaging/messaging.module.ts        MessagingModule
```

### 3.1 Ownership rules

- **R1 — writes.** Only the owner module calls `create`, `update`, `upsert`, `delete` (and their `*Many` forms) on a model. No exceptions.
- **R2 — reads.** A module reads another module's model through the owner's port (section 4). Two narrow exceptions, both inside a query on the module's *own* model, exist to avoid N+1 queries:
  - a relation filter on the client's soft-delete flag — use the constants in `src/common/prisma/soft-delete.ts` (`OF_LIVE_CLIENT`, `WITHOUT_DELETED_CLIENT`);
  - the display projection `client: { select: { name: true, avatar: true } }`.
- **R3 — module imports form a DAG.** No `forwardRef`.

```
ClientDirectory   (PrismaService only)
identity    → ClientDirectory            (admin list: client count)
messaging   → identity
health      → identity, ClientDirectory, messaging
workouts    → identity, ClientDirectory, messaging
crm         → identity, ClientDirectory, workouts, health
calendar    → identity, ClientDirectory, workouts
```

`ClientDirectoryModule` is a separate, dependency-free module inside `src/modules/crm/` precisely so that health and workouts can read clients while crm depends on them.

---

## 4. Cross-module ports

Interfaces and injection tokens live in `src/common/ports/` and are **frozen**. A consumer injects by token and mocks the interface in unit tests:

```ts
constructor(@Inject(CLIENT_DIRECTORY) private readonly clients: ClientDirectory) {}
// test: { provide: CLIENT_DIRECTORY, useValue: { requireOwned: jest.fn() } }
```

| Token | Interface (file) | Provided and exported by | Consumed by |
|---|---|---|---|
| `USER_DIRECTORY` | `UserDirectory` (`user-directory.port.ts`) | `IdentityModule` | messaging, health, workouts, crm, calendar |
| `CLIENT_DIRECTORY` | `ClientDirectory` (`client-directory.port.ts`) | `ClientDirectoryModule` | health, workouts, calendar, crm, identity (admin count) |
| `WORKOUT_SHEET_READER` | `WorkoutSheetReader` (`workout-sheet-reader.port.ts`) | `WorkoutsModule` | crm, calendar |
| `NOTIFICATION_SENDER` | `NotificationSender` (`notification-sender.port.ts`) | `MessagingModule` | health, workouts |
| `ANAMNESIS_REQUESTER` | `AnamnesisRequester` (`anamnesis-requester.port.ts`) | `HealthModule` | crm |

Signatures (the files carry the full TSDoc, including what each method throws):

```ts
interface UserDirectory {
  requireBySlug(slug: string): Promise<TrainerProfile>;                 // 404 unknown slug
  getProfile(userId: string): Promise<TrainerProfile>;
  getSettings(userId: string): Promise<ResolvedUserSettings>;           // defaults applied
  getWhatsappConnection(userId: string): Promise<WhatsappConnection>;
  setWhatsappConnection(userId: string, patch: Partial<WhatsappConnection>): Promise<WhatsappConnection>;
}
// TrainerProfile = { id, name, phone, slug, status: AccountStatus, primaryColor, logoUrl }
// WhatsappConnection = { instanceName: string | null, status: WhatsappStatus }

interface ClientDirectory {
  requireOwned(userId: string, clientId: string): Promise<ClientSummary>;   // 404 missing/deleted, 403 other trainer
  findById(clientId: string): Promise<ClientSummary | null>;                // null when missing/deleted
  findManyOwned(userId: string, clientIds: readonly string[]): Promise<Map<string, ClientSummary>>;
  countByOwners(userIds: readonly string[]): Promise<Map<string, number>>;
}
// ClientSummary = { id, userId, name, email, phone, avatar, status, dateOfBirth, notificationEnabled }

interface WorkoutSheetReader {
  findActiveSummaries(userId: string, clientIds: readonly string[]): Promise<Map<string, ActiveSheetSummary>>;
  resolveSegments(userId: string, refs: readonly WorkoutSegmentRef[]): Promise<WorkoutSegmentSummary[]>;
  assertSegment(userId: string, ref: { sheetId: string; segmentId?: string | null }): Promise<void>; // 404 sheet, 400 segment
}

interface NotificationSender {
  enqueue(request: EnqueueNotificationRequest): Promise<EnqueueNotificationResult>;  // 503 when Redis is down
}

interface AnamnesisRequester {
  requestAnamnesis(userId: string, clientId: string, options: { notify: boolean }): Promise<AnamnesisRequestResult>;
}
```

`setWhatsappConnection` is the only write that crosses a module boundary, and it goes through the owner (identity).

Shared primitives every stream uses instead of the old per-module copies:

| Need | Import from |
|---|---|
| `JwtAuthGuard`, `RolesGuard`, `@Roles`, `ROLE_ADMIN`, `@CurrentUserId()`, `RequestWithUser` | `src/common/auth` |
| `jwtModuleAsyncOptions`, `ACCESS_TOKEN_TTL_SECONDS` | `src/common/auth` |
| JSONB types, DTOs, builders | `src/common/types` |
| Soft-delete filters | `src/common/prisma/soft-delete` |

`src/types/global.ts` and `src/modules/auth/roles.*` are superseded; the identity stream deletes them.

---

## 5. JSONB documents

Types, class-validator DTOs and builders are in `src/common/types/` (one file per document, each with a spec). **Every write to a JSONB column goes through the builder named below**, then `toJsonValue()`. Reads go through the `read*` / `resolve*` function, which throws `500` on a malformed document instead of rendering an empty one.

### 5.1 `User.settings` — `user-settings.ts`

```ts
interface UserSettings {
  aiInstructions?: string;                 // was UserSetting "ai_prompt_instructions"
  language?: "pt-BR" | "en" | "es";        // was UserSetting "preferred_language"
  workHours?: WorkHoursConfig;             // was UserSetting "work_hours"
  dnd?: DndConfig;                         // was Tenant.features.dnd*
  limits?: AccountLimits;                  // was Tenant.features; written by admins only
}
type WorkHoursConfig = Record<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday", DaySchedule>
  & { slotDurationMinutes: number };       // 15–120
interface DaySchedule { enabled: boolean; start: string; end: string }   // "HH:mm"
interface DndConfig { enabled: boolean; startHour: number; endHour: number; timezone: string }  // hours 0–23
interface AccountLimits { maxStudents: number; canUploadVideos: boolean; whatsappAlerts: boolean }
```

| Function | Use |
|---|---|
| `mergeUserSettings(stored, patch)` | before every write; replaces top-level keys and validates the result |
| `resolveUserSettings(stored)` | every read; fills defaults (`pt-BR`, Mon–Sat 07:00–19:00 / 60 min, DND 22–08 `America/Sao_Paulo`, limits 50 / true / true) |

### 5.2 `WorkoutSheet.structure` — `workout-structure.ts`

```ts
interface WorkoutSheetStructure {
  version: 1;
  description?: string;        // templates
  tags?: string[];             // templates
  items: WorkoutItem[];
}
interface WorkoutItem { id: string; letter: string; name: string; orderIndex: number; blocks: WorkoutBlock[] }
interface WorkoutBlock { id: string; type: "REGULAR" | "BISET" | "TRISET"; orderIndex: number; restTimeSeconds: number; exercises: WorkoutExerciseEntry[] }
interface WorkoutExerciseEntry {
  id: string;
  exerciseId: string | null;   // catalogue id, not a foreign key
  exerciseName: string;
  gifUrl: string | null;
  sets: number;
  reps: string;
  suggestedLoadKg: number | null;
  executionNotes: string | null;
  isWarmup: boolean;
  orderIndex: number;
}
```

Ids:

- Every item, block and exercise has an `id` matching `^[A-Za-z0-9_-]{1,64}$`, unique within the sheet.
- The client may generate them. Where the request omits one, the server assigns a UUID.
- They are stable: `Event.workoutSegmentId` stores a `WorkoutItem.id`; `StudentSession.executionData` stores `WorkoutItem.id` and `WorkoutExerciseEntry.id`. A client that edits a sheet sends the ids back unchanged.
- A pointer that no longer resolves after an edit is legal and reads as "no workout linked".

The API body calls the list `workouts` (unchanged from today); the stored document calls it `items`.

| Function | Use |
|---|---|
| `WorkoutStructureInputDto` | body fragment `{ workouts, description?, tags? }` — extend or embed it in the request DTOs |
| `buildWorkoutStructure(input)` | before every write; applies defaults (name "Exercício", 3 sets, "10-12", rest 60 s), assigns ids, rejects BISET < 2 and TRISET < 3 exercises and duplicate ids (`400`) |
| `readWorkoutStructure(stored, sheetId)` | every read |
| `findWorkoutItem(structure, id)` | resolve a segment pointer |

### 5.3 `StudentSession.executionData` — `execution-data.ts`

```ts
interface ExecutionData {
  version: 1;
  sheetId: string | null;      // sheet that was executed
  itemId: string | null;       // WorkoutItem.id (the old workoutId)
  exercises: Array<{ workoutExerciseId: string; loadKg: number | null; completed: boolean }>;
}
```

`buildExecutionData({ sheetId, itemId, loads })`, `readExecutionData(stored, sessionId)`, `loadsByExercise(data)`.

### 5.4 `Assessment.data` — `assessment-data.ts`

```ts
// type = ANAMNESIS. A pending request stores { version: 1 }.
interface AnamnesisData {
  version: 1;
  medicalHistory?: string; injuriesAndPain?: string; routineAndSchedule?: string;
  fitnessGoals?: string; experienceLevel?: string;
  parqAnswers?: Record<string, boolean>;
  frontPhotoUrl?: string; backPhotoUrl?: string; sidePhotoUrl?: string;
  weightKg?: number;
  measurements?: Record<string, number>;
}

// type = PHYSICAL_EVALUATION
interface PhysicalEvaluationData {
  version: 1;
  weight: number;
  height?: number; bodyFatPercentage?: number; leanMass?: number; fatMass?: number; bodyDensity?: number;
  protocol?: string; equation?: string; notes?: string;
  perimeters?: Perimeters;     // keys of PerimetersDto
  skinfolds?: Skinfolds;       // keys of SkinfoldsDto
}
```

`buildAssessmentData(type, payload)` (or `buildAnamnesisData` / `buildPhysicalEvaluationData`). `AnamnesisAnswersDto` and `PhysicalEvaluationMetricsDto` are the reusable request fragments.

### 5.5 `Plan.features` — `plan-features.ts`

```ts
enum PlanFeatureKey {
  AI_WHATSAPP_BOT = "ai_whatsapp_bot",
  VIDEO_EXERCISE_UPLOAD = "video_exercise_upload",
  AUTOMATED_PIX = "automated_pix",
  POSTURE_CORRECTION = "posture_correction",
  ADVANCED_METRICS = "advanced_metrics",
}
```

`PLAN_FEATURE_CATALOG` carries the display name and description of each key (the five rows the seed used to insert). Validate request arrays with `@IsEnum(PlanFeatureKey, { each: true })`.

### 5.6 Not JSONB, but shared: `notification-job.ts`

Queue name, job payload, retry options, idempotency helper and the delivery error classes. See [section 9](#9-messaging).

---

## 6. Endpoints

88 endpoints (111 before; 120 counting the duplicated `/tenant` prefix). Four of them also answer on an alias path for client-v2.

Shared shapes:

```ts
interface Paginated<T> { items: T[]; total: number; page: number; totalPages: number }
interface Message { message: string }
```

### 6.1 identity — 21 endpoints

```ts
interface UserView {
  id: string; name: string; email: string;
  role: "admin" | "trainer";
  status: "ACTIVE" | "BLOCKED" | "OVERDUE";
  avatar: string | null; phone: string | null; bio: string | null;
  slug: string;
  primaryColor: string | null; logoUrl: string | null;
  whatsappInstanceName: string | null;
  whatsappStatus: "CONNECTED" | "DISCONNECTED" | "PENDING";
  setupCompleted: boolean;
  settings: ResolvedUserSettings;
  createdAt: string; updatedAt: string;
}
interface LoginResponse {
  access_token: string;        // read by app-personal-manager-client
  accessToken: string;         // same value; read by client-v2
  tokenType: "Bearer";
  expiresIn: number;           // seconds, 86400
  user: UserView;
}
```

`password` is never returned. The JWT payload is unchanged: `{ sub, username, role }`.

| # | Method | Path | Access | Body | Response | Errors |
|---|---|---|---|---|---|---|
| 1 | POST | `/auth/login` | Public | `{ email: string; password: string }` | `200 LoginResponse` | 401 invalid credentials |
| 2 | POST | `/auth/logout` | JWT | — | `200 Message` | 401 |
| 3 | POST | `/auth/signup` · alias `/auth/register` | Public | `{ name: string; email: string; password: string /* min 6 */ }` | `201 LoginResponse` | 400, 409 e-mail in use |
| 4 | GET | `/auth/me` · alias `/users/me` | JWT | — | `200 UserView` | 401, 404 |
| 5 | POST | `/auth/forgot-password` · alias `/auth/password-reset/request` | Public | `{ email: string }` | `200 Message` (same text whether or not the e-mail exists) | 400 |
| 6 | POST | `/auth/reset-password` · alias `/auth/password-reset/confirm` | Public | `{ token: string; password: string /* min 8 */ }` | `200 Message` | 400 invalid / used / expired token |
| 7 | PATCH | `/users/profile` | JWT | `{ name?; email?; password? /* min 6 */; avatar?; phone?; bio?; slug? }` | `200 UserView` | 400, 409 e-mail or slug in use |
| 8 | POST | `/users/avatar-upload-url` | JWT | `{ contentType: string }` | `201 { uploadUrl: string; publicUrl: string }` | 400 |
| 9 | PATCH | `/users/branding` | JWT | `{ logoUrl?: string /* URL */; primaryColor?: string /* hex */ }` | `200 UserView` | 400 |
| 10 | POST | `/users/setup/complete` | JWT | — | `200 { success: true; user: UserView }` | |
| 11 | GET | `/settings/ai-instructions` | JWT | — | `200 { instructions: string }` | |
| 12 | PUT | `/settings/ai-instructions` | JWT | `{ instructions: string }` | `200 { instructions: string }` | 400 |
| 13 | GET | `/settings/language` | JWT | — | `200 { language: string }` | |
| 14 | PATCH | `/settings/language` | JWT | `{ language: "pt-BR" \| "en" \| "es" }` | `200 { language: string }` | 400 |
| 15 | GET | `/settings/work-hours` | JWT | — | `200 WorkHoursConfig` | |
| 16 | PUT | `/settings/work-hours` | JWT | `WorkHoursConfig` | `200 WorkHoursConfig` | 400 |
| 17 | PATCH | `/settings/dnd` | JWT | `Partial<DndConfig>` | `200 DndConfig` | 400 |
| 18 | GET | `/admin/users?page&limit&status` | Admin | — | `200 Paginated<AdminUserView>` | 403 |
| 19 | GET | `/admin/users/:id` | Admin | — | `200 UserView` | 403, 404 |
| 20 | PATCH | `/admin/users/:id` | Admin | `{ status?: AccountStatus; limits?: Partial<AccountLimits> }` | `200 AdminUserView` | 400, 403, 404 |
| 21 | DELETE | `/admin/users/:id` | Admin | — | `204` | 403, 404 |

```ts
interface AdminUserView {
  id: string; name: string; email: string; slug: string; role: string;
  status: AccountStatus; studentsCount: number;   // live clients, via ClientDirectory.countByOwners
  limits: AccountLimits; createdAt: string;
}
```

Rules:

- **Sign-up** creates one `User` (no second entity). `role` is always `trainer`; a `role` property in the body is a `400` (it was accepted before, which let anyone register as admin). `PATCH /users/profile` does not accept `role` either.
- **Slug** — generated at sign-up: lower-case, accents stripped, non-alphanumerics → `-`, trimmed to 40 chars; on a unique violation (`P2002`) retry up to 5 times with a `-xxxx` random suffix. In `PATCH /users/profile` it must match `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–40 chars; a taken slug is `409`.
- **E-mail** is stored lower-cased and trimmed (unchanged).
- **Settings endpoints** read with `resolveUserSettings` and write with `mergeUserSettings`. `PATCH /settings/dnd` merges the body over the resolved current `dnd` and stores the whole object.
- **Forgot password** keeps the generic response; failures are logged with `Logger.error` including the stack (current behaviour).
- `DELETE /admin/users/:id` is a hard delete; the schema cascades to everything the trainer owns.

### 6.2 crm — 19 endpoints

```ts
interface ClientView {
  id: string; name: string; email: string; phone: string;
  status: "ACTIVE" | "PAUSED" | "OVERDUE" | "LEAD";
  modality: "PRESENCIAL" | "ONLINE" | "HYBRID";
  goal: string | null; avatar: string | null; notes: string | null;
  dateOfBirth: string | null;
  checkInFreq: string | null;
  checkInFrequency: string | null;          // same value, kept for the client app
  medicalHistory: MedicalHistory | null;    // unchanged shape (MedicalHistoryDto)
  notificationEnabled: boolean;
  planId: string | null;
  plan: { id: string; name: string } | null;
  subscriptionStatus: "ACTIVE" | "CANCELED" | "PAST_DUE" | "INCOMPLETE" | null;
  currentPeriodEnd: string | null;
  gatewayCustomerId: string | null;
  userId: string; createdAt: string; updatedAt: string;
}
type ClientListItem = ClientView & { activeWorkoutSheet: { id: string; name: string; expiresAt: string | null } | null };
type ClientDetail = Omit<ClientView, "plan"> & { plan: PlanView | null; payments: PaymentView[] };

interface PaymentView {
  id: string; clientId: string; userId: string;
  provider: "MANUAL" | "STRIPE" | "ASAAS" | "MERCADOPAGO";
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  amount: number; method: "PIX" | "CASH" | "CARD" | null;
  externalId: string | null; date: string; periodEnd: string | null; notes: string | null;
  createdAt: string; updatedAt: string;
}
interface PlanView {
  id: string; type: "PRESENCIAL" | "CONSULTORIA"; name: string;
  sessionsPerWeek: number; durationMinutes: number | null; price: number; active: boolean;
  features: PlanFeatureKey[];
  userId: string; createdAt: string; updatedAt: string;
  _count: { clients: number };              // live clients only
}
interface CreateClientBody {
  name: string; email: string; phone: string;
  status?: ClientStatus; modality?: ClientModality;
  goal?: string; avatar?: string; notes?: string; dateOfBirth?: string;
  checkInFreq?: string; checkInFrequency?: string;
  medicalHistory?: MedicalHistory; planId?: string; notificationEnabled?: boolean;
}
interface CreatePlanBody {
  type: "PRESENCIAL" | "CONSULTORIA"; name: string;
  sessionsPerWeek: number /* 1–6 */; durationMinutes?: 30 | 45 | 60 | 90;
  price: number /* ≥ 0 */; active?: boolean; features?: PlanFeatureKey[];
}
```

| # | Method | Path | Access | Body | Response | Errors |
|---|---|---|---|---|---|---|
| 22 | POST | `/clients` | JWT | `CreateClientBody` | `201 ClientView & { welcomeMessage: "QUEUED" \| "SKIPPED" \| "FAILED" }` | 400, 409 e-mail belongs to a live client |
| 23 | GET | `/clients?page&limit&search&modality&status&sortBy&sortOrder` | JWT | — | `200 Paginated<ClientListItem>` | |
| 24 | GET | `/clients/leads` | JWT | — | `200 ClientView[]` (newest first) | |
| 25 | GET | `/clients/export/csv` | JWT | — | `200 text/csv` | |
| 26 | GET | `/clients/:id` | JWT | — | `200 ClientDetail` | 403, 404 |
| 27 | PATCH | `/clients/:id` | JWT | `Partial<CreateClientBody>` | `200 ClientView` | 400, 403, 404, 409 |
| 28 | PATCH | `/clients/:id/status` | JWT | `{ status: ClientStatus }` | `200 ClientView` | 400, 403, 404 |
| 29 | PATCH | `/clients/:id/convert` | JWT | `{ planId?: string }` | `200 ClientView` | 400, 403, 404 |
| 30 | POST | `/clients/:id/avatar-upload-url` | JWT | `{ contentType: string }` | `201 { uploadUrl; publicUrl }` | 400, 403, 404 |
| 31 | DELETE | `/clients/:id` | JWT | — | `204` | 403, 404 |
| 32 | POST | `/clients/:id/payments` | JWT | `{ amount: number; method: "PIX" \| "CASH" \| "CARD"; periodEnd: string; notes?: string }` | `201 { message: string; payment: PaymentView; client: ClientView }` | 400, 403, 404 |
| 33 | POST | `/public/:slug/leads` | Public-by-slug | `{ name; email; phone; interest: "presencial" \| "online" \| "ambos"; message?: string }` | `201 { id: string }` | 400, 404 slug, 409 e-mail belongs to a live client |
| 34 | GET | `/public/:slug/plans` | Public-by-slug | — | `200 PublicPlans` | 404 slug |
| 35 | POST | `/plans` | JWT | `CreatePlanBody` | `201 PlanView` | 400 |
| 36 | GET | `/plans` | JWT | — | `200 PlanView[]` | |
| 37 | GET | `/plans/:id` | JWT | — | `200 PlanView` | 403, 404 |
| 38 | PATCH | `/plans/:id` | JWT | `Partial<CreatePlanBody>` | `200 PlanView` | 400, 403, 404 |
| 39 | DELETE | `/plans/:id` | JWT | — | `200 PlanView` | 403, 404 |
| 40 | GET | `/plan-features` | JWT | — | `200 PlanFeatureDescriptor[]` | |

```ts
interface PublicPlans {                      // unchanged shape
  presencial: Array<{ id; name; sessionsPerWeek; sessionsPerMonth; durationMinutes; price; features: Array<{ key: string; name: string }> }>;
  consultoria: Array<{ id; name; sessionsPerWeek; price; features: Array<{ key: string; name: string }> }>;
}
```

Rules:

- **`GET /clients`** is the one list (it replaces the array of `/clients` and the page of `/students`). `page` default 1; `limit` default 20, max 500. Filters, sort keys and the tolerant status/modality parsing are those of today's `findStudents`. LEADs are included unless `status` filters them out. `activeWorkoutSheet` comes from `WorkoutSheetReader.findActiveSummaries` (one call per page).
- **`GET /clients/:id`** returns the client, its full plan and its payments (newest first). Sheets and anamneses are no longer embedded: use `GET /clients/:id/workout-sheets` and `GET /anamnesis/student/:id`.
- **Status input** — `status` accepts the enum values case-insensitively plus today's synonyms (`ATIVO`, `PAUSADA`/`PAUSADO`, `EM ATRASO`/`EM_ATRASO`/`ATRASADO`/`INACTIVE`). The body aliases `type` (for modality) and `subscriptionStatus` (for status) are gone: `subscriptionStatus` is now a real column and is not writable through these DTOs.
- **Client e-mail** is stored lower-cased and trimmed, so the `(email, userId)` unique key is case-insensitive in practice.
- **Welcome message** — after a successful `POST /clients`, when `notificationEnabled` is true and a phone is present, crm calls `AnamnesisRequester.requestAnamnesis(userId, clientId, { notify: true })`. `welcomeMessage` reports the outcome: `QUEUED`, `SKIPPED` (notifications off), or `FAILED` (the client is still created; the failure is logged with `Logger.error`).
- **Payments** — one transaction: create `Payment` (`provider` MANUAL, `status` PAID, `date` now) and update the client (`status` ACTIVE, `currentPeriodEnd` = `periodEnd`, `subscriptionStatus` ACTIVE). `amount` is required.
- **Convert lead** — `status` ACTIVE and, when given, `planId` (must be one of the trainer's plans, else `400`).
- **Plans** — `features` replaces `featureIds`; an unknown key is `400`. `PATCH` uses a real DTO (`PartialType`), which today's handler does not.
- **Public plans** — active plans of the trainer; `features` is `describePlanFeatures(plan.features)` mapped to `{ key, name }`.
- **`FeatureCheckService`** is ported as `clientHasFeature(clientId, key: PlanFeatureKey)` reading `Plan.features`; it still has no caller (finding #9 is not in scope).
- Soft delete and the lead upsert: [section 7](#7-soft-delete).

### 6.3 workouts — 18 endpoints

```ts
interface ExerciseView {
  id: string; name: string; bodyPart: string; targetMuscle: string | null; equipment: string;
  gifUrl: string | null; videoUrl: string | null;
  isCustom: boolean;                         // userId !== null
  createdAt: string; updatedAt: string;
}
interface WorkoutSheetView {
  id: string; name: string; expiresAt: string | null;
  active: boolean; isTemplate: boolean; clientId: string | null; userId: string;
  description: string | null; tags: string[];
  workouts: WorkoutItem[];                   // structure.items, sorted by orderIndex at every level
  createdAt: string; updatedAt: string;
}
type SheetBody = { name: string; expiresAt?: string } & WorkoutStructureInput;   // { workouts, description?, tags? }
```

| # | Method | Path | Access | Body | Response | Errors |
|---|---|---|---|---|---|---|
| 41 | GET | `/exercises?search&bodyPart&equipment` | JWT | — | `200 ExerciseView[]` (by name) | |
| 42 | POST | `/exercises` | JWT | `{ name; bodyPart; equipment; targetMuscle?; gifUrl?; videoUrl? }` | `201 ExerciseView` | 400 |
| 43 | POST | `/clients/:id/workout-sheets` | JWT | `SheetBody` | `201 WorkoutSheetView` | 400, 403, 404 |
| 44 | GET | `/clients/:id/workout-sheets` | JWT | — | `200 WorkoutSheetView[]` (newest first) | 403, 404 |
| 45 | GET | `/workout-sheets/expiring` | JWT | — | `200 ExpiringSheetView[]` | |
| 46 | GET | `/workout-sheets/:id` | JWT | — | `200 WorkoutSheetView` | 403, 404 |
| 47 | PATCH | `/workout-sheets/:id` | JWT | `{ name?; expiresAt?: string \| null; workouts?; description?; tags? }` | `200 WorkoutSheetView` | 400, 403, 404 |
| 48 | DELETE | `/workout-sheets/:id` | JWT | — | `200 Message` | 403, 404 |
| 49 | GET | `/workout-templates` | JWT | — | `200 WorkoutSheetView[]` (newest first) | |
| 50 | POST | `/workout-templates` | JWT | `{ name: string } & WorkoutStructureInput` | `201 WorkoutSheetView` | 400 |
| 51 | POST | `/workout-templates/from-sheet/:sheetId` | JWT | `{ name: string; description?: string }` | `201 WorkoutSheetView` | 400, 403, 404 |
| 52 | POST | `/clients/:id/magic-link` | JWT | — | `201 { token: string; url: string }` | 403, 404 |
| 53 | POST | `/clients/:id/magic-link/send` | JWT | — | `200 SendLinkResult` | 403, 404, 503 queue down |
| 54 | GET | `/clients/:id/activity-heatmap?days` | JWT | — | `200 ActivityHeatmap` (unchanged) | 403, 404 |
| 55 | GET | `/student/workout-sheet` | Magic token | — | `200 PortalSheet` (unchanged) | 401, 403, 404 |
| 56 | POST | `/student/sessions` | Magic token | `{ workoutId: string; durationSeconds: number; completedAt?: string; loads?: Array<{ workoutExerciseId: string; loadKg?: number; completed?: boolean }> }` | `200 { message; sessionId; durationSeconds }` | 400, 401, 403, 404 |
| 57 | POST | `/ai/workout-plan` | JWT | unchanged (`GenerateWorkoutPlanDto`) | unchanged | 401 |
| 58 | POST | `/ai/workout-insights` | JWT | unchanged (`GenerateWorkoutInsightsDto`) | unchanged | 401 |

```ts
interface ExpiringSheetView {
  client: { id: string; name: string; avatar: string | null; phone: string };
  sheet: { id: string; name: string; expiresAt: string };
}
interface SendLinkResult {
  status: "QUEUED"; channel: "WHATSAPP"; jobId: string;
  scheduledDelayMs: number; link: string; message: string;
}
interface PortalSheet {
  sheetId: string | null; sheetName: string; trainerName?: string; trainerPhone?: string;
  workouts: Array<{ id; letter; name; blocks: Array<{ id; type; restTimeSeconds;
    exercises: Array<{ workoutExerciseId; exerciseName; gifUrl; sets; reps; executionNotes; lastLoadKg: number | null }> }> }>;
}
```

Rules:

- **Exercise catalogue** — list = `(userId = me OR userId IS NULL) AND filters`. The search `OR` must be nested under `AND` (today the two `OR` keys collide and a search returns other trainers' exercises). `POST` always creates a private exercise (`userId` = caller). Global exercises (`userId` null) come from the seed; the eight hard-coded `GLOBAL_EXERCISES` move there.
- **Create client sheet** — one transaction: deactivate the client's active sheets, insert the new one as active. The partial unique index backs the "one active sheet" rule under concurrency (`P2002` → retry once, then `409`).
- **`/workout-sheets/:id`** (GET, PATCH, DELETE) serves both client sheets and templates; the caller must own it. `PATCH` with `workouts` replaces the whole structure (send ids back to keep them); `description` / `tags` alone patch only those keys.
- **Templates** are `WorkoutSheet` rows with `isTemplate = true`, `clientId = null`, `active = true`. `from-sheet` copies the source structure as is and sets `description`.
- **Expiring** — active, non-template sheets of live clients with `expiresAt` between now and now + 5 days.
- **Workout magic link** — still a JWT, nothing stored: payload `{ sub: clientId, clientId, userId, slug, theme: { primaryColor, logoUrl }, action: "WORKOUT" }`, 30 days, signed through `JwtModule.registerAsync(jwtModuleAsyncOptions)`. URL: `${FRONTEND_URL}/#/p/${slug}?token=${token}` (`FRONTEND_URL`, then `APP_CLIENT_URL`, then `http://localhost:5173`).
- **Send link** — builds the link, then `NotificationSender.enqueue` with template `WORKOUT_LINK` and key `buildIdempotencyKey(["WORKOUT_LINK", clientId, activeSheetId ?? "none", <UTC minute, YYYY-MM-DDTHH:mm>])`. A duplicate within the minute returns the same result without a second message.
- **Portal token check**, in order: token invalid/expired → `401`; `action !== "WORKOUT"` → `403`; `ClientDirectory.findById` null → `404`; trainer `status` BLOCKED or OVERDUE → `403`; client `status` PAUSED → `403`. Messages as today.
- **Portal sheet** — ids come from the structure (`workouts[].id` = item id, `workoutExerciseId` = exercise id). `lastLoadKg` = load from the latest `StudentSession` (via `loadsByExercise`), else `suggestedLoadKg`, else null.
- **Record session** — `workoutId` is a `WorkoutItem.id` of the client's active sheet. Found → `workoutName` = `Treino ${letter} - ${name}`, `executionData.sheetId` = that sheet. Not found → `workoutName` "Treino Realizado", `sheetId` null, `itemId` as sent.
- **Heatmap** — same computation as today, reading `StudentSession`; ownership through `ClientDirectory.requireOwned`.
- **AI** — add `@UseGuards(JwtAuthGuard)` to `AiController`, with a controller spec proving `401` without a token.

### 6.4 calendar — 11 endpoints

```ts
interface SessionView {
  id: string;                         // UUID, or "<seriesId>_<ISO originalStartTime>" for an occurrence of a series
  date: string; durationMinutes: number;
  type: "In-Person" | "Online";       // Event.sessionType
  category: string;                   // "Workout" | "Check-in" | "Evaluation"
  notes: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  completed: boolean;                 // status === "COMPLETED"
  cancelled: boolean;                 // status === "CANCELLED"
  clientId: string; userId: string;
  client: { name: string; avatar: string | null };
  workoutSheetId: string | null; workoutSegmentId: string | null;
  workout: { id: string; name: string; letter: string } | null;   // resolved segment
  timezone: string;
  isVirtual: boolean;                 // true for every occurrence of a series
  recurringEventId: string | null;    // series master id
  recurrenceId: string | null;        // same value, kept for the client app
  originalStartTime: string | null;
  exceptionId: string | null;         // Event id of the stored exception, if any
  rrule: string | null;               // the series rule, on occurrences
}
interface CreateSessionBody {
  date: string;                       // start; DTSTART when rrule is given
  durationMinutes: number;            // ≥ 1
  type: "In-Person" | "Online";
  category: string;
  clientId: string;
  workoutSheetId?: string; workoutSegmentId?: string;
  notes?: string; completed?: boolean;
  rrule?: string;                     // "FREQ=..." → creates a series
  timezone?: string;                  // default "America/Sao_Paulo"
}
interface UpdateSessionBody {
  date?: string; durationMinutes?: number; type?: string; category?: string;
  notes?: string; completed?: boolean; cancelled?: boolean;
  workoutSheetId?: string | null; workoutSegmentId?: string | null;
}
interface BlockView { id; title: string; rrule: string | null; timezone: string; dtstart: string; dtend: string; notes: string | null; userId: string; createdAt: string; updatedAt: string }
interface MaterializedBlock { id: string; blockId: string; title: string; start: string; end: string; isRecurring: boolean; notes: string | null }   // unchanged
```

| # | Method | Path | Access | Body | Response | Errors |
|---|---|---|---|---|---|---|
| 59 | GET | `/public/:slug/availability?start&end` | Public-by-slug | — | `200 Array<{ date: string; time: string; type: "In-Person"; available: true }>` | 400 range, 404 slug |
| 60 | POST | `/sessions` | JWT | `CreateSessionBody` | `201 SessionView` | 400, 403, 404, 409 slot taken or blocked |
| 61 | GET | `/sessions?start&end` | JWT | — | `200 SessionView[]` | 400 |
| 62 | GET | `/sessions/:id` | JWT | — | `200 SessionView` | 403, 404 |
| 63 | PATCH | `/sessions/:id` | JWT | `UpdateSessionBody` | `200 SessionView` | 400, 403, 404 |
| 64 | POST | `/sessions/:id/toggle-complete` | JWT | — | `201 SessionView` | 403, 404 |
| 65 | DELETE | `/sessions/:id` | JWT | — | `204` | 403, 404 |
| 66 | POST | `/availability-blocks` | JWT | `{ title: string; dtstart: string; dtend: string; rrule?: string; timezone?: string; notes?: string }` | `201 BlockView` | 400 |
| 67 | GET | `/availability-blocks?start&end` | JWT | — | `200 MaterializedBlock[]` | 400 |
| 68 | PATCH | `/availability-blocks/:id` | JWT | partial of the create body | `200 BlockView` | 400, 403, 404 |
| 69 | DELETE | `/availability-blocks/:id` | JWT | — | `200 BlockView` | 403, 404 |

Rules:

- **Ids.** A stored event is addressed by its UUID. An occurrence of a series is addressed by `<seriesId>_<ISO originalStartTime>` (unchanged format). `:id` in 62–65 accepts both.
- **Create.** Without `rrule`: a one-off SESSION; the conflict check runs (same rule as today: overlap with any non-cancelled session of the day, expanded series included, or with a block → `409`). With `rrule`: a series master; no conflict check (as today). `rrule` must start with `FREQ=` and must parse with `rrule` (`400` otherwise). `clientId` is checked with `ClientDirectory.requireOwned`; a sheet link with `WorkoutSheetReader.assertSegment`.
- **List.** With `start` and `end`: one-off sessions in the range, plus for each series (master `date` ≤ `end`) its occurrences in the range that have no exception, plus exceptions whose `date` is in the range and whose `status` is not CANCELLED. Without a range: one-off sessions only (current behaviour, kept for the client's initial load). Events of soft-deleted clients are excluded (`WITHOUT_DELETED_CLIENT`). `workout` is filled with one `resolveSegments` call per request.
- **Patch.** UUID of a one-off session → update it. Occurrence id → upsert the exception row on `(parentEventId, originalStartTime)` (copy the master's fields on create, then apply the body; `completed: true` → COMPLETED, `cancelled: true` → CANCELLED). UUID of a series master → `400` (editing a whole series is not supported; delete and recreate).
- **Toggle complete.** One-off: SCHEDULED ↔ COMPLETED. Occurrence: upsert the exception and flip its status the same way.
- **Delete.** One-off UUID → delete the row. Series master UUID → delete the series (exceptions cascade). Occurrence id → upsert the exception with `status` CANCELLED.
- **Blocks.** Stored as `type` BLOCK: `date` = `dtstart`, `durationMinutes` = `ceil((dtend − dtstart) / 60 000)`, which must be ≥ 1 (`400` otherwise). `BlockView.dtend` = `date + durationMinutes`. `:id` in 68–69 is the stored block's UUID (`MaterializedBlock.blockId`). Materialisation is unchanged.
- **Public availability.** Same slot algorithm as today, for the trainer behind `:slug`; work hours from `UserDirectory.getSettings`. `start` defaults to today, `end` to `start + 30 days`; a range longer than 92 days is `400`. The `TRAINER_USER_ID` variable is gone.
- **Malformed stored rule.** Rules are validated on write. If expansion still throws on read, log `Logger.error` with the event id and the rule and leave that series out of the response; never a silent `continue`.
- `src/utils/rrule-expander.ts` moves into the module.

### 6.5 health — 10 endpoints

```ts
interface EvaluationView {                  // flat, as today
  id: string; clientId: string; date: string;
  weight: number; height?: number; bodyFatPercentage?: number; leanMass?: number; fatMass?: number; bodyDensity?: number;
  protocol?: string; equation?: string; notes?: string;
  perimeters?: Perimeters; skinfolds?: Skinfolds;
  client?: { name: string; avatar: string | null };   // on GET
  createdAt: string; updatedAt: string;
}
type CreateEvaluationBody = { clientId: string; date: string } & PhysicalEvaluationMetrics;
interface AnamnesisView {                   // flat, as today's AnamnesisRecord
  id: string; clientId: string;
  status: "PENDING" | "EXPIRED" | "SUBMITTED";
  isCurrent: boolean;                       // the SUBMITTED one with the latest date
  tokenUsed: boolean;                       // status === "SUBMITTED"
  date: string; createdAt: string;
  medicalHistory?: string; injuriesAndPain?: string; routineAndSchedule?: string;
  fitnessGoals?: string; experienceLevel?: string; parqAnswers?: Record<string, boolean>;
  frontPhotoUrl?: string; backPhotoUrl?: string; sidePhotoUrl?: string;
  weightKg?: number; measurements?: Record<string, number>;
}
```

| # | Method | Path | Access | Body | Response | Errors |
|---|---|---|---|---|---|---|
| 70 | POST | `/evaluations` | JWT | `CreateEvaluationBody` | `201 EvaluationView` | 400, 403, 404 |
| 71 | GET | `/evaluations` | JWT | — | `200 EvaluationView[]` (by `date` desc) | |
| 72 | GET | `/evaluations/:id` | JWT | — | `200 EvaluationView` | 403, 404 |
| 73 | PATCH | `/evaluations/:id` | JWT | `Partial<Omit<CreateEvaluationBody, "clientId">>` | `200 EvaluationView` | 400, 403, 404 |
| 74 | DELETE | `/evaluations/:id` | JWT | — | `204` | 403, 404 |
| 75 | GET | `/anamnesis/form?token` | Magic token | — | `200 { studentName: string; personalName: string; theme: { primaryColor: string; logoUrl: string \| null } }` | 401, 404 |
| 76 | POST | `/anamnesis/submit` | Magic token | `{ token: string } & AnamnesisAnswers` | `200 { message: string; id: string }` | 400, 401, 404 |
| 77 | GET | `/anamnesis/student/:id` | JWT | — | `200 AnamnesisView[]` (newest first) | 403, 404 |
| 78 | POST | `/anamnesis/student/:id/magic-link` | JWT | — | `201 { token: string; link: string }` | 403, 404 |
| 79 | POST | `/anamnesis/student/:id/request-reassessment` | JWT | — | `201 { message: string; token: string; link: string; notification: { status: "QUEUED"; jobId: string; scheduledDelayMs: number } }` | 403, 404, 503 queue down |

Rules:

- **Evaluations** are `Assessment` rows of type PHYSICAL_EVALUATION; `userId` = the trainer, `date` from the body, metrics in `data`. The view flattens `data`. Lists exclude soft-deleted clients (`OF_LIVE_CLIENT`). The body-composition calculator (`EvaluationsCalculatorService`) and its inputs are unchanged, including the defaults it uses today (see section 12).
- **Magic token** — 32 random bytes, hex (`crypto.randomBytes`), stored in `Assessment.magicToken`; `tokenExpiresAt` = now + 7 days. Link: `${FRONTEND_URL}/#/anamnesis?token=${token}` (same base-URL fallback chain as the workout link). It is no longer a JWT.
- **`magic-link`** creates a pending ANAMNESIS (`data` = `EMPTY_ANAMNESIS_DATA`) and returns the link without sending anything. **`request-reassessment`** does the same and enqueues `WELCOME_ANAMNESIS` with key `buildIdempotencyKey(["WELCOME_ANAMNESIS", assessmentId])`. Both are implemented by one method, which is also what `ANAMNESIS_REQUESTER.requestAnamnesis` exposes to crm.
- **Status** — `magicToken` null → SUBMITTED; else `tokenExpiresAt` in the past → EXPIRED; else PENDING.
- **Form / submit token check** — no row with that `magicToken`, or expired → `401` "Link de anamnese inválido, expirado ou já utilizado." Client missing or soft-deleted → `404`. Branding for the form comes from `UserDirectory.getProfile`.
- **Submit** — one transaction: claim the row with `updateMany({ where: { id, magicToken: token }, data: { data, date: now, magicToken: null, tokenExpiresAt: null } })` and require `count === 1` (a concurrent second submit gets `401`); when `weightKg` is present, create a PHYSICAL_EVALUATION with `weight` = `weightKg`, `perimeters` = the entries of `measurements` whose key is a `PerimetersDto` key, `notes` = "Anamnese inicial preenchida pelo aluno".

### 6.6 messaging — 9 endpoints

```ts
interface NotificationLogView {
  id: string; userId: string; clientId: string | null; jobId: string | null;
  recipientPhone: string; templateType: string;
  status: "SENT" | "FAILED" | "CANCELLED";
  channel: "WHATSAPP" | "EMAIL";
  error: string | null; createdAt: string; updatedAt: string;
}
interface PendingNotificationView {
  jobId: string; templateType: string; recipientPhone: string; clientId: string | null;
  state: "waiting" | "delayed" | "active";
  scheduledFor: string | null;              // when a delayed job becomes due
  attemptsMade: number; requestedAt: string;
}
```

| # | Method | Path | Access | Body | Response | Errors |
|---|---|---|---|---|---|---|
| 80 | GET | `/messaging/logs?status&channel&search&page&limit` | JWT | — | `200 Paginated<NotificationLogView> & { summary: { totalSent: number; totalFailed: number; totalCancelled: number; totalPending: number } }` | 400 |
| 81 | GET | `/messaging/pending` | JWT | — | `200 PendingNotificationView[]` | 503 |
| 82 | POST | `/messaging/pending/flush` | JWT | — | `200 { promotedCount: number; message: string }` | 503 |
| 83 | DELETE | `/messaging/pending/:jobId` | JWT | — | `200 { message: string; notification: NotificationLogView }` | 404, 409 already sending, 503 |
| 84 | GET | `/clients/:id/messages` | JWT | — | `200 NotificationLogView[]` (newest first) | |
| 85 | POST | `/whatsapp/connect` | JWT | — | `200 { instanceName: string; qrcodeBase64: string; status: WhatsappStatus }` | 502, 503 |
| 86 | GET | `/whatsapp/status` | JWT | — | `200 { instanceName: string \| null; status: WhatsappStatus }` | |
| 87 | POST | `/whatsapp/disconnect` | JWT | — | `200 { success: true; status: WhatsappStatus; instanceName: string \| null }` | 502 |
| 88 | POST | `/whatsapp/test-message` | JWT | `{ phone: string; message: string }` | `200 { success: true; messageId: string }` | 400 |

Behaviour: [section 9](#9-messaging).

---

## 7. Soft delete

`Client` is the only soft-deleted model. `deletedAt IS NULL` means visible.

**`DELETE /clients/:id`** — after the ownership check, one update: `deletedAt = now()`, `subscriptionStatus = CANCELED`. Nothing else is touched: `planId`, payments, events, sheets, assessments and sessions stay. Response `204`. A second call is `404`.

**Queries that must filter**

| Where | Filter |
|---|---|
| Every crm query on `Client` (list, leads, detail, export, update, convert, status, payments, avatar URL) | `NOT_DELETED` |
| `ClientDirectory` (all four methods) | `NOT_DELETED` — a deleted client does not exist for the other modules |
| `Plan._count.clients`, admin `studentsCount` | count live clients only |
| calendar: range list, single read, conflict check, public availability | `WITHOUT_DELETED_CLIENT` |
| health: `GET /evaluations` | `OF_LIVE_CLIENT` |
| workouts: expiring sheets | `OF_LIVE_CLIENT` |
| Any `/clients/:id/...` or `/anamnesis/student/:id...` route | `404` through `ClientDirectory.requireOwned` |
| Magic-token routes (portal, anamnesis form/submit) | `404` through `ClientDirectory.findById` |

Not filtered: `Payment` rows (they exist for the trainer's financial history) and `NotificationLog` rows.

**The two writes that look at deleted rows** (both in crm, both on the `(email, userId)` key, e-mail lower-cased):

1. *Lead form* — `POST /public/:slug/leads`, in a transaction:
   - `updateMany({ where: { userId, email, deletedAt: { not: null } }, data: { deletedAt: null, status: LEAD, name, phone, modality, notes, planId: null, subscriptionStatus: null, currentPeriodEnd: null } })`. `count === 1` → the client is resurrected with its history; respond `201 { id }`.
   - Otherwise `create`. `P2002` → the e-mail belongs to a live client → `409` (current behaviour; a public form never changes a live client).
2. *Trainer creates a client* — `POST /clients` applies the same resurrection with the body's values (`status` from the body) before falling back to `create`; `P2002` → `409 Email already exists`.

`PATCH /clients/:id` that changes the e-mail to one held by any other row of the trainer (live or deleted) → `409`.

---

## 8. Auth and client-v2

The API keeps its current model: one stateless access token (HS256, 24 h, payload `{ sub, username, role }`), no refresh token, no cookie, no server-side session. Refresh-token rotation is **not** part of this change.

The smallest change that lets `app-personal-manager-client-v2` talk to this API is: additive fields on the login response, and alias paths on four existing handlers.

| client-v2 call (`httpAuthGateway.ts`, `tokenRefresher.ts`) | This API | What client-v2 must adapt |
|---|---|---|
| `POST /auth/login` → `{ accessToken, tokenType, expiresIn }` | **Exists.** `LoginResponse` carries `accessToken`, `tokenType: "Bearer"`, `expiresIn: 86400` next to the legacy `access_token` and `user`. | Nothing for the token. |
| `GET /users/me` → `User` | **Aliased** to `GET /auth/me`; returns `UserView`. | Domain `User` type: `role` is `"admin" \| "trainer"` (not `SUPER_ADMIN`/`TENANT_ADMIN`/`USER`); there is no `tenantId`, `lastLoginAt` or `anonymizedAt`. |
| `POST /auth/logout` | **Exists**, requires the bearer token; `200 { message }`. | Send it with `authenticated: true`; without the header the API answers `401`. The server keeps no session, so logout only confirms. |
| `POST /auth/register` | **Aliased** to `POST /auth/signup`; body `{ name, email, password }` matches. Returns `201 LoginResponse`. | `SIGN_UP_UNAVAILABLE` no longer triggers. Password minimum is 6 here (8 on reset). |
| `POST /auth/password-reset/request` | **Aliased** to `POST /auth/forgot-password`; body `{ email }` matches. | Nothing. |
| `POST /auth/password-reset/confirm` | **Aliased** to `POST /auth/reset-password`; body `{ token, password }` matches; password min 8. | Nothing. |
| `POST /auth/refresh` (cookie rotation) | **Unavailable** — `404`. | `restoreSession()` must treat the missing endpoint as "no session" (today only `401` means that; a `404` propagates as an unknown failure). Since the access token lives in memory only, a page reload requires a new login until a refresh flow is designed. The automatic refresh-and-retry on `401` must be switched off or made to fail closed. |
| Error envelope `{ error: { code, details } }` | **Different** — NestJS default `{ statusCode, message, error }`. | Every failure currently maps to `UNEXPECTED_RESPONSE`. Map by HTTP status instead: `401` login → invalid credentials, `409` sign-up → e-mail in use, `400` reset → invalid/expired token. |
| Same-origin `/api` via proxy | Works. The API also keeps permissive CORS. | Nothing. |
| `Retry-After` / rate limiting | Not implemented. | No `429` will ever arrive. |

Aliases are implemented as a path array on the same handler (`@Post(["signup", "register"])`), not as separate code.

---

## 9. Messaging

### 9.1 Flow

```
caller (health / workouts)
  └─ NotificationSender.enqueue(request)            src/common/ports/notification-sender.port.ts
       ├─ dnd = UserDirectory.getSettings(userId).dnd
       ├─ delay = bypassDnd ? 0 : calculateDndDelayMs(now, dnd)
       └─ queue.add("send", jobData, { jobId: idempotencyKey, delay, ...NOTIFICATION_JOB_OPTIONS })
worker (same process, concurrency 5)
  ├─ connection = UserDirectory.getWhatsappConnection(userId)
  ├─ text = formatMessage(templateType, params)
  ├─ WhatsAppService.sendTextMessage(instanceName, phone, text)    throws typed errors
  └─ final outcome → exactly one NotificationLog row (jobId = idempotencyKey)
```

Nothing is written to `NotificationLog` at enqueue time. The table is an audit trail of finished jobs.

### 9.2 Queue and job

| | |
|---|---|
| Queue name | `notifications` (`NOTIFICATIONS_QUEUE`) |
| Job name | `send` (`SEND_NOTIFICATION_JOB`) |
| Connection | `REDIS_URL` (required; the app fails to start without it) |
| Registration | `MessagingModule` imports `BullModule.forRootAsync(...)` and `BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })` (`@nestjs/bullmq` 10, `bullmq` 5 — already installed) |

```ts
interface NotificationJobData {              // src/common/types/notification-job.ts
  version: 1;
  idempotencyKey: string;
  userId: string;
  clientId: string | null;
  recipientPhone: string;
  channel: "WHATSAPP";
  templateType: "WELCOME_ANAMNESIS" | "WORKOUT_LINK" | "EXPIRATION_ALERT";
  params: { name: string; link?: string };
  requestedAt: string;
}
```

The payload carries everything the message needs (name, link), so a retry sends the same text. Templates are the three strings in today's `formatMessage`.

### 9.3 Idempotency

- The caller builds the key with `buildIdempotencyKey(parts)` (40 hex chars; BullMQ forbids `:` in job ids).
- The key is the BullMQ `jobId`: adding a job whose id already exists is a no-op, and `enqueue` returns `status: "DUPLICATE"`. Completed jobs are kept 24 h, failed ones 7 days, so the window is at least 24 h.
- The key is `NotificationLog.jobId` (unique). The worker inserts the audit row and treats `P2002` as "already recorded" — a job re-delivered after a crash cannot produce a second row.

| Message | Key parts |
|---|---|
| Anamnesis request / welcome | `["WELCOME_ANAMNESIS", assessmentId]` |
| Workout link | `["WORKOUT_LINK", clientId, activeSheetId ?? "none", UTC minute]` |

### 9.4 Retry policy

`NOTIFICATION_JOB_OPTIONS`: 5 attempts, exponential backoff from 30 s (waits 30 s, 60 s, 120 s, 240 s).

`WhatsAppService` throws these (classes in `notification-job.ts`); it no longer returns `{ success: false }`:

| Error | Raised when | Retried | Extra effect |
|---|---|---|---|
| `WhatsAppTransientError` | timeout (`AbortError` / `TimeoutError`), network error, HTTP 429, HTTP 5xx | yes, up to 5 attempts | — |
| `WhatsAppNotConnectedError` | the user's `whatsappStatus` is not CONNECTED or there is no instance name | no | — |
| `WhatsAppInstanceError` | provider HTTP 400 / 401 / 404 (instance missing or logged out) | no | `UserDirectory.setWhatsappConnection(userId, { status: DISCONNECTED })` |
| `InvalidRecipientError` | empty or malformed phone | no | — |

Non-retryable errors are rethrown as BullMQ `UnrecoverableError` so the job fails on the spot. Any other exception is a bug: it is logged with its stack and follows the default retry path.

**After the last attempt** (or an unrecoverable error) the worker writes one row: `status` FAILED, `error` = `error.toLogEntry()` (e.g. `WHATSAPP_TRANSIENT (HTTP 503): upstream unavailable`), `channel` WHATSAPP, and logs `Logger.error` with job id, user id, template, attempts made and the HTTP status. On success it writes `status` SENT, `error` null.

There is no e-mail fallback: see section 12, item A9.

### 9.5 Tenant concepts on User

| Was | Is |
|---|---|
| `Tenant.features.dndEnabled / dndStartHour / dndEndHour / dndTimezone` (flat or nested `dnd`) | `User.settings.dnd` (`DndConfig`), edited with `PATCH /settings/dnd`, read through `UserDirectory.getSettings` |
| `Tenant.whatsappInstanceName`, `Tenant.whatsappStatus` | `User.whatsappInstanceName`, `User.whatsappStatus`, read and written through `UserDirectory.get/setWhatsappConnection` |
| Instance name `tenant-<tenantId[0..8]>` | `user-<userId[0..8]>` |
| `NotificationLog.tenantId` | `NotificationLog.userId` (required) |
| `Tenant.features.whatsappAlerts` | `User.settings.limits.whatsappAlerts` (stored, not enforced — as before) |

`calculateDndDelayMs` keeps its algorithm. The do-not-disturb window is applied once, as the job's `delay`; the worker does not check it again, which is what makes "send now" possible.

### 9.6 Endpoint behaviour

- **`GET /messaging/logs`** — the caller's audit rows, filters as today (`status` ∈ ALL / SENT / FAILED / CANCELLED, `channel`, `search` over phone, template, error). `summary.totalPending` is the size of the caller's pending list.
- **`GET /messaging/pending`** — the caller's jobs in `waiting`, `delayed` or `active`, read from BullMQ (`queue.getJobs`, newest 1000) and filtered by `data.userId`.
- **`POST /messaging/pending/flush`** — promotes the caller's `delayed` jobs (`job.promote()`), i.e. sends now despite do-not-disturb. Replaces "process queue (force)".
- **`DELETE /messaging/pending/:jobId`** — the job must belong to the caller (`404` otherwise). `active` → `409`. Otherwise remove it and write an audit row `status` CANCELLED, `error` "Cancelado manualmente pelo treinador.".
- **`GET /clients/:id/messages`** — audit rows with `userId` = caller and `clientId` = `:id`. An unknown or foreign id yields `[]`; the `userId` filter is the access control, so messaging does not depend on crm.
- **`POST /whatsapp/connect`** — instance name = stored one or `user-<id[0..8]>`; create the instance on Evolution API, fetch the QR, then `setWhatsappConnection(userId, { instanceName, status: PENDING })`. `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` missing → `503`; a provider failure → `502` with the upstream status logged. The offline placeholder QR code is removed.
- **`GET /whatsapp/status`** — live check against the provider; when it differs from the stored status, update through `setWhatsappConnection`. If the live check fails, log `Logger.warn` with the cause and return the stored status (graceful degradation, visible in logs).
- **`POST /whatsapp/disconnect`** — disconnect on the provider, then store DISCONNECTED.
- **`POST /whatsapp/test-message`** — direct send, not queued and not logged; a delivery error becomes `400` with the provider's message (as today).

---

## 10. Old route → new route

All 111 current endpoints. The nine tenant routes also answered under `/tenant/*`; both prefixes are gone.

| # | Old | New | Change |
|---|---|---|---|
| 1 | POST `/auth/login` | POST `/auth/login` | kept — response gains `accessToken`, `tokenType`, `expiresIn`; `user.tenant` is gone |
| 2 | POST `/auth/logout` | same | kept |
| 3 | POST `/auth/signup` | same (+ alias `/auth/register`) | kept — returns `LoginResponse`; `role` rejected |
| 4 | GET `/auth/me` | same (+ alias `/users/me`) | kept — `UserView` |
| 5 | POST `/auth/forgot-password` | same (+ alias `/auth/password-reset/request`) | kept |
| 6 | POST `/auth/reset-password` | same (+ alias `/auth/password-reset/confirm`) | kept |
| 7 | POST `/users` | POST `/auth/signup` | merged (was an unguarded duplicate) |
| 8 | GET `/users` | GET `/admin/users` | renamed, now Admin |
| 9 | GET `/users/:id` | GET `/admin/users/:id` | renamed, now Admin |
| 10 | PATCH `/users/:id` | PATCH `/admin/users/:id` | renamed, now Admin; body limited to `status`, `limits` |
| 11 | DELETE `/users/:id` | DELETE `/admin/users/:id` | renamed, now Admin |
| 12 | PATCH `/users/profile` | same | kept — accepts `slug`; `role` rejected |
| 13 | POST `/users/avatar-upload-url` | same | kept |
| 14 | GET `/tenants/me` | GET `/auth/me` | merged |
| 15 | PATCH `/tenants/branding` | PATCH `/users/branding` | renamed — returns `UserView` |
| 16 | PATCH `/tenants/dnd-settings` | PATCH `/settings/dnd` | renamed — body keys `enabled`, `startHour`, `endHour`, `timezone` |
| 17 | POST `/tenants/setup/connect-whatsapp` | POST `/whatsapp/connect` | merged |
| 18 | POST `/tenants/whatsapp/connect` | POST `/whatsapp/connect` | renamed |
| 19 | GET `/tenants/whatsapp/status` | GET `/whatsapp/status` | renamed |
| 20 | POST `/tenants/whatsapp/disconnect` | POST `/whatsapp/disconnect` | renamed |
| 21 | POST `/tenants/whatsapp/test-message` | POST `/whatsapp/test-message` | renamed |
| 22 | POST `/tenants/setup/complete` | POST `/users/setup/complete` | renamed — returns `{ success, user }` |
| 23 | GET `/admin/tenants` | GET `/admin/users` | renamed — `AdminUserView` |
| 24 | POST `/admin/tenants` | — | removed (it created a tenant with no user) |
| 25 | PATCH `/admin/tenants/:id` | PATCH `/admin/users/:id` | renamed — `features` → `limits` |
| 26 | GET `/settings/ai-instructions` | same | kept |
| 27 | PUT `/settings/ai-instructions` | same | kept — returns `{ instructions }` |
| 28 | GET `/settings/language` | same | kept |
| 29 | PATCH `/settings/language` | same | kept |
| 30 | GET `/settings/work-hours` | same | kept |
| 31 | PUT `/settings/work-hours` | same | kept — `start`/`end` must be `HH:mm` |
| 32 | POST `/clients` | same | kept — adds `welcomeMessage`; resurrects a deleted client |
| 33 | GET `/clients` | same | kept — now paginated (`Paginated<ClientListItem>`) |
| 34 | GET `/clients/leads` | same | kept |
| 35 | GET `/clients/:id` | same | kept — embeds `plan`, `payments`; no sheets/anamneses |
| 36 | PATCH `/clients/:id` | same | kept — aliases `type`, `subscriptionStatus` removed |
| 37 | PATCH `/clients/:id/convert` | same | kept |
| 38 | POST `/clients/:id/avatar-upload-url` | same | kept |
| 39 | DELETE `/clients/:id` | same | kept — soft delete |
| 40 | POST `/students` | POST `/clients` | merged |
| 41 | GET `/students` | GET `/clients` | merged |
| 42 | GET `/students/export/csv` | GET `/clients/export/csv` | renamed |
| 43 | GET `/students/expiring-sheets` | GET `/workout-sheets/expiring` | renamed — `ExpiringSheetView[]` |
| 44 | GET `/students/:id` | GET `/clients/:id` | merged |
| 45 | PATCH `/students/:id` | PATCH `/clients/:id` | merged |
| 46 | POST `/students/:id/manual-payment` | POST `/clients/:id/payments` | renamed — body `{ amount, method, periodEnd, notes? }` |
| 47 | PATCH `/students/:id/status` | PATCH `/clients/:id/status` | renamed |
| 48 | POST `/students/:id/request-reassessment` | POST `/anamnesis/student/:id/request-reassessment` | merged |
| 49 | GET `/students/:id/activity-heatmap` | GET `/clients/:id/activity-heatmap` | renamed |
| 50 | DELETE `/students/:id` | DELETE `/clients/:id` | merged |
| 51 | POST `/leads` | POST `/public/:slug/leads` | renamed — by slug; returns `{ id }`; resurrects |
| 52 | GET `/plans/public/:trainerId` | GET `/public/:slug/plans` | renamed — by slug |
| 53 | POST `/plans` | same | kept — `featureIds` → `features` |
| 54 | GET `/plans` | same | kept — `features: string[]` |
| 55 | GET `/plans/:id` | same | kept |
| 56 | PATCH `/plans/:id` | same | kept |
| 57 | DELETE `/plans/:id` | same | kept |
| 58 | GET `/system-features/active` | GET `/plan-features` | renamed — catalogue from code |
| 59 | POST `/system-features` | — | removed |
| 60 | GET `/system-features` | GET `/plan-features` | merged |
| 61 | GET `/system-features/:id` | — | removed |
| 62 | PATCH `/system-features/:id` | — | removed |
| 63 | DELETE `/system-features/:id` | — | removed |
| 64 | GET `/sessions/available` | GET `/public/:slug/availability` | renamed — by slug |
| 65 | POST `/sessions` | same | kept — `linkedWorkoutId` → `workoutSheetId` + `workoutSegmentId`; optional `rrule` |
| 66 | POST `/sessions/recurring-event` | POST `/sessions` | merged — `dtstart` → `date` |
| 67 | DELETE `/sessions/recurring-event/:id` | DELETE `/sessions/:id` | merged — series id deletes the series |
| 68 | PATCH `/sessions/exception` | PATCH `/sessions/:id` | merged — occurrence id in the path |
| 69 | GET `/sessions` | same | kept — `SessionView` |
| 70 | GET `/sessions/:id` | same | kept |
| 71 | PATCH `/sessions/:id` | same | kept — accepts occurrence ids |
| 72 | PATCH `/sessions/:id/scope` | — | removed (see A12) |
| 73 | POST `/sessions/:id/toggle-complete` | same | kept |
| 74 | DELETE `/sessions/:id` | same | kept |
| 75 | POST `/availability-blocks` | same | kept |
| 76 | GET `/availability-blocks` | same | kept |
| 77 | PATCH `/availability-blocks/:id` | same | kept |
| 78 | DELETE `/availability-blocks/:id` | same | kept |
| 79 | POST `/evaluations` | same | kept |
| 80 | GET `/evaluations` | same | kept |
| 81 | GET `/evaluations/:id` | same | kept — `client` is `{ name, avatar }` |
| 82 | PATCH `/evaluations/:id` | same | kept |
| 83 | DELETE `/evaluations/:id` | same | kept |
| 84 | GET `/anamnesis/form` | same | kept — opaque token |
| 85 | POST `/anamnesis/submit` | same | kept |
| 86 | GET `/anamnesis/student/:id` | same | kept — `AnamnesisView` |
| 87 | POST `/anamnesis/student/:id/magic-link` | same | kept |
| 88 | POST `/anamnesis/student/:id/request-reassessment` | same | kept — really sends; adds `notification` |
| 89 | GET `/exercises` | same | kept — global rows from the database |
| 90 | POST `/exercises` | same | kept |
| 91 | POST `/students/:id/workout-sheets` | POST `/clients/:id/workout-sheets` | renamed |
| 92 | GET `/students/:id/workout-sheets` | GET `/clients/:id/workout-sheets` | renamed |
| 93 | GET `/workout-sheets/:id` | same | kept — also serves templates |
| 94 | GET `/workout-templates` | same | kept — `WorkoutSheetView[]` |
| 95 | POST `/workout-templates/from-sheet/:sheetId` | same | kept |
| 96 | GET `/workouts` | GET `/workout-templates` | merged |
| 97 | GET `/workouts/:id` | GET `/workout-sheets/:id` | merged |
| 98 | POST `/workouts` | POST `/workout-templates` | renamed — structured body |
| 99 | PATCH `/workouts/:id` | PATCH `/workout-sheets/:id` | renamed |
| 100 | DELETE `/workouts/:id` | DELETE `/workout-sheets/:id` | renamed |
| 101 | POST `/students/:id/magic-link` | POST `/clients/:id/magic-link` | renamed |
| 102 | GET `/student/workout-sheet` | same | kept |
| 103 | POST `/student/sessions` | same | kept |
| 104 | GET `/messaging/queue` | GET `/messaging/logs` (+ GET `/messaging/pending`) | renamed and split |
| 105 | POST `/messaging/queue/process` | POST `/messaging/pending/flush` | renamed — the worker sends by itself; this only overrides do-not-disturb |
| 106 | POST `/messaging/queue/:id/retry` | — | removed (retries are automatic; see A10) |
| 107 | DELETE `/messaging/queue/:id` | DELETE `/messaging/pending/:jobId` | renamed |
| 108 | POST `/students/:id/resend-link` | `type: "ANAMNESIS"` → POST `/anamnesis/student/:id/request-reassessment`; `type: "WORKOUT_SHEET"` → POST `/clients/:id/magic-link/send` | split and merged |
| 109 | GET `/students/:id/messages` | GET `/clients/:id/messages` | renamed — matched by `clientId` |
| 110 | POST `/ai/workout-plan` | same | kept — now JWT |
| 111 | POST `/ai/workout-insights` | same | kept — now JWT |

Totals: 56 kept (same path; shape changes noted), 32 renamed (one of them also split in two), 15 merged into another route, 1 split, 7 removed.

---

## 11. Work streams

Six backend streams, one per module, run in parallel. Each owns a disjoint set of paths.

**Rules for every stream**

- Edit only the paths you own. `src/common/**`, `src/modules/prisma/**`, `src/modules/gcs/**`, `src/modules/mailer/**`, `prisma/**`, `src/modules/app.module.ts`, `src/main.ts`, `package.json`, `package-lock.json`, `test/**`, `.env.example`, compose files and `README.md` belong to the integrator.
- If you need something in a shared file (a seed row, an env variable, a dependency, a module import, an e2e scenario, a change to a port), write it in `docs/integration-notes/<stream>.md`. Do not edit the shared file.
- Delete the old directories you absorb; port their specs first (TDD: port the spec, watch it fail, implement).
- Mock ports by token; never import another stream's service class.
- `npx jest src/modules/<your-module>` and `npx eslint "src/modules/<your-module>/**/*.ts"` must pass. The whole project compiles only after all six streams and the integrator are done.
- Do not commit; the integrator commits.

### Stream 1 — identity

| | |
|---|---|
| Owns | `src/modules/identity/**` |
| Deletes | `src/modules/auth/`, `users/`, `tenants/`, `admin/`, `settings/`, `src/types/global.ts` |
| Provides | `USER_DIRECTORY`; registers `PassportModule`, `JwtModule.registerAsync(jwtModuleAsyncOptions)` and `JwtStrategy` |
| Consumes | `CLIENT_DIRECTORY.countByOwners` (admin list); `GcsService`; `MailerService` |
| Endpoints | 1–21 |
| Specs to port | `auth/auth-login.dto.spec.ts`, `auth/auth.controller.spec.ts`, `auth/auth.service.spec.ts`, `auth/dto/forgot-password.dto.spec.ts`, `auth/dto/reset-password.dto.spec.ts`, `users/create-user.dto.spec.ts`, `users/users.service.spec.ts`, `tenants/dto/branding.dto.spec.ts`, `tenants/dto/dnd-settings.dto.spec.ts`, the branding / DND / setup cases of `tenants/tenants.controller.spec.ts` and `tenants/tenants.service.spec.ts`, `admin/admin-tenants.service.spec.ts`, `settings/settings.controller.spec.ts`, `settings/settings.dto.spec.ts`, `settings/settings.service.spec.ts`. `auth/roles.guard.spec.ts` is already ported to `src/common/auth/` — delete the old one. |
| New tests required | sign-up rejects `role`; profile rejects `role`; slug generation and collision retry; alias paths resolve to the same handler; `/admin/users*` answer `403` to a trainer and `401` without a token |

### Stream 2 — crm

| | |
|---|---|
| Owns | `src/modules/crm/**` (including `client-directory.module.ts`) |
| Deletes | `src/modules/clients/`, `leads/`, `plans/`, `system-features/` |
| Provides | `CLIENT_DIRECTORY` (from `ClientDirectoryModule`, which imports nothing but relies on the global `PrismaService`) |
| Consumes | `USER_DIRECTORY.requireBySlug`; `WORKOUT_SHEET_READER.findActiveSummaries`; `ANAMNESIS_REQUESTER.requestAnamnesis`; `GcsService` |
| Endpoints | 22–40 |
| Shared code it applies | `PlanFeatureKey` validation and `GET /plan-features` |
| Specs to port | `clients/clients-create.dto.spec.ts`, `clients/clients.controller.spec.ts`, `clients/students.controller.spec.ts`, `clients/clients.service.spec.ts` (except heatmap and expiring-sheets cases → workouts), `clients/convert-lead.dto.spec.ts`, `clients/student-query.dto.spec.ts`, `leads/create-lead.dto.spec.ts`, `leads/leads.service.spec.ts`, `plans/plans-create.dto.spec.ts`, `plans/plans.service.spec.ts`, `system-features/feature-check.service.spec.ts`. `system-features/system-features.service.spec.ts` is dropped with the table. |
| New tests required | soft delete hides the client everywhere; lead resurrection; `409` for a live client's e-mail; welcome message `QUEUED` / `SKIPPED` / `FAILED`; payment transaction; `ClientDirectory` treats deleted clients as missing |

### Stream 3 — workouts

| | |
|---|---|
| Owns | `src/modules/workouts/**`, `src/modules/ai/**` |
| Deletes | `src/modules/workout-sheets/`, `exercises/`, `student-portal/` |
| Provides | `WORKOUT_SHEET_READER` |
| Consumes | `CLIENT_DIRECTORY`; `USER_DIRECTORY.getProfile`; `NOTIFICATION_SENDER.enqueue` |
| Endpoints | 41–58 |
| Shared code it applies | JWT guard on the two AI endpoints |
| Specs to port | `workout-sheets/workout-sheets.service.spec.ts`, `exercises/exercises.service.spec.ts`, `student-portal/student-portal.service.spec.ts`, the heatmap and expiring-sheets cases of `clients/clients.service.spec.ts`; `ai/ai.service.spec.ts` stays as is |
| New tests required | exercise search does not leak other trainers' rows (regression); one active sheet per client; PATCH keeps ids; portal status guards; `executionData` built with `buildExecutionData`; AI endpoints `401` without a token |

### Stream 4 — calendar

| | |
|---|---|
| Owns | `src/modules/calendar/**`, `src/utils/rrule-expander.ts` (move it into the module and delete `src/utils/`) |
| Deletes | `src/modules/sessions/`, `availability-blocks/` |
| Provides | — |
| Consumes | `CLIENT_DIRECTORY.requireOwned`; `WORKOUT_SHEET_READER.assertSegment` / `resolveSegments`; `USER_DIRECTORY.requireBySlug` / `getSettings` |
| Endpoints | 59–69 |
| Specs to port | `sessions/sessions-rrule.dto.spec.ts`, `sessions/sessions.dto.spec.ts`, `sessions/sessions.controller.spec.ts`, `sessions/sessions.service.spec.ts`, `availability-blocks/availability-blocks.service.spec.ts` |
| New tests required | exception upsert on `(parentEventId, originalStartTime)`; an occurrence moved across the range boundary appears once, in the right range; cancelled occurrence disappears; deleting a series; block `dtend` round-trip; sessions of soft-deleted clients are hidden and do not conflict; unknown slug `404` |

### Stream 5 — health

| | |
|---|---|
| Owns | `src/modules/health/**` |
| Deletes | `src/modules/evaluations/`, `anamnesis/` |
| Provides | `ANAMNESIS_REQUESTER` |
| Consumes | `CLIENT_DIRECTORY`; `USER_DIRECTORY.getProfile`; `NOTIFICATION_SENDER.enqueue` |
| Endpoints | 70–79 |
| Specs to port | `evaluations/evaluations-calculator.service.spec.ts` (moves unchanged with the service), `evaluations/evaluations.service.spec.ts`, `anamnesis/anamnesis.service.spec.ts` |
| New tests required | token is single-use under concurrency (`updateMany` count 0 → `401`); expired token; derived `isCurrent`; submit creates the evaluation only when `weightKg` is present; `request-reassessment` enqueues with the assessment-based key |

### Stream 6 — messaging

| | |
|---|---|
| Owns | `src/modules/messaging/**` |
| Deletes | old `messaging.service.ts`, `messaging.controller.ts`, DTOs and their specs as they are replaced |
| Provides | `NOTIFICATION_SENDER` |
| Consumes | `USER_DIRECTORY.getSettings` / `getWhatsappConnection` / `setWhatsappConnection` |
| Endpoints | 80–88 |
| Specs to port | `messaging/messaging.service.spec.ts` (DND delay, message templates), `messaging/messaging.controller.spec.ts`, `messaging/whatsapp.service.spec.ts`, `tenants/dto/whatsapp-test-message.dto.spec.ts`, the WhatsApp cases of `tenants/tenants.controller.spec.ts` and `tenants/tenants.service.spec.ts` |
| New tests required | each error class → retried or not; final failure writes one FAILED row; duplicate key → `DUPLICATE`; `P2002` on the audit insert is tolerated; flush promotes only the caller's jobs; cancel refuses an active job; connect without provider config → `503` |

### Then — integrator

Wires `app.module.ts`, rewrites `prisma/seed.ts`, updates e2e specs and `.env.example`, runs the full gate, commits per stream. See [section 14](#14-integrator-checklist).

---

## 12. Open questions and assumptions

Choices made where the decision record was silent. Each takes the option closest to current behaviour unless that behaviour was itself a defect; those cases say so.

| # | Topic | Assumption |
|---|---|---|
| A1 | Lead form for an e-mail that belongs to a **live** client | `409`, as today. Only soft-deleted clients are resurrected. A public form must not be able to turn an active client back into a LEAD. |
| A2 | Trainer creates a client whose e-mail belongs to a soft-deleted one | Resurrected too (same rule as the lead form). Before soft delete the e-mail would have been free, so creation succeeded. |
| A3 | What soft delete changes besides `deletedAt` | Only `subscriptionStatus = CANCELED` ("o plano é cancelado"). `planId` is kept for history. Future sessions are hidden by filter, not deleted; they come back if the client is resurrected. |
| A4 | When `subscriptionStatus` is written | ACTIVE on a recorded PAID payment, CANCELED on delete, null on lead resurrection. Nothing else sets it until a payment gateway exists. |
| A5 | `Payment.amount` | Required, as in the approved schema. It was optional on manual payments; the client app must send it. |
| A6 | Business name | `Tenant.name` is dropped; `User.name` is used wherever a trainer or business name is shown. |
| A7 | Slug editing | Allowed through `PATCH /users/profile`. Without it the public links would be stuck with the generated value. |
| A8 | Sign-up response | Returns `LoginResponse` (it returned the user without a token; the client app already expected a token). |
| A9 | **E-mail fallback** | Removed. Today, when WhatsApp is disconnected the service records `status: SENT, channel: EMAIL` without sending any e-mail. v2 records `FAILED` / `WHATSAPP_NOT_CONNECTED`. A real e-mail fallback (templates, sender) needs an owner decision. |
| A10 | Manual retry of a failed message | Removed. The old retry re-sent the template with the name "Aluno" and no link. Retries are automatic; after a final failure the trainer triggers the action again, which creates a fresh link. |
| A11 | `POST /admin/tenants` | Removed. It created a tenant with no user and ignored the e-mail it required. New accounts come from sign-up. |
| A12 | "This and following" edits (`PATCH /sessions/:id/scope`) | Removed. It only worked on eagerly-created series (`Session.recurrenceId`), which nothing creates any more, and failed with a 500 on RRULE occurrences. Editing a whole RRULE series needs its own design. |
| A13 | Evaluation created from an anamnesis | Only when `weightKg` is given. Today a missing weight is stored as 70 kg; v2 does not invent a weight. |
| A14 | Calculator inputs | Unchanged: gender is always "M" and age falls back to 30 when the client has no birth date. `Client` has no gender field; fixing this needs a schema decision. |
| A15 | WhatsApp connect without provider configuration | `503` instead of a placeholder QR code that cannot connect anything. |
| A16 | Public availability range | Capped at 92 days per request (technical limit on an unauthenticated endpoint). |
| A17 | Blocked accounts and public routes | `User.status` BLOCKED/OVERDUE blocks the student portal only (as `Tenant.status` did). Public lead, plan and availability routes still answer. |
| A18 | Global exercises | Created by the seed only. There is no admin endpoint for the global catalogue yet. |
| A19 | Lifecycle gaps (finding #10) | Sheets gain edit and delete because templates already had them on the same table. Exercises still have only list and create; payments have no delete. |
| A20 | Feature gating (finding #9) | Not enforced. `clientHasFeature` is ported but still has no caller. |
| A21 | `calendar_default_view`, `ai_prompt` settings in the old seed | Not in `UserSettings`: no code reads them (the service key is `ai_prompt_instructions`). The new seed writes `aiInstructions`. |
| A22 | Password length | Sign-up and profile keep minimum 6; reset keeps minimum 8 (existing inconsistency, not changed). |
| A23 | JWT secret | The development fallback secret is refused when `NODE_ENV=production` (`resolveJwtSecret`). |

Not verified / needs a decision outside this change:

- **Monitoring notifications.** The engineering rules ask for failures to reach a monitoring channel (e.g. Discord). This API has none; v2 logs with `Logger.error`. Adding a channel is a separate task.
- **Rate limiting** on public routes (leads, login) does not exist and is not added here.
- **`StorageModule`.** `app.module.ts` imports `./storage/storage.module`, which is not in the repository (the build was already failing on it), and the client app calls `POST /storage/presigned-url`, which no controller serves. The integrator removes the import; logo upload needs its own decision.
- **Partial index and Prisma drift.** The hand-written partial index and check constraints were not run against a database in this step (the dev database must not be touched). The integrator applies the baseline to a scratch database and confirms `prisma migrate diff --from-migrations … --to-schema …` reports no drift.

---

## 13. Frontend impact

### 13.1 `app-personal-manager-client` (React 19 + Zustand)

Grouped by file under `src/services/api/`. "Type" refers to `src/types.ts`.

| File | What changes |
|---|---|
| `authApi.ts` | `login`: response unchanged for the fields it reads (`access_token`, `user`), but `user.tenant` no longer exists. `signup`: now really returns `{ user, access_token }` (status 201). `getCurrentUser`: returns `UserView`. Forgot/reset unchanged. |
| `userApi.ts` | `updateUserProfile` returns `UserView` (may send `slug`). Avatar URL unchanged. |
| `tenantApi.ts` | Every route moves. `getMyTenant` → `GET /auth/me`. `updateTenantBranding` → `PATCH /users/branding` (returns `UserView`). `connectTenantWhatsapp` → `POST /whatsapp/connect`. `getTenantWhatsappStatus` → `GET /whatsapp/status`. `disconnectTenantWhatsapp` → `POST /whatsapp/disconnect`. `sendTestTenantWhatsappMessage` → `POST /whatsapp/test-message`. `completeTenantSetup` → `POST /users/setup/complete`, response `{ success, user }`. Payload shapes of the WhatsApp calls are unchanged. The `tenantSlice`, `SetupWizard`, `App.tsx`, `Login.tsx` and `SignUp.tsx` read `user.tenant.*`; they must read the same fields from the user (`setupCompleted`, `primaryColor`, `logoUrl`, `whatsappStatus`, `slug`). |
| `adminApi.ts` | `/admin/tenants` → `/admin/users`. `createAdminTenant` has no replacement. `updateAdminTenant` body `features` → `limits`. Type `AdminTenant` → `AdminUserView` (`features` → `limits`, adds `email`, `role`). |
| `settingsApi.ts` | `updateAiInstructions` returns `{ instructions }`, not `{ key, value }`. Language unchanged. New: `PATCH /settings/dnd`. |
| `availabilityApi.ts` | Work hours unchanged (`start`/`end` validated as `HH:mm`). Block routes and shapes unchanged. |
| `clientApi.ts` | `getClients` now receives `Paginated<ClientListItem>`; pass `limit` (max 500) or page through. `createClient` response adds `welcomeMessage`. `deleteClient` is a soft delete (same call). Do not send `type` or `subscriptionStatus`; `subscriptionStatus` in responses is now the billing status (`ACTIVE` / `CANCELED` / …), not the client status. Type `Client.subscriptionStatus` changes meaning; `Client.type` and `Client.whatsapp` are gone. |
| `studentApi.ts` | `/students*` is gone. `getStudents` → `GET /clients` (same query, same page shape). `createStudent` → `POST /clients`. `recordManualPayment` → `POST /clients/:id/payments` with `{ amount, method: "PIX" \| "CASH" \| "CARD", periodEnd, notes? }` (`amount` required); response `payment` is `PaymentView`. `updateStudentStatus` → `PATCH /clients/:id/status`. `getActivityHeatmap` → `GET /clients/:id/activity-heatmap`. `getWorkoutMagicLink` → `POST /clients/:id/magic-link`. `resendStudentLink`: `ANAMNESIS` → `POST /anamnesis/student/:id/request-reassessment`; `WORKOUT_SHEET` → `POST /clients/:id/magic-link/send` (`status` is always `"QUEUED"`). `getExportCsvUrl` → `/clients/export/csv`. Type `ManualPayment` → `PaymentView`. |
| `planApi.ts` | Send `features: PlanFeatureKey[]` instead of `featureIds`; responses carry `features: string[]` instead of `PlanFeature[]`. Types `Plan.features`, `Plan.featureIds`, `PlanFeature` change. |
| `systemFeatureApi.ts` | Only `getActiveSystemFeatures` survives, as `GET /plan-features` returning `{ key, name, description }[]`. The admin CRUD (create / update / delete / list all) is removed, with its screens. Type `SystemFeature` loses `id`, `isActive`, `_count`. |
| `scheduleApi.ts` | `createSession`: `linkedWorkoutId` → `workoutSheetId` + `workoutSegmentId`. `createRecurringEvent` → `POST /sessions` with `rrule`, `timezone` and `date` (was `dtstart`). `deleteRecurringSeries(id)` → `DELETE /sessions/:id` with the series id. `upsertSessionException` → `PATCH /sessions/<recurringEventId>_<originalStartTime>` with `{ date?, durationMinutes?, notes?, completed?, cancelled? }` (`newStartTime` → `date`). `updateSessionWithScope` is removed. `getSessions`, `getSessionsForRange`, `updateSession`, `toggleSessionComplete` keep their paths. Type `Session`: `linkedWorkoutId` → `workoutSheetId`, `workoutSegmentId`, `workout`; adds `status`, `cancelled`, `isVirtual`, `recurringEventId`, `originalStartTime`. |
| `evaluationApi.ts` | No change in routes or shape. |
| `anamnesisApi.ts` | Routes unchanged. `AnamnesisRecord` gains `status` and `date`; `token` is no longer returned. Tokens are opaque strings (not JWTs). An invalid, expired or used link is `401`. `requestReassessment` response adds `notification`. |
| `exerciseApi.ts` | No change (`isCustom` still present). |
| `workoutSheetApi.ts` | `/students/:id/workout-sheets` → `/clients/:id/workout-sheets`. Sheets and templates share one shape (`WorkoutSheetView`): `WorkoutTemplate.structure` is replaced by `workouts`, `description`, `tags`. Items, blocks and exercises always carry `id`; send them back on edit. New: `PATCH` and `DELETE /workout-sheets/:id`. |
| `workoutApi.ts` | `/workouts*` is gone; the "workout library" is the template list. `getWorkouts` → `GET /workout-templates`; `createWorkout` → `POST /workout-templates`; `updateWorkout` / `deleteWorkout` → `PATCH` / `DELETE /workout-sheets/:id`. The flat `WorkoutPlan` (`title`, `exercises[{ name, sets, reps, weight, notes, isWarmup }]`, `tags`) maps to: `name` ← `title`; one item (letter "A") with one REGULAR block per exercise; `exerciseName` ← `name`; `suggestedLoadKg` ← numeric part of `weight`; `executionNotes` ← `notes`; `isWarmup` and `tags` carried over. |
| `studentPortalApi.ts` | No change in routes or shape. `loads[]` may add `completed`. |
| `messagingApi.ts` | `getTenantQueue` → `GET /messaging/logs` (items have `userId`, `clientId`, `jobId` instead of `tenantId`; `status` is never `QUEUED`; `summary` is `{ totalSent, totalFailed, totalCancelled, totalPending }`). Pending messages come from `GET /messaging/pending`. `retryMessage` is removed. `cancelMessage` → `DELETE /messaging/pending/:jobId`. `processPendingQueue` → `POST /messaging/pending/flush` (`{ promotedCount, message }`). `getClientMessageHistory` → `GET /clients/:id/messages`. `resendStudentLink`: see `studentApi.ts`. |
| `storageApi.ts` | `POST /storage/presigned-url` does not exist in the API (before or after). Unchanged by this work; flagged in section 12. |
| AI calls (`services/gemini`, if routed through the API) | `POST /ai/*` now needs the bearer token. |

### 13.2 `app-personal-manager-client-v2` (Astro, auth pages)

Full table in [section 8](#8-auth-and-client-v2). In short: login, register, password-reset request/confirm and `/users/me` work against this API through aliases; `POST /auth/refresh` does not exist; the error envelope is NestJS's, so errors must be mapped by status; the `User` domain type must drop `tenantId`, `lastLoginAt`, `anonymizedAt` and use roles `admin` / `trainer`; logout must send the bearer token.

### 13.3 `app-personal-manager-website` (out of scope — what breaks)

The marketing site calls three routes that are gone: `POST /leads`, `GET /plans/public/:trainerId` (`VITE_TRAINER_ID`) and `GET /sessions/available`. They become `POST /public/:slug/leads`, `GET /public/:slug/plans` and `GET /public/:slug/availability`, so the site needs the trainer's slug (a `VITE_TRAINER_SLUG` variable replacing `VITE_TRAINER_ID`) in `src/services/apiService.ts` and `src/utils/apiService.ts`. Response shapes of plans and availability are unchanged; the lead response is now `{ id }`. Until it is updated, the contact form, the plans section and the booking calendar fail with `404`.

---

## 14. Integrator checklist

Already done by the architect:

- `prisma/schema.prisma`, baseline migration, `npx prisma generate`.
- `bullmq@^5` and `@nestjs/bullmq@^10.2.3` added to `package.json` / `package-lock.json`.
- `src/common/**` (types, ports, auth primitives, soft-delete filters) with specs: 9 suites, 76 tests.
- Skeleton module files for identity, crm, workouts, calendar, health.

To do after the streams land:

1. `src/modules/app.module.ts` — import `ConfigModule`, `PrismaModule`, `GcsModule`, `MailerModule`, `AiModule`, `IdentityModule`, `ClientDirectoryModule`, `CrmModule`, `WorkoutsModule`, `CalendarModule`, `HealthModule`, `MessagingModule`. Remove the `StorageModule` import.
2. `prisma/seed.ts` — rewrite for the 11 models: users with `slug`, `status`, branding and `settings` (no Tenant / UserSetting); plans with `features: PlanFeatureKey[]` (no SystemFeature / PlanFeature); payments; sheets and templates built with `buildWorkoutStructure`; the eight global exercises (`userId: null`) from the old `GLOBAL_EXERCISES`; events (one-off, series, exception, block); assessments built with `buildAssessmentData`; a few `NotificationLog` rows.
3. `prisma/reset.ts` — works unchanged (truncates every table); verify against a scratch database.
4. `.env.example` — remove `TRAINER_USER_ID`; mark `REDIS_URL` and `JWT_SECRET` as required; add `FRONTEND_URL`.
5. `test/*.e2e-spec.ts` — `messaging-queue` is rewritten for sections 6.6 and 9 (needs Redis); `settings-language` updated for `User.settings`; `payload-size` unchanged.
6. Apply the baseline to a **scratch** database (never `personalops-postgres-dev` without the owner's go-ahead) and confirm there is no drift.
7. Gate: `npm run lint && npx tsc --noEmit && npm run build && npx jest && npm run test:e2e`.
8. Read every `docs/integration-notes/<stream>.md`.

---

## Clarifications (integration)

Added by the integrator on 2026-10-04. Nothing above was changed; each line states what the code does where the text above is silent, and is covered by the e2e suite in `test/`.

| # | Topic | Behaviour |
|---|---|---|
| I1 | Linking a workout to a session (`workoutSheetId` + `workoutSegmentId`, section 6.4) | Any `WorkoutSheet` owned by the trainer is accepted: a client's sheet **or a template** (`isTemplate`, `clientId` null), for any of the trainer's clients. Another trainer's sheet or template → `404`; a segment that is not an item of the sheet → `400`. |
| I2 | `PATCH /availability-blocks/:id` | `rrule: null` turns a recurring block into a one-off and `notes: null` clears the note; both are accepted (`200`) and stored as null. |
| I3 | `PATCH /sessions/<seriesId>_<ISO>` (and toggle-complete) response | `id` stays the occurrence id (`<seriesId>_<ISO originalStartTime>`), also after the occurrence is moved; the UUID of the stored row is `exceptionId`; `recurringEventId` is the series id and `isVirtual` is true. |
| I4 | `POST /sessions` with `rrule` | `201` with the series master as a `SessionView`: `id` = the series UUID, `isVirtual: false`, `rrule` set, `recurringEventId: null`. The list never returns the master, only its occurrences. |
| I5 | `GET /anamnesis/student/:id` | Returns every request of the client, newest first (by creation): `PENDING` and `EXPIRED` rows are included next to `SUBMITTED` ones. The token is never returned. |
| I6 | Concurrent first edits of one occurrence | All succeed; the unique key `(parentEventId, originalStartTime)` keeps a single exception row and the loser of the insert is retried as an update (it was a `500`). Two concurrent `toggle-complete` calls on the same occurrence are still last-writer-wins. |
| I7 | `AnamnesisAnswers.weightKg` | Minimum 1 (`400` below it); a weight of 0 used to create a weight-0 evaluation. |
| I8 | Uploads | The only upload routes are `POST /users/avatar-upload-url` (#8) and `POST /clients/:id/avatar-upload-url` (#30), both returning `{ uploadUrl, publicUrl }` for an `image/*` content type. There is no `/storage/presigned-url` and no route for logo or video upload; `PATCH /users/branding` takes a `logoUrl` that is already hosted. |

---

## Clarifications (security review)

Added on 2026-10-04 after the security review. Nothing above was changed; where a line here contradicts the text above (R1, R8), this section is what the code does. Each line is covered by a unit spec and by `test/review-*.e2e-spec.ts`.

| # | Topic | Behaviour |
|---|---|---|
| R1 | RRULE (`POST`/`PATCH` on sessions and availability blocks) | Only `FREQ` (DAILY, WEEKLY, MONTHLY, YEARLY), `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH` and `WKST` are accepted; any other key → `400`. |
| R2 | `GET /sessions`, `GET /availability-blocks` ranges | A range longer than 366 days, or with a year outside 2000–2100 → `400`. |
| R3 | Occurrence cap | A rule that expands to more than 1,000 occurrences in one query → `422`. On the public availability search such a rule is left out and logged. |
| R4 | One-off session booking | Check and insert run in one transaction under a per-trainer, per-day advisory lock: of N concurrent bookings of one slot, one answers `201` and the rest `409`. |
| R5 | Ownership races | An update or delete of a session, block, plan or evaluation whose row stops belonging to the caller (or is deleted) between the check and the write → `404`. |
| R6 | Token audiences | Access tokens carry `aud: "vivi:session"`, portal links `aud: "vivi:portal"`; each verifier accepts only its own. A token without the right audience → `401`. Tokens and portal links issued before this change are invalid. |
| R7 | Session validity | Every authenticated request re-reads the account: a deleted or `BLOCKED` account → `401`; role and name come from the database. The token is bound to the password hash, so a password change or reset invalidates every token issued before it (`401`; log in again). `OVERDUE` accounts stay signed in (A17). |
| R8 | CORS | Not permissive any more: allowed origins are `CORS_ALLOWED_ORIGINS` plus the origins of `FRONTEND_URL` and `APP_CLIENT_URL`; loopback origins only outside production. |
| R9 | Body size | JSON bodies over 100 kb → `413`. Workout sheet/template writes and the AI routes accept 1 mb. Outside production only, `PATCH /clients/:id`, `PATCH /users/profile` and the AI routes accept 8 mb (base64 avatar fallback of the dashboard). |
| R10 | Field bounds | Public and token routes and the client, payment, plan, evaluation and workout-structure bodies have length and range limits (`400`). Notably: lead `phone` needs at least 8 digits; anamnesis photo URLs must be `https`; `GET /clients` `search` ≤ 200 characters. |
| R11 | Public lead for a soft-deleted client's e-mail | The row is restored as a lead but its stored `name` and `phone` are kept; the submitted values are appended to the notes. |
| R12 | AI routes | Bodies are validated (unknown nested keys are dropped); a provider failure → `502 "AI provider request failed"` without provider text. `settings.aiInstructions` applies when the request sends no `customInstructions`. |
| R13 | Avatar upload URLs | Content types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`. In production a signing failure → `503` (it was `201` with a mock URL). |
| R14 | Pending notifications | `GET /messaging/pending`, flush and `totalPending` read a per-trainer index in Redis. Enqueueing answers `503` and queues nothing when the index cannot be written. Jobs queued by a build without the index are delivered but not listed. |
| R15 | WhatsApp instance name | New instances are named `user-<uuid>`; a stored name is kept. |
