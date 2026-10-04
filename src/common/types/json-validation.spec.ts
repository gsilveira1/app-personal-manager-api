import { BadRequestException } from "@nestjs/common";
import { IsInt, IsString } from "class-validator";
import { toJsonValue, validateDocument } from "./json-validation";

class SampleDto {
  @IsString() name!: string;
  @IsInt() count!: number;
}

describe("validateDocument", () => {
  it("returns the instance when the document is valid", () => {
    const result = validateDocument(SampleDto, { name: "a", count: 1 }, "Doc");
    expect(result).toBeInstanceOf(SampleDto);
    expect(result).toEqual({ name: "a", count: 1 });
  });

  it.each([null, "text", 3, [1, 2]])("rejects non-object %p", (value) => {
    expect(() => validateDocument(SampleDto, value, "Doc")).toThrow(
      "Doc must be a JSON object",
    );
  });

  it("rejects unknown properties", () => {
    expect(() =>
      validateDocument(SampleDto, { name: "a", count: 1, extra: true }, "Doc"),
    ).toThrow(BadRequestException);
  });

  it("reports the path of each invalid field", () => {
    try {
      validateDocument(SampleDto, { name: 1, count: "x" }, "Doc");
      fail("expected BadRequestException");
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        message: string[];
      };
      expect(response.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Doc\.name: /),
          expect.stringMatching(/^Doc\.count: /),
        ]),
      );
    }
  });
});

describe("toJsonValue", () => {
  it("drops undefined values and class prototypes", () => {
    const dto = Object.assign(new SampleDto(), { name: "a", count: undefined });
    const json = toJsonValue(dto);
    expect(json).toEqual({ name: "a" });
    expect(Object.getPrototypeOf(json)).toBe(Object.prototype);
  });
});
