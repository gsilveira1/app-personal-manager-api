#!/bin/sh
# start.sh — Entrypoint Seguro do NestJS no Fly.io
# Executado pelo dumb-init (PID 1). Garante a integridade do banco antes de
# iniciar o processo principal da aplicação.
#
# Comportamento de Falha: set -e garante que qualquer erro inesperado aborte
# o script imediatamente, impedindo que a app suba num estado inconsistente.
set -e

echo "[start.sh] $(date '+%Y-%m-%dT%H:%M:%S') — Inicializando entrypoint seguro..."

# ─── 1. Aguardar PostgreSQL Sidecar (127.0.0.1:5432) ──────────────────────────
# O Postgres é um container sidecar co-alocado. Mesmo com `depends_on`, há uma
# janela de inicialização. Este loop garante que o banco está aceitando conexões
# antes de tentar executar as migrações.
max_retries=30
count=0

echo "[start.sh] Aguardando PostgreSQL sidecar em 127.0.0.1:5432..."
while ! pg_isready -h 127.0.0.1 -p 5432 -U "${DB_USER:-admin}" -t 1 > /dev/null 2>&1; do
  count=$((count + 1))
  if [ "$count" -ge "$max_retries" ]; then
    echo "[start.sh] ERRO FATAL: PostgreSQL sidecar indisponível após ${max_retries}s. Abortando inicialização!"
    exit 1
  fi
  echo "[start.sh] PostgreSQL ainda não está pronto. Tentativa $count/$max_retries. Aguardando 1s..."
  sleep 1
done

echo "[start.sh] PostgreSQL sidecar ONLINE e aceitando conexões."

# ─── 2. Executar Migrações do Prisma (Atômico e Idempotente) ──────────────────
# `prisma migrate deploy` aplica migrações pendentes de forma segura e idempotente.
# Se QUALQUER migração falhar, o container DEVE ser encerrado (exit 1) para evitar
# que a aplicação rode com schema de banco de dados dessincronizado.
echo "[start.sh] Executando: npx prisma migrate deploy..."
if ! npx prisma migrate deploy; then
  echo "[start.sh] ERRO FATAL: Falha ao executar migrações do Prisma!"
  echo "[start.sh] O container será encerrado para proteger a integridade dos dados."
  echo "[start.sh] Verifique os logs acima para identificar a migração com falha."
  exit 1
fi

echo "[start.sh] Migrações do Prisma aplicadas com sucesso."

# ─── 3. Iniciar Processo Principal da Aplicação ───────────────────────────────
# `exec "$@"` substitui este processo pelo CMD definido no Dockerfile (`node dist/main`).
# Isso garante que o processo node recebe sinais do OS corretamente (SIGTERM/SIGINT).
echo "[start.sh] Iniciando aplicação NestJS: $*"
exec "$@"
