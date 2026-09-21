import { validate } from "class-validator";
import { PresignedUrlDto } from "./presigned-url.dto";

describe("PresignedUrlDto", () => {
  it("should validate valid dto with allowed mime type", async () => {
    const dto = new PresignedUrlDto();
    dto.fileName = "logo-trainer.png";
    dto.mimeType = "image/png";
    dto.folder = "logos";

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should accept valid svg and webp mime types", async () => {
    const dtoSvg = new PresignedUrlDto();
    dtoSvg.fileName = "brand.svg";
    dtoSvg.mimeType = "image/svg+xml";
    expect(await validate(dtoSvg)).toHaveLength(0);

    const dtoWebp = new PresignedUrlDto();
    dtoWebp.fileName = "brand.webp";
    dtoWebp.mimeType = "image/webp";
    expect(await validate(dtoWebp)).toHaveLength(0);
  });

  it("should reject invalid mime type (e.g. application/pdf, video/mp4)", async () => {
    const dto = new PresignedUrlDto();
    dto.fileName = "doc.pdf";
    dto.mimeType = "application/pdf" as any;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("mimeType");
  });

  it("should reject empty fileName", async () => {
    const dto = new PresignedUrlDto();
    dto.fileName = "";
    dto.mimeType = "image/png";

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
