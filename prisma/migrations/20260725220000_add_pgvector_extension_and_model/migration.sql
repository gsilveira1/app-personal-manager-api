-- CreateExtension: Garante que a extensão pgvector seja ativada no banco
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable: Tabela segura para armazenamento de vetores (e.g. OpenAI 1536 dimensions)
CREATE TABLE "ContextEmbedding" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContextEmbedding_createdAt_idx" ON "ContextEmbedding"("createdAt");
