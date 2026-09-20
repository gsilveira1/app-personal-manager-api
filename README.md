# 🏋️ Personal Manager API

> REST API for a personal trainer management platform — handles clients, calendar sessions
> (one-off & RFC 5545 recurring), workout plans, body evaluations, pricing plans,
> lead capture, availability blocking, WhatsApp messaging (Evolution API v2), and per-user settings.

---

## Tech Stack

| Layer          | Technology                                         |
|----------------|----------------------------------------------------|
| Runtime        | Node.js 22 LTS                                     |
| Framework      | NestJS 10 + TypeScript 5                           |
| ORM / Database | Prisma 7 + PostgreSQL 16                           |
| Cache & Queue  | Redis 7                                            |
| WhatsApp API   | Evolution API v2 (migrated from WAHA)              |
| Email Testing  | Mailpit (SMTP & Web UI)                            |
| Auth           | JWT Bearer token via Passport.js (`passport-jwt`)  |
| File Storage   | Google Cloud Storage (signed URLs for avatars)     |
| AI Engine      | Google Gemini 2.5 Flash / Flash Lite               |
| Scheduling     | RFC 5545 RRULE engine (`rrule` library)            |
| Infra (dev)    | Docker Compose (Postgres + Redis + Evolution API + Mailpit + API) |
| Infra (prod)   | Fly.io + Fly Postgres (private 6PN network)        |
| Testing        | Jest 29 — 30 suites / 297 tests                   |

---

## Architecture Overview

```mermaid
graph TD
    Client["🌐 Client / Frontend"]

    subgraph NestJS["NestJS Application (port 9090)"]
        Auth["AuthModule\n/api/auth"]
        Users["UsersModule\n/api/users"]
        Clients["ClientsModule\n/api/clients"]
        Sessions["SessionsModule\n/api/sessions"]
        Workouts["WorkoutsModule\n/api/workouts"]
        Evaluations["EvaluationsModule\n/api/evaluations"]
        Plans["PlansModule\n/api/plans"]
        Leads["LeadsModule\n/api/leads"]
        Settings["SettingsModule\n/api/settings"]
        Availability["AvailabilityBlocksModule\n/api/availability-blocks"]
        AiMod["AiModule\n(Gemini 2.5)"]
        GCS["GcsModule"]
        Prisma["PrismaModule\n(shared singleton)"]
    end

    DB[("PostgreSQL 16")]
    RedisCache[("Redis 7\n(Cache & Queues)")]
    Evolution["💬 Evolution API v2\n(WhatsApp - port 8080)"]
    MailpitSvc["✉️ Mailpit\n(SMTP 1025 / UI 8025)"]
    Storage["☁️ Google Cloud Storage"]

    Client -->|"Bearer JWT"| Auth
    Client --> Clients
    Client --> Sessions
    Client --> Workouts
    Client --> Evaluations
    Client --> Plans
    Client --> Leads
    Client --> Settings
    Client --> Availability

    Auth --> Users
    Clients --> GCS
    GCS --> Storage

    Auth --> Prisma
    Users --> Prisma
    Clients --> Prisma
    Sessions --> Prisma
    Workouts --> Prisma
    Evaluations --> Prisma
    Plans --> Prisma
    Leads --> Prisma
    Settings --> Prisma
    Availability --> Prisma

    Prisma --> DB
    Evolution --> DB
    Evolution --> RedisCache
    NestJS --> Evolution
    NestJS --> MailpitSvc
    NestJS --> RedisCache
```

---

## Project Structure

