-- 1. Drop old foreign key constraint from Session to WorkoutPlan
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_linkedWorkoutId_fkey";

-- 2. Migrate existing client-assigned WorkoutPlans to WorkoutSheets if table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'WorkoutPlan') THEN
    -- Convert client-assigned WorkoutPlans to WorkoutSheet & WorkoutSheetItem
    INSERT INTO "WorkoutSheet" ("id", "name", "expiresAt", "active", "clientId", "userId", "createdAt", "updatedAt")
    SELECT
      "id",
      "title",
      NOW() + INTERVAL '30 days',
      CASE WHEN "status" = 'Active' THEN true ELSE false END,
      "clientId",
      "userId",
      "createdAt",
      "updatedAt"
    FROM "WorkoutPlan"
    WHERE "clientId" IS NOT NULL
    ON CONFLICT ("id") DO NOTHING;

    -- Create WorkoutSheetItem for each migrated sheet
    INSERT INTO "WorkoutSheetItem" ("id", "sheetId", "letter", "name", "orderIndex", "createdAt", "updatedAt")
    SELECT
      "id",
      "id",
      'A',
      "title",
      0,
      "createdAt",
      "updatedAt"
    FROM "WorkoutPlan"
    WHERE "clientId" IS NOT NULL
    ON CONFLICT ("id") DO NOTHING;

    -- Convert unassigned template WorkoutPlans to WorkoutTemplate
    INSERT INTO "WorkoutTemplate" ("id", "name", "description", "structure", "userId", "createdAt", "updatedAt")
    SELECT
      "id",
      "title",
      "description",
      json_build_object(
        'workouts', json_build_array(
          json_build_object(
            'letter', 'A',
            'name', "title",
            'blocks', json_build_array(
              json_build_object(
                'type', 'REGULAR',
                'restTimeSeconds', 60,
                'exercises', "exercises"
              )
            )
          )
        )
      ),
      "userId",
      "createdAt",
      "updatedAt"
    FROM "WorkoutPlan"
    WHERE "clientId" IS NULL
    ON CONFLICT ("id") DO NOTHING;

    -- Drop legacy WorkoutPlan table
    DROP TABLE IF EXISTS "WorkoutPlan";
  END IF;
END $$;

-- 3. Add new foreign key constraint from Session to WorkoutSheetItem
ALTER TABLE "Session" ADD CONSTRAINT "Session_linkedWorkoutId_fkey" FOREIGN KEY ("linkedWorkoutId") REFERENCES "WorkoutSheetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
