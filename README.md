# 🏋️ Personal Manager API

> Multi-tenant REST API for a personal trainer & fitness studio management platform — handles tenants, clients/students, interactive workout sheets & templates, anamnesis forms with magic links, student execution portal, calendar sessions (one-off & RFC 5545 recurring), workout plans, body evaluations, pricing plans, lead capture, availability blocking, WhatsApp messaging (Evolution API v2), Cloudflare R2 / GCS storage, and multi-tenant administration.

---

## Tech Stack

| Layer          | Technology                                         |
|----------------|----------------------------------------------------|
| Runtime        | Node.js 22 LTS                                     |
| Framework      | NestJS 10 + TypeScript 5                           |
| ORM / Database | Prisma 7 + PostgreSQL 16 (Multi-tenant)            |
| Cache & Queue  | Redis 7                                            |
| WhatsApp API   | Evolution API v2 (Multi-device Baileys)            |
| Email Testing  | Mailpit (SMTP & Web UI)                            |
| Auth           | JWT Bearer token via Passport.js (`passport-jwt`)  |
| File Storage   | Cloudflare R2 (S3-compatible) & Google Cloud Storage (signed URLs) |
| AI Engine      | Google Gemini 2.5 Flash / Flash Lite               |
| Scheduling     | RFC 5545 RRULE engine (`rrule` library)            |
| Infra (dev)    | Docker Compose (Postgres + Redis + Evolution API + Mailpit + API) |
| Infra (prod)   | Fly.io + Fly Postgres (private 6PN network)        |
| Testing        | Jest 29 — 43 suites / 349 tests                   |

---

## Architecture Overview

```mermaid
graph TD
    Client["🌐 Web App / Student PWA / Admin"]

    subgraph NestJS["NestJS Application (port 9090)"]
        Auth["AuthModule\n/api/auth"]
        Tenants["TenantsModule\n/api/tenants"]
        Users["UsersModule\n/api/users"]
        Clients["ClientsModule & Students\n/api/clients & /api/students"]
        WorkoutSheets["WorkoutSheetsModule\n/api/workout-sheets"]
        Exercises["ExercisesModule\n/api/exercises"]
        StudentPortal["StudentPortalModule\n/api/student"]
        Anamnesis["AnamnesisModule\n/api/anamnesis"]
        Sessions["SessionsModule\n/api/sessions"]
        Workouts["WorkoutsModule\n/api/workouts"]
        Evaluations["EvaluationsModule\n/api/evaluations"]
        Plans["PlansModule\n/api/plans"]
        Messaging["MessagingModule\n/api/students/:id/resend-link"]
        Leads["LeadsModule\n/api/leads"]
        Settings["SettingsModule\n/api/settings"]
        Availability["AvailabilityBlocksModule\n/api/availability-blocks"]
        AiMod["AiModule\n(Gemini 2.5)"]
        Storage["StorageModule\n(R2 / GCS)"]
        Admin["AdminModule\n/api/admin/tenants"]
        Prisma["PrismaModule\n(shared singleton)"]
    end

    DB[("PostgreSQL 16\n(Multi-tenant public schema)")]
    RedisCache[("Redis 7\n(Cache & Queues)")]
    Evolution["💬 Evolution API v2\n(WhatsApp - port 8080)"]
    MailpitSvc["✉️ Mailpit\n(SMTP 1025 / UI 8025)"]
    CloudStorage["☁️ Cloudflare R2 / GCS"]

    Client -->|"Bearer JWT"| Auth
    Client --> Tenants
    Client --> Clients
    Client --> WorkoutSheets
    Client --> Exercises
    Client --> StudentPortal
    Client --> Anamnesis
    Client --> Sessions
    Client --> Workouts
    Client --> Evaluations
    Client --> Plans
    Client --> Messaging
    Client --> Leads
    Client --> Settings
    Client --> Availability
    Client --> Storage
    Client --> Admin

    Auth --> Users
    Storage --> CloudStorage
    Tenants --> Evolution
    Messaging --> Evolution
    Messaging --> MailpitSvc

    Prisma --> DB
    Evolution --> DB
    Evolution --> RedisCache
    NestJS --> RedisCache
```

---

## Project Structure