```
app-personal-manager-api/
├── src/
│   ├── main.ts                        # Bootstrap, global prefix, /health endpoint
│   ├── modules/
│   │   ├── app.module.ts
│   │   ├── ai/                        # Gemini AI workout generator & chat routines
│   │   ├── auth/                      # JWT login, logout, signup, /me
│   │   ├── availability-blocks/       # Trainer unavailability (one-off or recurring)
│   │   ├── clients/                   # Client CRUD, lead conversion, avatar upload
│   │   ├── evaluations/               # Body composition evaluations per client
│   │   ├── gcs/                       # Google Cloud Storage signed-URL service
│   │   ├── leads/                     # Public lead-capture (website contact form)
│   │   ├── plans/                     # Pricing plans + feature flags
│   │   ├── prisma/                    # Shared PrismaService singleton
│   │   ├── sessions/                  # Calendar sessions (one-off + RFC 5545 RRULE)
│   │   ├── settings/                  # Per-user settings (AI instructions, language, work hours)
│   │   ├── system-features/           # Feature flags & access checks
│   │   ├── users/                     # User CRUD
│   │   └── workouts/                  # Workout plan templates & assignments
│   ├── types/                         # Shared TypeScript types (RequestWithUser, etc.)
│   └── utils/                         # RRULE expander utility
├── prisma/
│   ├── schema.prisma                  # Data models
│   ├── migrations/                    # Migration history
│   ├── seed.ts                        # Sample data seeder
│   └── reset.ts                       # DB reset script
├── test/                              # E2E tests
├── Dockerfile                         # Multi-stage production image (Node 22 LTS, port 9090)
├── docker-compose.yml                 # Full stack Compose (Postgres, Redis, Evolution API, Mailpit, API)
├── docker-compose.dev.yml             # Dev Compose with hot-reload volume mounts
├── fly.toml                           # Fly.io production configuration
├── .env.example                       # Environment variable template
└── .dockerignore
```

---

## Getting Started (Local Development)

### Prerequisites

