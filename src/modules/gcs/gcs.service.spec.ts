import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";

import { GcsService } from "./gcs.service";

// Mock the entire @google-cloud/storage module
const mockGetSignedUrl = jest.fn();
const mockFile = jest.fn().mockReturnValue({ getSignedUrl: mockGetSignedUrl });
const mockBucket = jest.fn().mockReturnValue({ file: mockFile });

jest.mock("@google-cloud/storage", () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: mockBucket,
  })),
}));

describe("GcsService", () => {
  let service: GcsService;

  const mockConfig: Record<string, string> = {
    GCP_PROJECT_ID: "test-project",
    GCP_CLIENT_EMAIL: "test@test.iam.gserviceaccount.com",
    GCP_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----",
    GCS_BUCKET_NAME: "test-bucket",
  };

  beforeEach(async () => {
    mockGetSignedUrl.mockReset();
    mockFile.mockClear();
    mockBucket.mockClear();
    mockGetSignedUrl.mockResolvedValue([
      "https://storage.googleapis.com/signed-url",
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GcsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfig[key];
              if (!value) throw new Error(`Missing config: ${key}`);
              return value;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<GcsService>(GcsService);
  });

  describe("generateSignedUploadUrl", () => {
    it("should return uploadUrl and publicUrl", async () => {
      const result = await service.generateSignedUploadUrl(
        "avatars/user1/client1.jpeg",
        "image/jpeg",
      );

      expect(result.uploadUrl).toBe(
        "https://storage.googleapis.com/signed-url",
      );
      expect(result.publicUrl).toBe(
        "https://storage.googleapis.com/test-bucket/avatars/user1/client1.jpeg",
      );
    });

    it("should call getSignedUrl with correct parameters", async () => {
      await service.generateSignedUploadUrl(
        "avatars/user1/client1.png",
        "image/png",
      );

      expect(mockBucket).toHaveBeenCalledWith("test-bucket");
      expect(mockFile).toHaveBeenCalledWith("avatars/user1/client1.png");
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "v4",
          action: "write",
          contentType: "image/png",
          extensionHeaders: { "x-goog-content-length-range": "0,5242880" },
        }),
      );
    });

    it("should set 15-minute expiry", async () => {
      const before = Date.now();
      await service.generateSignedUploadUrl("test.jpg", "image/jpeg");
      const after = Date.now();

      const call = mockGetSignedUrl.mock.calls[0][0];
      const fifteenMinMs = 15 * 60 * 1000;
      expect(call.expires).toBeGreaterThanOrEqual(before + fifteenMinMs);
      expect(call.expires).toBeLessThanOrEqual(after + fifteenMinMs);
    });
  });

  describe("signing failures (review M6)", () => {
    const originalEnv = process.env.NODE_ENV;
    let logError: jest.SpyInstance;
    let logWarn: jest.SpyInstance;

    const build = async (config: Record<string, string>) => {
      const module = await Test.createTestingModule({
        providers: [
          GcsService,
          {
            provide: ConfigService,
            useValue: { getOrThrow: (key: string) => config[key] },
          },
        ],
      }).compile();
      return module.get(GcsService);
    };
    const badKeyConfig = { ...mockConfig, GCP_PRIVATE_KEY: "not-a-pem-key" };

    beforeEach(() => {
      logError = jest.spyOn(Logger.prototype, "error").mockImplementation();
      logWarn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    });
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      logError.mockRestore();
      logWarn.mockRestore();
    });

    it("production: a GCS error answers 503, never a fake upload URL", async () => {
      process.env.NODE_ENV = "production";
      mockGetSignedUrl.mockRejectedValue(new Error("invalid_grant: bad key"));
      const gcs = await build(mockConfig);

      await expect(
        gcs.generateSignedUploadUrl("avatars/u/c.png", "image/png"),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(logError.mock.calls.map(String).join()).toContain("invalid_grant");
    });

    it("production: the 503 body does not carry the GCS error text", async () => {
      process.env.NODE_ENV = "production";
      mockGetSignedUrl.mockRejectedValue(new Error("invalid_grant: bad key"));
      const gcs = await build(mockConfig);

      const failure: ServiceUnavailableException = await gcs
        .generateSignedUploadUrl("avatars/u/c.png", "image/png")
        .then(
          () => {
            throw new Error("expected a rejection");
          },
          (error) => error,
        );

      expect(JSON.stringify(failure.getResponse())).not.toContain(
        "invalid_grant",
      );
    });

    it("production: a key that is not a PEM answers 503", async () => {
      process.env.NODE_ENV = "production";
      const gcs = await build(badKeyConfig);

      await expect(
        gcs.generateSignedUploadUrl("avatars/u/c.png", "image/png"),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalled();
    });

    it.each(["development", "test"])(
      "%s: a GCS error falls back to the mock upload URL and warns",
      async (env) => {
        process.env.NODE_ENV = env;
        mockGetSignedUrl.mockRejectedValue(new Error("invalid_grant"));
        const gcs = await build(mockConfig);

        const result = await gcs.generateSignedUploadUrl(
          "avatars/u/c.png",
          "image/png",
        );

        expect(result.uploadUrl).toBe("mock-dev-upload://avatars/u/c.png");
        expect(logWarn.mock.calls.map(String).join()).toContain(
          "invalid_grant",
        );
      },
    );

    it("development: a key that is not a PEM falls back to the mock upload URL", async () => {
      process.env.NODE_ENV = "development";
      const gcs = await build(badKeyConfig);

      const result = await gcs.generateSignedUploadUrl(
        "avatars/u/c.png",
        "image/png",
      );

      expect(result.uploadUrl).toBe("mock-dev-upload://avatars/u/c.png");
      expect(logWarn).toHaveBeenCalled();
    });
  });

  describe("config validation", () => {
    it("should throw on missing GCS_BUCKET_NAME", async () => {
      const brokenConfig = { ...mockConfig };
      delete brokenConfig["GCS_BUCKET_NAME"];

      await expect(
        Test.createTestingModule({
          providers: [
            GcsService,
            {
              provide: ConfigService,
              useValue: {
                getOrThrow: jest.fn((key: string) => {
                  const value = brokenConfig[key];
                  if (!value) throw new Error(`Missing config: ${key}`);
                  return value;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow("Missing config: GCS_BUCKET_NAME");
    });
  });
});
