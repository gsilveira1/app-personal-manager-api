# Development Guide

## Pré-requisitos

| Ferramenta | Versão mínima |
|---|---|
| Node.js | 22.x |
| npm | 10.x |
| Docker + Compose | 24.x |
| flyctl | latest |

---

## Rodando localmente

### 1. Clonar e instalar dependências

```bash
git clone <repo-url>
cd app-personal-manager-api
npm install
```

### 2. Variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com seus valores — especialmente DATABASE_URL e JWT_SECRET
```

Variáveis obrigatórias:

```env
DATABASE_URL=postgresql://admin:password@localhost:5432/gym_management
JWT_SECRET=seu_segredo_aqui
PORT=9090
NODE_ENV=development
```

### 3. Subir o banco de dados

```bash
docker compose up -d postgres
```

Aguardar o health check ficar verde (verifica a cada 10 s):

```bash
docker compose ps
```

### 4. Aplicar migrations e gerar o Prisma Client

```bash
npx prisma migrate deploy   # aplica migrations existentes
npx prisma generate          # gera os tipos TypeScript do Prisma Client
```

> **Nota:** para criar uma nova migration após alterar o schema:
> ```bash
> npx prisma migrate dev --name <nome_descritivo>
> ```

### 5. Popular o banco (opcional)

```bash
npm run db:seed
```

### 6. Iniciar a API em modo desenvolvimento

```bash
npm run start:dev
```

A API estará disponível em `http://localhost:9090`.  
Health check: `GET http://localhost:9090/health`  
Prefixo das rotas: `/api`

---

## Testes

### Testes unitários (sem banco)

```bash
npm test
```

Cobertura:

```bash
npm run test:cov
```

Filtrar por módulo:

```bash
npm test -- --testPathPattern=auth.service
npm test -- --testPathPattern=prisma.service
```

### Testes e2e / integração (requerem banco rodando)

> Certifique-se que `docker compose up -d postgres` está ativo e `DATABASE_URL` no `.env` está correto.

```bash
# Suite completa
npm run test:e2e

# Apenas o smoke test de infraestrutura (GET /health)
npm run test:e2e -- --testPathPattern=health

# Fluxo completo de auth (signup → login → me → logout + verificações no Prisma)
npm run test:e2e -- --testPathPattern=auth

# Settings de idioma
npm run test:e2e -- --testPathPattern=settings-language
```

#### O que cada suite cobre

| Arquivo | Tipo | Banco? | O que valida |
|---|---|---|---|
| `*.service.spec.ts` / `*.controller.spec.ts` | Unit | ❌ | Lógica de negócio em isolamento (mocks) |
| `src/modules/prisma/prisma.service.spec.ts` | Unit | ❌ | Lifecycle hooks `onModuleInit` / `onModuleDestroy` |
| `test/health.e2e-spec.ts` | E2E | ❌* | App sobe, `/health` responde, prefixo `/api` ativo |
| `test/auth.e2e-spec.ts` | E2E | ✅ | Auth completo + conexão Prisma↔Postgres |
| `test/settings-language.e2e-spec.ts` | E2E | ✅ | Configuração de idioma (upsert, idempotência) |

> \* `health.e2e-spec.ts` sobe o `AppModule` completo, então ainda precisa de `DATABASE_URL` válida para que o `PrismaService` conecte durante o `init()`. Num pipeline CI sem banco, substitua `AppModule` por um módulo de stub.

---

## Deploy no Fly.io

### Pré-requisitos

```bash
# Instalar flyctl
curl -L https://fly.io/install.sh | sh

# Autenticar
fly auth login
```

### Deploy inicial (primeira vez)

```bash
fly launch      # lê o fly.toml existente — confirme a região 'gru'
```

### Configurar segredos (variáveis sensíveis)

Nunca commitadas no repositório — injetadas via Fly secrets:

```bash
fly secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="sua_chave_secreta_aqui"
```

### Provisionar banco Postgres no Fly (se ainda não tiver)

```bash
fly postgres create --name app-personal-manager-db --region gru
fly postgres attach app-personal-manager-db --app app-personal-manager-api
# Isso define DATABASE_URL automaticamente como secret
```

### Deploy de novas versões

```bash
fly deploy
```

O processo executa automaticamente (via `release_command` no `fly.toml`):
1. Build da imagem Docker multi-stage
2. `npx prisma migrate deploy` — migrations antes de o tráfego ser redirecionado
3. Substituição zero-downtime da máquina anterior

### Verificar saúde pós-deploy

```bash
fly status
fly logs --app app-personal-manager-api

# Health check direto
curl https://app-personal-manager-api.fly.dev/health
```

### Rollback

```bash
fly releases list
fly deploy --image <image-ref-anterior>
```

### Variáveis de ambiente não-sensíveis

Definidas diretamente no `fly.toml` sob `[env]`:

```toml
[env]
  NODE_ENV = "production"
  PORT     = "9090"
```

> **Nunca** coloque `JWT_SECRET`, `DATABASE_URL` ou qualquer credencial em `fly.toml` pois ele é versionado no git. Use sempre `fly secrets set`.

---

## Estrutura de arquivos relevantes

```
├── Dockerfile              # Multi-stage build (Alpine + dumb-init + non-root user)
├── .dockerignore           # Exclui node_modules, dist, .env, .git do build context
├── fly.toml                # Configuração do Fly.io (porta 9090, migrations, vm)
├── docker-compose.yml      # Banco local DEV ONLY — não usado em produção
├── prisma/
│   ├── schema.prisma       # Schema do banco
│   └── migrations/         # Histórico de migrations
├── src/
│   └── modules/            # Módulos NestJS (auth, users, settings, prisma, ...)
└── test/
    ├── tsconfig.e2e.json   # tsconfig estendido que inclui test/ + src/
    ├── jest-e2e.json        # Configuração Jest para e2e
    ├── health.e2e-spec.ts
    ├── auth.e2e-spec.ts
    └── settings-language.e2e-spec.ts
```
