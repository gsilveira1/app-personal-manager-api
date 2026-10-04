# Integration notes — calendar stream

Module: `src/modules/calendar/` (`CalendarModule`). Endpoints 59–69 of `docs/api-contract-v2.md` (section 6.4, stream 4).
Deleted: `src/modules/sessions/`, `src/modules/availability-blocks/`, `src/utils/` (the expander now lives at `src/modules/calendar/rrule-expander.ts`).

## 1. `src/modules/app.module.ts`

- Import `CalendarModule` from `./calendar/calendar.module`.
- Remove the imports of `SessionsModule` (`./sessions/sessions.module`) and `AvailabilityBlocksModule` (`./availability-blocks/availability-blocks.module`): the files no longer exist, and they are the only remaining references to the deleted directories.

`CalendarModule` imports `IdentityModule`, `ClientDirectoryModule` and `WorkoutsModule` and needs, at runtime:

| Token | Must be exported by | Used for |
|---|---|---|
| `USER_DIRECTORY` | `IdentityModule` | `requireBySlug`, `getSettings` (public availability) |
| `CLIENT_DIRECTORY` | `ClientDirectoryModule` | `requireOwned` (session create) |
| `WORKOUT_SHEET_READER` | `WorkoutsModule` | `assertSegment`, `resolveSegments` |
| `PrismaService` | global `PrismaModule` | `Event` |
| passport `jwt` strategy | `IdentityModule` | `JwtAuthGuard` on `/sessions` and `/availability-blocks` |

It exports nothing. No new dependency: `rrule` is already in `package.json`.

## 2. Environment and compose

`TRAINER_USER_ID` is no longer read anywhere. Remove it from `.env.example` (line 40), `docker-compose.yml` (line 93), `docker-compose.dev.yml` (line 97) and the README table (line 227). No new variable.

## 3. Seed (`prisma/seed.ts`)

Event rows must respect the check constraints and the shapes the read side expects:

| Kind | Required columns |
|---|---|
| One-off session | `type: SESSION`, `clientId`, `sessionType` ("In-Person" / "Online"), `category`, `date`, `durationMinutes ≥ 1`, `rrule: null` |
| Series master | same, plus `rrule` (e.g. `FREQ=WEEKLY;BYDAY=MO,WE`), `date` = DTSTART |
| Exception | `type: SESSION`, `parentEventId`, `originalStartTime` = an instant the master's rule really produces, `clientId` / `sessionType` / `category` / `durationMinutes` / `timezone` copied from the master, `rrule: null`, `notes: null` unless overridden |
| Block | `type: BLOCK`, `title`, `clientId: null`, `date` = start, `durationMinutes` = length |

A SESSION row without `sessionType` or `category` makes every read that includes it answer `500` ("Event … is not a well-formed session"): the columns are nullable in the schema only because blocks share the table.

Stored rules must be daily or slower (`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`).

## 4. e2e (`test/`)

No existing e2e spec covers sessions or blocks, so nothing has to be rewritten. Nothing in this stream was run against a database (unit tests use an in-memory stand-in for `prisma.event`), so these scenarios are worth one e2e file against the scratch database:

1. `POST /sessions` with `rrule` → `GET /sessions?start&end` lists the occurrences → `PATCH /sessions/<seriesId>_<ISO>` twice → still one exception row (unique `(parentEventId, originalStartTime)`).
2. `DELETE /sessions/<seriesId>` removes the exceptions (FK cascade).
3. `POST /sessions` over an existing session and over a block → `409`.
4. Soft-delete the client → its sessions leave `GET /sessions`, stop conflicting and free the public slots.
5. `GET /public/<slug>/availability` without a token → `200`; unknown slug → `404`; range > 92 days → `400`.
6. `GET /sessions` without a token → `401`.

Scenario 1 also answers the one thing that could not be verified here: whether two concurrent first edits of the same occurrence can surface a `P2002` from `prisma.event.upsert` (it would be a `500` today).

## 5. Decisions taken where the contract is silent

| # | Case | Behaviour |
|---|---|---|
| C1 | `PATCH /sessions/:id` on a one-off session with `cancelled: true` | `400` — section 2.4 gives a one-off only SCHEDULED / COMPLETED; it is removed with `DELETE`. |
| C2 | `POST /sessions/:id/toggle-complete` on a series master UUID | `400`. On a cancelled occurrence: `400` ("restore it first" with `PATCH { cancelled: false }`). |
| C3 | `POST /sessions` with `rrule` and `completed: true` | `400`. |
| C4 | Rule validation | Besides "starts with `FREQ=` and parses": only `KEY=VALUE` parts separated by `;`, and the frequency must be DAILY, WEEKLY, MONTHLY or YEARLY. Sub-daily rules are refused because a wide range would expand without bound. |
| C5 | Occurrence id that the rule does not produce | `404`, and no exception row is written (the old code stored an orphan exception). An id within one minute of a real occurrence is snapped to it. |
| C6 | Occurrence id whose date part does not parse | `400`. |
| C7 | `GET /sessions/:id` (and the `POST /sessions` response) for a series master | The master as a `SessionView` with `isVirtual: false` and `rrule` set. The list never returns it. |
| C8 | UUID of an exception row in `/sessions/:id` | Treated as the occurrence it replaces (view id is the occurrence id; `DELETE` cancels the occurrence). |
| C9 | `GET /sessions` with only one of `start` / `end`, an invalid date, or `end` before `start` | `400` (the old controller silently fell back to the unranged list). |
| C10 | Public availability | Busy time is read for the whole first and last day. The old code read only up to the `end` instant, so with `end=2025-01-08` (midnight) the sessions of Jan 8 were ignored and their slots were offered. |
| C11 | `PATCH` of an occurrence with `notes: null` | Shows the master's notes again (2.4: null = "use the master's notes"); one occurrence cannot have an empty note while the series has one. |
| C12 | Unlinking a workout (`workoutSheetId: null`) | Also clears `workoutSegmentId`; a segment without a sheet is `400`. |

## 6. Kept from the old code on purpose (known limits)

- The conflict check runs only on `POST /sessions` without `rrule`. Creating a series, moving a session with `PATCH`, and creating a block are not checked — as before.
- "Same day" in the conflict check and the slot grid of public availability use the server's local time zone (`setHours`), and `Event.timezone` is stored but not used by the expansion — as before. The API container should run with the trainer's time zone or the slots shift.

## 7. Fixed during the port (each with a regression test)

- `POST /sessions` accepted a `clientId` that did not exist.
- The range list and the slot search swallowed database errors (`catch {}` / "P2021 ignored") and answered with partial data; they now propagate.
- A malformed stored rule was skipped silently (`catch { continue }`); it is now logged with `Logger.error` (event id + rule) and left out.
- Toggling or cancelling an occurrence with an id a few seconds off created a second exception for the same occurrence.
