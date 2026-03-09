import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { GcsService } from './gcs.service';

// Mock the entire @google-cloud/storage module
const mockGetSignedUrl = jest.fn();
const mockFile = jest.fn().mockReturnValue({ getSignedUrl: mockGetSignedUrl });
const mockBucket = jest.fn().mockReturnValue({ file: mockFile });

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: mockBucket,
  })),
}));

describe('GcsService', () => {
  let service: GcsService;

  const mockConfig: Record<string, string> = {
    GCP_PROJECT_ID: 'test-project',
    GCP_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com',
    GCP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
    GCS_BUCKET_NAME: 'test-bucket',
  };

  beforeEach(async () => {
    mockGetSignedUrl.mockReset();
    mockFile.mockClear();
    mockBucket.mockClear();
    mockGetSignedUrl.mockResolvedValue(['https://storage.googleapis.com/signed-url']);

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

  describe('generateSignedUploadUrl', () => {
    it('should return uploadUrl and publicUrl', async () => {
      const result = await service.generateSignedUploadUrl('avatars/user1/client1.jpeg', 'image/jpeg');

      expect(result.uploadUrl).toBe('https://storage.googleapis.com/signed-url');
      expect(result.publicUrl).toBe('https://storage.googleapis.com/test-bucket/avatars/user1/client1.jpeg');
    });

    it('should call getSignedUrl with correct parameters', async () => {
      await service.generateSignedUploadUrl('avatars/user1/client1.png', 'image/png');

      expect(mockBucket).toHaveBeenCalledWith('test-bucket');
      expect(mockFile).toHaveBeenCalledWith('avatars/user1/client1.png');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'v4',
          action: 'write',
          contentType: 'image/png',
          extensionHeaders: { 'x-goog-content-length-range': '0,5242880' },
        }),
      );
    });

    it('should set 15-minute expiry', async () => {
      const before = Date.now();
      await service.generateSignedUploadUrl('test.jpg', 'image/jpeg');
      const after = Date.now();

      const call = mockGetSignedUrl.mock.calls[0][0];
      const fifteenMinMs = 15 * 60 * 1000;
      expect(call.expires).toBeGreaterThanOrEqual(before + fifteenMinMs);
      expect(call.expires).toBeLessThanOrEqual(after + fifteenMinMs);
    });
  });

  describe('config validation', () => {
    it('should throw on missing GCS_BUCKET_NAME', async () => {
      const brokenConfig = { ...mockConfig };
      delete brokenConfig['GCS_BUCKET_NAME'];

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
      ).rejects.toThrow('Missing config: GCS_BUCKET_NAME');
    });
  });
});
