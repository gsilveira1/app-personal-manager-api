import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { StudentQueryDto } from "./student-query.dto";

describe("StudentQueryDto", () => {
  const createDto = (data: Record<string, any>): StudentQueryDto => {
    return plainToInstance(StudentQueryDto, data);
  };

  it("should pass with default empty query", async () => {
    const dto = createDto({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.sortBy).toBe("name");
    expect(dto.sortOrder).toBe("asc");
  });

  it("should validate and allow all valid sort fields and orders", async () => {
    const sortFields = [
      "name",
      "email",
      "status",
      "modality",
      "createdAt",
      "updatedAt",
      "dateOfBirth",
    ];

    for (const field of sortFields) {
      for (const order of ["asc", "desc", "ASC", "DESC"]) {
        const dto = createDto({ sortBy: field, sortOrder: order });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      }
    }
  });

  it("should fail when page is less than 1", async () => {
    const dto = createDto({ page: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "page")).toBe(true);
  });

  it("should fail when limit is less than 1", async () => {
    const dto = createDto({ limit: -5 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "limit")).toBe(true);
  });
});
