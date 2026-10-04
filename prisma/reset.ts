/**
 * Empties every table of the `public` schema (migration history is kept).
 * Development only: refuses to run with NODE_ENV=production, with no override.
 *
 * Run: npm run db:reset   (DATABASE_URL must point at the target database)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { assertResetAllowed, ScriptEnv } from "./seed-guard";

export interface ResetConnection {
  prisma: Pick<PrismaClient, "$queryRaw" | "$executeRawUnsafe">;
  close: () => Promise<void>;
}

function connectTo(databaseUrl: string): ResetConnection {
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

/**
 * @throws {Error} In production, or without DATABASE_URL — both before connecting
 */
export async function resetDatabase(
  env: ScriptEnv = process.env,
  connect: (databaseUrl: string) => ResetConnection = connectTo,
): Promise<void> {
  assertResetAllowed(env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to reset.");
  }
  const { prisma, close } = connect(env.DATABASE_URL);
  try {
    console.log("[reset] truncating every table of schema public");
    const rows = await prisma.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
    const tables = rows
      .map(({ tablename }) => tablename)
      .filter((name) => name !== "_prisma_migrations");

    for (const table of tables) {
      // CASCADE also empties the tables that reference this one.
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      console.log(`[reset] "${table}" truncated`);
    }
    console.log("[reset] done");
  } finally {
    await close();
  }
}

if (require.main === module) {
  resetDatabase().catch((error) => {
    console.error("[reset] failed:", error);
    process.exitCode = 1;
  });
}
