import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { LogsQueryDto } from "./logs-query.dto";

const errorsOf = (plain: Record<string, unknown>) =>
  validate(plainToInstance(LogsQueryDto, plain));

describe("LogsQueryDto", () => {
  it("defaults to page 1, limit 20", async () => {
    const dto = plainToInstance(LogsQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it("converts numeric strings from the query string", async () => {
    const dto = plainToInstance(LogsQueryDto, { page: "3", limit: "50" });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });

  it.each(["ALL", "SENT", "FAILED", "CANCELLED"])(
    "accepts status %s",
    async (status) => {
      expect(await errorsOf({ status })).toHaveLength(0);
    },
  );

  it("rejects QUEUED: the table no longer holds queued rows", async () => {
    expect(await errorsOf({ status: "QUEUED" })).not.toHaveLength(0);
  });

  it("accepts the known channels and rejects others", async () => {
    expect(await errorsOf({ channel: "WHATSAPP" })).toHaveLength(0);
    expect(await errorsOf({ channel: "EMAIL" })).toHaveLength(0);
    expect(await errorsOf({ channel: "SMS" })).not.toHaveLength(0);
  });

  it.each([
    { page: "0" },
    { page: "-1" },
    { page: "abc" },
    { limit: "0" },
    { limit: "101" },
    { limit: "1.5" },
  ])("rejects %j", async (query) => {
    expect(await errorsOf(query)).not.toHaveLength(0);
  });
});
