# Integration notes — messaging stream

Module: `src/modules/messaging/` (`MessagingModule`). Endpoints 80–88 and section 9 of `docs/api-contract-v2.md`.
The old `messaging.service.ts` (714 lines), its spec and `dto/messaging.dto.ts` / `dto/queue-query.dto.ts` are deleted.

## 1. `src/modules/app.module.ts`

- Import `MessagingModule` from `./messaging/messaging.module` (the class name and path did not change).
- `TenantsModule` no longer exists; its WhatsApp routes are served by `WhatsappController` here.
- Nothing else to register: `MessagingModule` itself calls `BullModule.forRootAsync(...)` and
  `BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })`. Do **not** add a second `BullModule.forRoot` in `app.module.ts`.

`MessagingModule` needs at runtime:

| Dependency | Must come from | Used for |
|---|---|---|
| `USER_DIRECTORY` | `IdentityModule` (imported by `MessagingModule`) | `getSettings` (DND), `getWhatsappConnection`, `setWhatsappConnection` |
| passport `jwt` strategy | `IdentityModule` | `JwtAuthGuard` on all nine routes |
| `PrismaService` | global `PrismaModule` | `NotificationLog` |
| `ConfigService` | `ConfigModule.forRoot({ isGlobal: true })` | `REDIS_URL`, `EVOLUTION_API_*` |

It exports only `NOTIFICATION_SENDER` (`useExisting: NotificationSenderService`). It imports no other domain module
(no crm, no health): the DAG is `messaging → identity`.

