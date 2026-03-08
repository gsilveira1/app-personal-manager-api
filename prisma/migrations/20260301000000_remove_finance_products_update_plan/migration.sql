-- Remove FinanceRecord and Product tables
DROP TABLE IF EXISTS "FinanceRecord";
DROP TABLE IF EXISTS "Product";

-- Drop old Plan columns and add new ones with defaults for existing rows
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "sessionDurationMinutes";
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "pricePerSession";

-- Add new columns with temporary defaults to satisfy NOT NULL constraint
ALTER TABLE "Plan" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'PRESENCIAL';
ALTER TABLE "Plan" ADD COLUMN "price" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "Plan" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Plan" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Remove the column defaults (Prisma handles defaults at the application level)
ALTER TABLE "Plan" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Plan" ALTER COLUMN "price" DROP DEFAULT;
