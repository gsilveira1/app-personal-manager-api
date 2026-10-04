import { ConfigService } from "@nestjs/config";
import { buildQueueRootOptions } from "./queue.config";

const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe("buildQueueRootOptions", () => {
  it("connects to REDIS_URL", () => {
    expect(
      buildQueueRootOptions(configOf({ REDIS_URL: "redis://redis:6379" })),
    ).toEqual({ connection: { url: "redis://redis:6379" } });
  });

  it.each([undefined, ""])("refuses to start with REDIS_URL = %p", (value) => {
    expect(() => buildQueueRootOptions(configOf({ REDIS_URL: value }))).toThrow(
      "REDIS_URL is required",
    );
  });
});