The module could not be booted in this stream (that needs Redis and the other streams' modules). The first
`npm run start:dev` after wiring is the check that DI resolves.

## 2. Files

| File | Role |
|---|---|
| `notification-sender.service.ts` | `NOTIFICATION_SENDER` port: DND delay + `queue.add` |
| `notification.processor.ts` | BullMQ worker (concurrency 5): send, classify errors, one audit row |
| `notification-audit.service.ts` | the only writer of `NotificationLog`; tolerates `P2002` on `jobId` |
| `pending-notifications.service.ts` | list / flush / cancel of jobs in BullMQ |
| `messaging-history.service.ts` | `GET /messaging/logs`, `GET /clients/:id/messages` |
| `whatsapp-connection.service.ts` | connect / status / disconnect / test message |
| `whatsapp.service.ts` | Evolution API HTTP client, typed errors only |
| `queue.config.ts`, `queue-access.ts` | `REDIS_URL` → BullMQ options; 5 s timeout → `503` on queue calls from HTTP |
| `dnd.ts`, `message-templates.ts`, `evolution-api.errors.ts` | pure helpers |
| `messaging.controller.ts` | `MessagingController` (80–83) and `ClientMessagesController` (84) |
| `whatsapp.controller.ts` | `WhatsappController` (85–88) |

## 3. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `REDIS_URL` | **yes** — the app throws at start without it | `.env.example` has `redis://localhost:6379`; `docker-compose.dev.yml` sets `redis://redis:6379`. If Redis ever gets a password, it must be inside this URL — `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` are **not** read by the queue. |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | no | Missing → `POST /whatsapp/connect`, `disconnect` (when an instance is stored) and `test-message` answer `503`; `GET /whatsapp/status` returns the stored status with a warning in the log; queued jobs retry 5 times and end FAILED. |
| `EVOLUTION_API_TIMEOUT_MS` | no | default 10000 |

Redis must not evict keys (`maxmemory-policy noeviction`), otherwise queued jobs can disappear. The dev compose uses the
image default (no `maxmemory`), which is fine; production needs the setting checked. Evolution API uses Redis DB 1, the queue DB 0.

## 4. Seed (`prisma/seed.ts`)

`NotificationLog` rows are finished outcomes only:

- `status` is `SENT`, `FAILED` or `CANCELLED` — never `QUEUED` (that status no longer exists).
- `userId` is required; `clientId` should be set so `GET /clients/:id/messages` shows something.
- `jobId` is unique: give each seeded row a distinct value (e.g. `buildIdempotencyKey(["seed", n])`) or leave it null.
- FAILED rows: `error` in the stored format, e.g. `WHATSAPP_NOT_CONNECTED: WhatsApp do treinador não está conectado (status DISCONNECTED).`
- CANCELLED rows: `error` = `Cancelado manualmente pelo treinador.`
- No row with `channel: "EMAIL"` should be seeded (A9: the e-mail fallback is gone).

Users: `whatsappInstanceName` / `whatsappStatus` live on `User`; `settings.dnd` is optional (defaults 22–08 `America/Sao_Paulo`).

## 5. e2e — `test/messaging-queue.e2e-spec.ts` must be rewritten

Every case in the file targets a removed route or behaviour (`/messaging/queue`, `/queue/:id/retry`, `/queue/process`, QUEUED rows,
`/students/:id/resend-link`). It needs a real Redis (use a dedicated DB index or key prefix and clean it) and a stubbed
`WhatsAppService` (`overrideProvider(WhatsAppService)`) — never the real Evolution container. Suggested cases:

1. enqueue through a caller route (workout link / anamnesis request) → job visible in `GET /messaging/pending`, no `NotificationLog` row yet;
2. worker runs → exactly one SENT row with `jobId`, pending list empty;
3. same idempotency key twice → one job, one row;
4. enqueue inside the DND window → `state: "delayed"`, `scheduledFor` set; `POST /messaging/pending/flush` → `promotedCount: 1` and the message is sent;
5. `DELETE /messaging/pending/:jobId` → CANCELLED row; another trainer's job → `404`;
6. trainer DISCONNECTED → FAILED row `WHATSAPP_NOT_CONNECTED`, no retry;
7. `GET /messaging/logs?status=QUEUED` → `400`; `summary.totalPending` matches the pending list;
8. `POST /whatsapp/connect` without `EVOLUTION_API_URL` → `503`.

## 6. Dependencies

None to install (`bullmq`, `@nestjs/bullmq`, `qrcode`, `date-fns-tz` are already in `package.json`).

## 7. Contract gaps and choices made in this stream

1. **Statuses the retry table does not classify.** The provider can answer e.g. `403` on send. `WhatsAppService` throws
   `EvolutionApiError`; the worker treats it as "any other exception" (logged with stack, default retry path, FAILED row
   `UNEXPECTED_ERROR: …` after the 5th attempt). The same applies to missing `EVOLUTION_API_*` in the worker.
2. **HTTP 400 with `exists: false`** (the number has no WhatsApp account) is an `InvalidRecipientError`, not a
   `WhatsAppInstanceError`: the table maps every 400 to "instance missing", which would mark a healthy trainer DISCONNECTED
   because of one wrong phone number. Any other 400 still follows the table.
3. **Delivered but not recorded.** After the provider accepts the message the job stores `{ delivered: true }` as its
   progress. If the audit insert then fails, the job is retried and only the insert is repeated — the message is not sent twice.
   A job whose audit row already exists is not sent at all (`ALREADY_RECORDED`).
4. **Consequence of one-row-per-key:** a key whose outcome is recorded (SENT, FAILED or CANCELLED) can never be sent again, even
   after BullMQ forgets the job (24 h / 7 days) or after a manual cancel. Callers that want a re-send must build a new key — the
   contract's keys do (new assessment id; UTC minute for the workout link). A workout link cancelled and re-requested within the
   same UTC minute is silently a no-op in the worker (logged as a warning).
5. **`enqueue` checks `queue.getJob` before `queue.add`** to report `DUPLICATE`. Two concurrent calls with the same key can both
   answer `ENQUEUED`; BullMQ still keeps a single job, so only the returned status is imprecise.
6. **Queue calls made on behalf of an HTTP request time out after 5 s → `503`.** BullMQ buffers commands while Redis is down,
   which would otherwise hang the request. This includes `GET /messaging/logs` (its `summary.totalPending` comes from the queue):
   with Redis down the logs endpoint answers `503` rather than reporting `totalPending: 0`. The contract lists only `400` for #80.
7. **`scheduledFor`** is reported only for a job delayed by DND on its first attempt. A job waiting on retry backoff is also
   `delayed`, but BullMQ does not expose its due time; it reads `null`. `POST /messaging/pending/flush` promotes those too
   (they are the caller's delayed jobs), i.e. it also skips the backoff wait.
8. **Flush with partial failure:** jobs that could not be promoted are logged and excluded from `promotedCount`; `503` only when
   none could be promoted.
9. **Cancel of a job that already finished** (completed/failed but still kept by BullMQ) → `404`; its audit row is left alone.
   A worker picking the job up between the state check and the removal → `409`.
10. **`GET /whatsapp/status` reconciliation:** live CONNECTED → stored CONNECTED; live DISCONNECTED → stored DISCONNECTED only
    when the stored status was CONNECTED (a PENDING pairing is not downgraded while the QR code is still on screen); live
    "connecting" never changes the stored status. Only provider errors degrade to the stored status; any other error propagates.
11. **`POST /whatsapp/disconnect`** with no stored instance stores DISCONNECTED without calling the provider; a provider `404`
    on logout counts as success. A provider failure → `502` and the stored status is kept.
12. **`POST /whatsapp/test-message`** without `EVOLUTION_API_*` → `503` (the contract lists only `400`); no stored instance → `400`.
    The stored status is not required to be CONNECTED, as before.
13. **`POST /students/:id/resend-link`** (old `MessagingService.resendLink`) is not in this module any more; sending the workout
    link belongs to the callers of `NOTIFICATION_SENDER` (workouts / health).
14. **Monitoring channel:** final failures are `Logger.error` lines only (`Notification failed permanently: job=… user=… template=…
    attempts=… httpStatus=… error=…`), as section 12 states. No Discord/alert hook exists.

## 8. Frontend impact (for the client streams)

- `GET /messaging/queue` → `GET /messaging/logs`; items no longer include QUEUED rows and `summary.totalQueued` became `totalPending`.
- Pending messages are a separate list (`GET /messaging/pending`) keyed by `jobId`, not by a log id.
- "Retry" button: endpoint removed (A10). "Process queue": now `POST /messaging/pending/flush`, response `{ promotedCount, message }`.
- WhatsApp routes moved from `/tenants/whatsapp/*` to `/whatsapp/*`; `connect` can answer `503` / `502` instead of a placeholder QR.
