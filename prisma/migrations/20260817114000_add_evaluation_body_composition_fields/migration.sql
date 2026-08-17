-- AlterTable: add body composition columns missing from initial Evaluation migration
ALTER TABLE "Evaluation" ADD COLUMN "fatMass"           DOUBLE PRECISION;
ALTER TABLE "Evaluation" ADD COLUMN "bodyDensity"       DOUBLE PRECISION;
ALTER TABLE "Evaluation" ADD COLUMN "protocol"          TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "equation"          TEXT;