```
app-personal-manager-api/
├── src/
│   ├── main.ts                        # Bootstrap, global prefix, /health endpoint
│   ├── modules/
│   │   ├── app.module.ts              # Root application module registering all feature modules
│   │   ├── admin/                     # Super-admin multi-tenant management
│   │   ├── ai/                        # Gemini AI workout generator & insights
│   │   ├── anamnesis/                 # Anamnesis forms, tokens, reassessment requests
│   │   ├── auth/                      # JWT login, logout, signup, /me, role guards
│   │   ├── availability-blocks/       # Trainer unavailability (one-off or RFC 5545 recurring)
│   │   ├── clients/                   # Client CRUD, Students dashboard, lead conversion, manual payments
│   │   ├── evaluations/               # Body composition calculations & tracking
│   │   ├── exercises/                 # Exercise library & custom exercises per tenant
│   │   ├── gcs/                       # Google Cloud Storage signed-URL service
│   │   ├── leads/                     # Public lead-capture (landing page inquiry form)
│   │   ├── messaging/                 # WhatsApp/Email notifications with DND window calculation
│   │   ├── plans/                     # Pricing plans + feature flags
│   │   ├── prisma/                    # Shared PrismaService singleton
│   │   ├── sessions/                  # Calendar sessions (one-off + RFC 5545 RRULE)
│   │   ├── settings/                  # Per-user settings (AI prompt, language, work hours)
│   │   ├── storage/                   # Cloudflare R2 Presigned URLs for assets & branding
│   │   ├── student-portal/            # Student PWA execution, magic links, session logging
│   │   ├── system-features/           # Feature flags & access checks
│   │   ├── tenants/                   # Tenant profile, branding, Evolution API WhatsApp connect
│   │   ├── users/                     # User CRUD & profile management
│   │   ├── workout-sheets/            # Multi-block workout sheets (A/B/C) & templates
│   │   └── workouts/                  # Legacy workout plan templates & assignments
│   ├── types/                         # Shared TypeScript types (RequestWithUser, etc.)
│   └── utils/                         # RRULE expander utility
├── prisma/
│   ├── schema.prisma                  # Sanitized relational data models with tracking timestamps & indexes
│   ├── migrations/                    # Migration history
│   ├── seed.ts                        # Complete multi-tenant relational seeder (20 realistic clients)
│   └── reset.ts                       # DB reset script
├── test/                              # E2E tests
├── Dockerfile                         # Multi-stage production image (Node 22 LTS, procps, port 9090)
├── docker-compose.yml                 # Production Compose (Postgres, Redis, Evolution API, Mailpit, API)
├── docker-compose.dev.yml             # Dev Compose with hot-reload & auto-generation
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
npm run db:seed             # Populate with multi-tenant realistic sample data
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
| `EVOLUTION_API_URL` | ✅ | `http://localhost:8080` | URL to Evolution API instance |
| `EVOLUTION_API_KEY` | ✅ | `personalops_secret_token_123` | Authentication key for Evolution API |
| `EVOLUTION_PORT` | ⚙️ optional | `8080` | Host port for Evolution API |
| `AUTHENTICATION_API_KEY` | ⚙️ optional | `personalops_secret_token_123` | Master API Key configured inside Evolution container |
| `R2_ACCOUNT_ID` | ⚠️ optional | `...` | Cloudflare R2 Account ID |
| `R2_ACCESS_KEY_ID` | ⚠️ optional | `...` | Cloudflare R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | ⚠️ optional | `...` | Cloudflare R2 Secret Key |
| `R2_BUCKET_NAME` | ⚠️ optional | `viviops-storage` | Cloudflare R2 Bucket Name |
| `R2_PUBLIC_URL` | ⚠️ optional | `https://pub-r2.viviops.com` | Public CDN URL for assets |
| `JWT_SECRET` | ✅ | `seu_segredo_aqui` | Secret used to sign JWT tokens |
| `TRAINER_USER_ID` | ✅ | `uuid` | UUID of trainer user — scopes public endpoints |
| `GEMINI_API_KEY` | ⚠️ optional | `AQ...` | Google Gemini AI API key |

---

## API Reference

| Symbol | Meaning |
|--------|---------|
| 🌐 | Public — no authentication required |
| 🔒 | Protected — requires `Authorization: Bearer <token>` header |

> All resource routes are prefixed with `/api`. The `/health` endpoint is at the root (no `/api` prefix).

---

### Tenants & Setup Wizard — `/api/tenants`

| Method   | Path                                    | Auth | Description                                         |
|----------|-----------------------------------------|------|-----------------------------------------------------|
| `GET`    | `/api/tenants/me`                       | 🔒   | Get or auto-provision tenant for authenticated user |
| `PATCH`  | `/api/tenants/branding`                 | 🔒   | Update logo URL and primary brand color             |
| `POST`   | `/api/tenants/setup/connect-whatsapp`   | 🔒   | Generate/fetch Evolution API QR Code for WhatsApp   |
| `POST`   | `/api/tenants/whatsapp/connect`         | 🔒   | Alias for WhatsApp connect endpoint                 |
| `GET`    | `/api/tenants/whatsapp/status`          | 🔒   | Get current WhatsApp connection status              |
| `POST`   | `/api/tenants/setup/complete`           | 🔒   | Mark setup wizard as completed                      |

