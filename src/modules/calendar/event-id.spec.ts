import { BadRequestException } from "@nestjs/common";
import { formatOccurrenceId, parseEventId } from "./event-id";

describe("event ids", () => {
  it("treats an id without separator as a stored event", () => {
    expect(parseEventId("550e8400-e29b-41d4-a716-446655440000")).toEqual({
      kind: "stored",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("splits an occurrence id into series id and original start time", () => {
    expect(parseEventId("series-1_2025-02-03T10:00:00.000Z")).toEqual({
      kind: "occurrence",
      seriesId: "series-1",
      originalStartTime: new Date("2025-02-03T10:00:00.000Z"),
    });
  });

  it("round-trips with formatOccurrenceId", () => {
    const at = new Date("2025-02-03T10:00:00.000Z");
    const id = formatOccurrenceId("series-1", at);

    expect(id).toBe("series-1_2025-02-03T10:00:00.000Z");
    expect(parseEventId(id)).toMatchObject({
      seriesId: "series-1",
      originalStartTime: at,
    });
  });

  it("rejects an occurrence id whose date does not parse", () => {
    expect(() => parseEventId("series-1_not-a-date")).toThrow(
      BadRequestException,
    );
  });

  it("rejects an occurrence id without a series id", () => {
    expect(() => parseEventId("_2025-02-03T10:00:00.000Z")).toThrow(
      BadRequestException,
    );
  });
});
