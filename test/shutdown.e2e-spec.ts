/**
 * Regression: PrismaService handed an externally created pg.Pool to the driver
 * adapter, and `$disconnect()` does not end a pool it did not create. After
 * `app.close()` the PostgreSQL sockets stayed open (until pg's idle timeout),
 * which is what kept test workers and a stopping container from exiting.
 */
import { Socket } from "net";

import { createE2eApp } from "./support/e2e-app";

function openSocketsTo(port: number): number {
  const handles: unknown[] = (
    process as unknown as { _getActiveHandles(): unknown[] }
  )._getActiveHandles();
  return handles.filter(
    (handle) => handle instanceof Socket && handle.remotePort === port,
  ).length;
}

describe("Application shutdown (e2e)", () => {
  it("closes every PostgreSQL connection on app.close()", async () => {
    const postgresPort = Number(new URL(process.env.DATABASE_URL!).port);
    const e2e = await createE2eApp();
    // Several concurrent queries, so the pool really holds idle connections.
    await Promise.all([1, 2, 3].map(() => e2e.prisma.user.count()));
    expect(openSocketsTo(postgresPort)).toBeGreaterThan(0);

    await e2e.app.close();

    expect(openSocketsTo(postgresPort)).toBe(0);
  });
});