---

### Storage (Presigned URLs) — `/api/storage`

| Method   | Path                             | Auth | Description                                             |
|----------|----------------------------------|------|---------------------------------------------------------|
| `POST`   | `/api/storage/presigned-url`     | 🔒   | Generate an S3/R2 presigned PUT URL for image/video upload |

---

### Students & Clients — `/api/clients` & `/api/students`

| Method   | Path                                    | Auth | Description                                         |
|----------|-----------------------------------------|------|-----------------------------------------------------|
| `GET`    | `/api/clients`                          | 🔒   | List all clients                                    |
| `POST`   | `/api/clients`                          | 🔒   | Create client                                       |
| `GET`    | `/api/clients/leads`                    | 🔒   | List leads                                          |
| `PATCH`  | `/api/clients/:id/convert`              | 🔒   | Convert Lead to Active Student with Plan            |
| `GET`    | `/api/students`                         | 🔒   | Students management dashboard with search & filter  |
| `GET`    | `/api/students/export/csv`              | 🔒   | Export students data to CSV                         |
| `GET`    | `/api/students/expiring-sheets`         | 🔒   | List students with sheets expiring in ≤ 7 days      |
| `POST`   | `/api/students/:id/manual-payment`      | 🔒   | Record manual PIX/Cash payment receipt              |
| `PATCH`  | `/api/students/:id/status`              | 🔒   | Update subscription status (ACTIVE, OVERDUE, PAUSED)|
| `POST`   | `/api/students/:id/request-reassessment`| 🔒   | Request physical re-evaluation                      |
| `GET`    | `/api/students/:id/activity-heatmap`    | 🔒   | Get student training activity heatmap               |

---

### Workout Sheets & Templates — `/api/workout-sheets`

| Method   | Path                                            | Auth | Description                                    |
|----------|-------------------------------------------------|------|------------------------------------------------|
| `GET`    | `/api/students/:id/workout-sheets`              | 🔒   | Get student workout sheets                     |
| `POST`   | `/api/students/:id/workout-sheets`              | 🔒   | Create structured workout sheet (A/B/C blocks) |
| `GET`    | `/api/workout-sheets/:id`                       | 🔒   | Get single workout sheet                       |
| `GET`    | `/api/workout-templates`                        | 🔒   | List reusable workout templates                |
| `POST`   | `/api/workout-templates/from-sheet/:sheetId`    | 🔒   | Save existing sheet as a reusable template     |

---

### Student Portal (PWA) — `/api/student`

| Method   | Path                                    | Auth | Description                                    |
|----------|-----------------------------------------|------|------------------------------------------------|
| `GET`    | `/api/student/workout-sheet`            | 🌐   | Fetch active workout sheet via Magic Link token|
| `POST`   | `/api/student/sessions`                 | 🌐   | Submit completed training session & load logs  |
| `POST`   | `/api/students/:id/magic-link`          | 🔒   | Generate Magic Link URL for student portal     |

---

### Anamnesis — `/api/anamnesis`

| Method   | Path                                    | Auth | Description                                    |
|----------|-----------------------------------------|------|------------------------------------------------|
| `GET`    | `/api/anamnesis/form`                   | 🌐   | Fetch anamnesis form by token                  |
| `POST`   | `/api/anamnesis/submit`                 | 🌐   | Submit completed anamnesis response            |
| `GET`    | `/api/anamnesis/student/:id`            | 🔒   | Get student's anamnesis history                |
| `POST`   | `/api/anamnesis/student/:id/magic-link` | 🔒   | Generate anamnesis token & link                |

---

### Messaging & Notifications — `/api/students/:id/resend-link`

| Method   | Path                                    | Auth | Description                                    |
|----------|-----------------------------------------|------|------------------------------------------------|
| `POST`   | `/api/students/:id/resend-link`         | 🔒   | Resend WhatsApp/Email link with DND calculation|

---

### Super Admin — `/api/admin/tenants`

| Method   | Path                                    | Auth | Description                                    |
|----------|-----------------------------------------|------|------------------------------------------------|
| `GET`    | `/api/admin/tenants`                    | 🔒   | List all tenants in the system (Admin only)    |
| `POST`   | `/api/admin/tenants`                    | 🔒   | Provision a new tenant                         |
| `PATCH`  | `/api/admin/tenants/:id`                | 🔒   | Update tenant status (ACTIVE, BLOCKED, OVERDUE)|

---

## Running Tests

```bash
# Run all 43 test suites / 349 tests
npm test

# Run with coverage report
npm run test:cov

# Run in watch mode (dev)
npm run test:watch

# Run end-to-end tests
npm run test:e2e
```

---

## License

`UNLICENSED` — private repository.
