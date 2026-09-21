-- 1. Migrate ClientStatus enum safely with data mapping
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClientStatus') THEN
        CREATE TYPE "ClientStatus_new" AS ENUM ('ACTIVE', 'PAUSED', 'OVERDUE', 'LEAD');
        ALTER TABLE "Client" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "Client" ALTER COLUMN "status" TYPE "ClientStatus_new" USING (
            CASE 
                WHEN "status"::text = 'Active' THEN 'ACTIVE'::"ClientStatus_new"
                WHEN "status"::text = 'Inactive' THEN 'PAUSED'::"ClientStatus_new"
                WHEN "status"::text = 'Lead' THEN 'LEAD'::"ClientStatus_new"
                WHEN "status"::text = 'ACTIVE' THEN 'ACTIVE'::"ClientStatus_new"
                WHEN "status"::text = 'PAUSED' THEN 'PAUSED'::"ClientStatus_new"
                WHEN "status"::text = 'OVERDUE' THEN 'OVERDUE'::"ClientStatus_new"
                WHEN "status"::text = 'LEAD' THEN 'LEAD'::"ClientStatus_new"
                ELSE 'ACTIVE'::"ClientStatus_new"
            END
        );
        ALTER TYPE "ClientStatus" RENAME TO "ClientStatus_old";
        ALTER TYPE "ClientStatus_new" RENAME TO "ClientStatus";
        DROP TYPE "ClientStatus_old";
        ALTER TABLE "Client" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"ClientStatus";
    END IF;
END $$;

-- 2. Create ClientModality enum and migrate modality column
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClientModality') THEN
        CREATE TYPE "ClientModality" AS ENUM ('PRESENCIAL', 'ONLINE', 'HYBRID');
    END IF;
END $$;

ALTER TABLE "Client" ALTER COLUMN "modality" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "modality" TYPE "ClientModality" USING (
    CASE 
        WHEN "modality"::text ILIKE 'PRESENCIAL%' THEN 'PRESENCIAL'::"ClientModality"
        WHEN "modality"::text ILIKE 'HYBRID%' THEN 'HYBRID'::"ClientModality"
        ELSE 'ONLINE'::"ClientModality"
    END
);
ALTER TABLE "Client" ALTER COLUMN "modality" SET DEFAULT 'PRESENCIAL'::"ClientModality";

-- 3. Drop legacy columns if present
ALTER TABLE "Client" DROP COLUMN IF EXISTS "type";
ALTER TABLE "Client" DROP COLUMN IF EXISTS "subscriptionStatus";

-- 4. Create Indexes
CREATE INDEX IF NOT EXISTS "Client_modality_idx" ON "Client"("modality");

-- 5. Create PasswordResetToken table for auth recovery flow
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken"("token");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey'
    ) THEN
        ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