- [Node.js ≥ 22](https://nodejs.org/)
- [Docker + Docker Compose](https://docs.docker.com/get-docker/)

### 1 — Clone & install dependencies

```bash
git clone <repo-url>
cd app-personal-manager-api
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env
# Open .env and fill in your values (see Environment Variables section below)
```

### 3 — Start infrastructure with Docker Compose

```bash
# Start all services (PostgreSQL, Redis, Evolution API, Mailpit, API):
docker compose up -d

# Or for local development with hot-reload:
docker compose -f docker-compose.dev.yml up -d
```

#### Services Map

| Service | Port (Host) | Description |
|---------|-------------|-------------|
| **Personal Manager API** | `9090` | Main NestJS API (`http://localhost:9090/health`) |
| **PostgreSQL 16** | `5432` | Main database (`schema=public` and `schema=evolution`) |
| **Redis 7** | `6379` | Cache, sessions, and Evolution API queue |
| **Evolution API v2** | `8080` | WhatsApp integration (`http://localhost:8080/docs`) |
| **Mailpit UI** | `8025` | Mock email web interface (`http://localhost:8025`) |
| **Mailpit SMTP** | `1025` | Local SMTP server |

### 4 — Run database migrations & seed

```bash
npx prisma migrate deploy   # Apply all pending migrations
npm run db:seed             # Populate with sample data
# — or in one step —
npm run db:refresh          # db:reset + db:seed
```

### 5 — Start the dev server (if running outside Docker)

```bash
npm run start:dev           # Hot-reload on http://localhost:9090
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. **Never commit `.env`.**

| Variable | Required | Default / Example | Description |
|---|---|---|---|
| `PORT` | ⚙️ optional | `9090` | HTTP port for the API server |
| `NODE_ENV` | ⚙️ optional | `development` | Application environment |
| `DATABASE_URL` | ✅ | `postgresql://admin:password123@localhost:5432/gym_management?schema=public` | PostgreSQL connection string |
| `POSTGRES_USER` | ⚙️ optional | `admin` | PostgreSQL username |
| `POSTGRES_PASSWORD` | ⚙️ optional | `password123` | PostgreSQL password |
| `POSTGRES_DB` | ⚙️ optional | `gym_management` | PostgreSQL database name |
| `POSTGRES_PORT` | ⚙️ optional | `5432` | PostgreSQL host port |
| `REDIS_HOST` | ⚙️ optional | `localhost` / `redis` | Redis host |
| `REDIS_PORT` | ⚙️ optional | `6379` | Redis port |
| `REDIS_URL` | ⚙️ optional | `redis://localhost:6379` | Redis connection URL |
| `EVOLUTION_API_URL` | ✅ | `http://localhost:8080` | URL to Evolution API instance (replaces WAHA) |
| `EVOLUTION_API_KEY` | ✅ | `personalops_secret_token_123` | Authentication key for Evolution API |
| `EVOLUTION_PORT` | ⚙️ optional | `8080` | Host port for Evolution API |
| `AUTHENTICATION_API_KEY` | ⚙️ optional | `personalops_secret_token_123` | Master API Key configured inside Evolution container |
| `MAILPIT_SMTP_PORT` | ⚙️ optional | `1025` | Mailpit SMTP port |
| `MAILPIT_UI_PORT` | ⚙️ optional | `8025` | Mailpit Web UI port |
| `EMAIL_SMTP_HOST` | ⚙️ optional | `localhost` / `mailpit` | SMTP host for emails |
| `EMAIL_SMTP_PORT` | ⚙️ optional | `1025` | SMTP port for emails |
| `JWT_SECRET` | ✅ | `seu_segredo_aqui` | Secret used to sign JWT tokens |
| `TRAINER_USER_ID` | ✅ | `uuid` | UUID of trainer user — scopes public endpoints |
| `GEMINI_API_KEY` | ⚠️ optional | `AQ...` | Google Gemini AI API key |
| `GCP_PROJECT_ID` | ⚠️ optional | `...` | Google Cloud project ID (for avatar uploads) |
| `GCP_CLIENT_EMAIL`| ⚠️ optional | `...` | GCP service account email |
| `GCP_PRIVATE_KEY` | ⚠️ optional | `...` | GCP service account private key |
| `GCS_BUCKET_NAME` | ⚠️ optional | `gym_management` | GCS bucket name for avatar storage |

> [!WARNING]
> `JWT_SECRET` defaults to a hardcoded dev placeholder when unset. **Always set a strong secret in production.**

---

## API Reference

| Symbol | Meaning |
|--------|---------|
| 🌐 | Public — no authentication required |
| 🔒 | Protected — requires `Authorization: Bearer <token>` header |

**Base URLs:**
- Production: `https://<your-app>.fly.dev`
- Local dev: `http://localhost:9090`

> All resource routes are prefixed with `/api`. The `/health` endpoint is at the root (no `/api` prefix).

---

### Health Check

| Method | Path      | Auth | Description                    |
|--------|-----------|------|--------------------------------|
| `GET`  | `/health` | 🌐   | Returns `{ status: "ok", timestamp: "..." }` |

---

### Authentication — `/api/auth`

| Method  | Path             | Auth | Description                             |
|---------|------------------|------|-----------------------------------------|
| `POST`  | `/api/auth/login`  | 🌐   | Login with email + password → returns JWT token |
| `POST`  | `/api/auth/signup` | 🌐   | Register a new user account             |
| `POST`  | `/api/auth/logout` | 🔒   | Stateless logout (client should discard token) |
| `GET`   | `/api/auth/me`     | 🔒   | Returns the authenticated user's profile |

**Login request body:**
```json
{ "email": "trainer@example.com", "password": "••••••••" }
```

**Login response:**
```json
{ "access_token": "<jwt>" }
```

---

### Clients — `/api/clients`

| Method   | Path                                  | Auth | Description                              |
|----------|---------------------------------------|------|------------------------------------------|
| `GET`    | `/api/clients`                        | 🔒   | List all active clients                  |
| `POST`   | `/api/clients`                        | 🔒   | Create a new client                      |
| `GET`    | `/api/clients/leads`                  | 🔒   | List clients with `status = Lead`        |
| `GET`    | `/api/clients/:id`                    | 🔒   | Get a single client                      |
| `PATCH`  | `/api/clients/:id`                    | 🔒   | Update client fields                     |
| `PATCH`  | `/api/clients/:id/convert`            | 🔒   | Convert a Lead into an active client (attach a plan) |
| `POST`   | `/api/clients/:id/avatar-upload-url`  | 🔒   | Get a signed GCS URL to upload the client's avatar |
| `DELETE` | `/api/clients/:id`                    | 🔒   | Delete client                            |

Client statuses: `Active` | `Inactive` | `Lead`

---

### Sessions (Calendar) — `/api/sessions`

The sessions module supports both **one-off sessions** and **RFC 5545 RRULE-based recurring events**.
A recurring event master stores the rule; individual occurrences are expanded virtually and can be
overridden via exceptions.

| Method   | Path                                    | Auth | Description                                           |
|----------|-----------------------------------------|------|-------------------------------------------------------|
| `GET`    | `/api/sessions/available`               | 🌐   | Public: free time slots for the trainer's website calendar. Query params: `?start=YYYY-MM-DD&end=YYYY-MM-DD` |
| `GET`    | `/api/sessions`                         | 🔒   | All sessions. Supports `?start=&end=` for calendar range |
| `POST`   | `/api/sessions`                         | 🔒   | Create a one-off session                              |
| `GET`    | `/api/sessions/:id`                     | 🔒   | Get single session                                    |
| `PATCH`  | `/api/sessions/:id/scope`               | 🔒   | Update session with scope: `THIS` / `THIS_AND_FUTURE` / `ALL` |
| `POST`   | `/api/sessions/:id/toggle-complete`     | 🔒   | Toggle completion status                              |
| `DELETE` | `/api/sessions/:id`                     | 🔒   | Delete session                                        |
| `POST`   | `/api/sessions/recurring-event`         | 🔒   | Create an RRULE recurring event master                |
| `DELETE` | `/api/sessions/recurring-event/:id`     | 🔒   | Delete an entire recurring series                     |
| `PATCH`  | `/api/sessions/exception`               | 🔒   | Edit or cancel a single occurrence of a recurring event |

Session types: `In-Person` | `Online`
Session categories: `Workout` | `Check-in` | `Evaluation`

---

### Workout Plans — `/api/workouts`

| Method   | Path               | Auth | Description                          |
|----------|--------------------|------|--------------------------------------|
| `GET`    | `/api/workouts`    | 🔒   | List all workout plans (+ templates) |
| `POST`   | `/api/workouts`    | 🔒   | Create workout plan                  |
| `GET`    | `/api/workouts/:id`| 🔒   | Get single workout plan              |
| `PATCH`  | `/api/workouts/:id`| 🔒   | Update workout plan                  |
| `DELETE` | `/api/workouts/:id`| 🔒   | Delete workout plan                  |

When `clientId` is omitted, the workout is treated as a **reusable template**.

---

### Evaluations — `/api/evaluations`

Body composition evaluations linked to a specific client.

| Method   | Path                   | Auth | Description              |
|----------|------------------------|------|--------------------------|
| `GET`    | `/api/evaluations`     | 🔒   | List all evaluations     |
| `POST`   | `/api/evaluations`     | 🔒   | Create evaluation        |
| `GET`    | `/api/evaluations/:id` | 🔒   | Get single evaluation    |
| `PATCH`  | `/api/evaluations/:id` | 🔒   | Update evaluation        |
| `DELETE` | `/api/evaluations/:id` | 🔒   | Delete evaluation        |

Captured fields: `weight`, `height`, `bodyFatPercentage`, `leanMass`, `perimeters`, `skinfolds`, `notes`.

---

### Pricing Plans — `/api/plans`

| Method   | Path                         | Auth | Description                                     |
|----------|------------------------------|------|-------------------------------------------------|
| `GET`    | `/api/plans/public/:trainerId`| 🌐   | Public: active plans for a trainer's website    |
| `GET`    | `/api/plans`                 | 🔒   | List all plans for the authenticated trainer    |
| `POST`   | `/api/plans`                 | 🔒   | Create a plan                                   |
| `GET`    | `/api/plans/:id`             | 🔒   | Get single plan                                 |
| `PATCH`  | `/api/plans/:id`             | 🔒   | Update plan                                     |
| `DELETE` | `/api/plans/:id`             | 🔒   | Delete plan                                     |

Plan types: `PRESENCIAL` | `CONSULTORIA`

---

### Availability Blocks — `/api/availability-blocks`

Marks time windows when the trainer is unavailable (lunch, vacation, etc.).
Supports both one-off blocks and RRULE-based recurring patterns.

| Method   | Path                           | Auth | Description                                  |
|----------|--------------------------------|------|----------------------------------------------|
| `GET`    | `/api/availability-blocks`     | 🔒   | List blocks in range (`?start=&end=` required) |
| `POST`   | `/api/availability-blocks`     | 🔒   | Create availability block                    |
| `PATCH`  | `/api/availability-blocks/:id` | 🔒   | Update block                                 |
| `DELETE` | `/api/availability-blocks/:id` | 🔒   | Delete block                                 |

---

### Settings — `/api/settings`

Per-user key-value settings stored in the database.

| Method  | Path                          | Auth | Description                           |
|---------|-------------------------------|------|---------------------------------------|
| `GET`   | `/api/settings/ai-instructions` | 🔒 | Get AI system prompt instructions     |
| `PUT`   | `/api/settings/ai-instructions` | 🔒 | Update AI system prompt instructions  |
| `GET`   | `/api/settings/language`       | 🔒  | Get preferred UI language             |
| `PATCH` | `/api/settings/language`       | 🔒  | Update preferred UI language          |
| `GET`   | `/api/settings/work-hours`     | 🔒  | Get work hours configuration          |
| `PUT`   | `/api/settings/work-hours`     | 🔒  | Update work hours configuration       |

---

### Leads — `/api/leads`

Public endpoint called by the trainer's website contact/inquiry form.

| Method | Path         | Auth | Description                                         |
|--------|--------------|------|-----------------------------------------------------|
| `POST` | `/api/leads` | 🌐   | Creates a `Client` record with `status = Lead` in the trainer's account |

---

### Users — `/api/users`

Internal user management. No JWT guard in v1 — intended for admin/seeding use only.

| Method   | Path              | Auth | Description    |
|----------|-------------------|------|----------------|
| `GET`    | `/api/users`      | —    | List all users |
| `POST`   | `/api/users`      | —    | Create user    |
| `GET`    | `/api/users/:id`  | —    | Get user       |
| `PATCH`  | `/api/users/:id`  | —    | Update user    |
| `DELETE` | `/api/users/:id`  | —    | Delete user    |

> [!WARNING]
> These endpoints have no authentication guard. In production, restrict access via network rules or add a guard before exposing to the internet.

---

## Authentication Flow

All 🔒 endpoints require the following HTTP header:

```
Authorization: Bearer <jwt_token>
```

1. Call `POST /api/auth/login` with `{ email, password }`
2. Store the returned `access_token`
3. Include it in the `Authorization` header for all protected requests
4. On logout, call `POST /api/auth/logout` and discard the token client-side

JWT tokens are validated via `passport-jwt`. The `JWT_SECRET` environment variable must be set in production.

---

## Database Management

```bash
# Apply all pending migrations (production / CI)
npx prisma migrate deploy

# Create a new migration from schema changes (dev only)
npx prisma migrate dev --name <migration-name>

# Open Prisma Studio (local DB GUI)
npx prisma studio

# Regenerate Prisma Client after schema changes
npx prisma generate

# Seed database with sample data
npm run db:seed

# Drop all tables and re-create schema (destructive!)
npm run db:reset

# Reset + seed in one command
npm run db:refresh
```

---

## Running Tests

```bash
# Run all 269 unit tests
npm test

# Run with coverage report
npm run test:cov

# Run in watch mode (dev)
npm run test:watch

# Run end-to-end tests
npm run test:e2e
```

---

## Deployment (Fly.io)

### First-time setup

```bash
# 1. Authenticate
fly auth login

# 2. Create and attach a Fly Postgres cluster
fly postgres create --name personal-manager-pg --region gru
fly postgres attach personal-manager-pg --app <your-app-name>
# DATABASE_URL is set automatically by attach ↑

# 3. Set remaining secrets
fly secrets set \
  JWT_SECRET="<long-random-string>" \
  TRAINER_USER_ID="<uuid-from-db>" \
  GCP_PROJECT_ID="<project>" \
  GCP_CLIENT_EMAIL="<sa-email>" \
  GCP_PRIVATE_KEY="<key>" \
  GCS_BUCKET_NAME="<bucket>"

# 4. Verify secrets (values are redacted)
fly secrets list

# 5. Update fly.toml app name, then deploy
fly deploy
```

### Day-to-day operations

```bash
fly deploy          # Build & deploy latest image
fly status          # Check machine health
fly logs            # Tail live logs
fly ssh console     # Open a shell inside the running machine
```

> See [`fly.toml`](./fly.toml) for full configuration (HTTPS redirect, health checks, concurrency limits).

---

## License

`UNLICENSED` — private repository.
