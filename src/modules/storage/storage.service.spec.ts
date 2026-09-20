import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'R2_PUBLIC_URL') return 'https://pub-r2.viviops.com';
              if (key === 'R2_BUCKET_NAME') return 'viviops-assets';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate mock presigned URL and public URL when R2 credentials are not set', async () => {
    const dto: PresignedUrlDto = {
      fileName: 'trainer-logo.png',
      mimeType: 'image/png',
      folder: 'logos',
    };

    const result = await service.generatePresignedUrl(dto, 'tenant-123');

    expect(result).toBeDefined();
    expect(result.uploadUrl).toContain('mock-upload/logos/tenant-123/');
    expect(result.publicUrl).toContain('https://pub-r2.viviops.com/logos/tenant-123/');
    expect(result.key).toMatch(/^logos\/tenant-123\/[a-f0-9-]+\.png$/);
  });

  it('should handle svg extensions properly', async () => {
    const dto: PresignedUrlDto = {
      fileName: 'brand',
      mimeType: 'image/svg+xml',
      folder: 'logos',
    };

    const result = await service.generatePresignedUrl(dto);
    expect(result.publicUrl).toMatch(/\.svg$/);
  });
});
