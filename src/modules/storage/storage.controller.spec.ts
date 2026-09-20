import { Test, TestingModule } from '@nestjs/testing';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { RequestWithUser } from '../../types/global';

describe('StorageController', () => {
  let controller: StorageController;
  let service: StorageService;

  const mockStorageService = {
    generatePresignedUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
      ],
    }).compile();

    controller = module.get<StorageController>(StorageController);
    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return presigned URL payload', async () => {
    const mockResponse = {
      uploadUrl: 'https://r2.viviops.com/upload/123',
      publicUrl: 'https://pub-r2.viviops.com/logos/123.png',
      key: 'logos/123.png',
    };

    mockStorageService.generatePresignedUrl.mockResolvedValue(mockResponse);

    const dto: PresignedUrlDto = {
      fileName: 'logo.png',
      mimeType: 'image/png',
      folder: 'logos',
    };

    const req = {
      user: { userId: 'user-1', username: 'trainer', role: 'trainer' },
    } as RequestWithUser;

    const result = await controller.getPresignedUrl(req, dto);

    expect(result).toEqual(mockResponse);
    expect(service.generatePresignedUrl).toHaveBeenCalledWith(dto, 'user-1');
  });
});
