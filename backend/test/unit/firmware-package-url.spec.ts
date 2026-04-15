import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { TcpJsonV1Server } from '../../src/modules/device-gateway/tcp-json-v1.server';
import { FirmwareService } from '../../src/modules/firmware/firmware.module';

describe('FirmwareService package download URL', () => {
  const configValues: Record<string, string | undefined> = {};
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  const service = new FirmwareService(
    {} as DatabaseService,
    configService,
    {} as DeviceGatewayService,
    {} as TcpJsonV1Server,
  );

  const release = {
    version_semver: '1.2.3-r4',
    package_name: 'controller_fw.bin',
    release_code: 'SW-CONTROLLER-v1.2.3-r4',
  };
  const binaryArtifact = {
    id: 'artifact-123',
    file_name: 'controller_fw.bin',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(configValues).forEach((key) => delete configValues[key]);
  });

  it('uses the backend artifact download endpoint by default', () => {
    configValues.PUBLIC_API_BASE_URL = 'https://api.example.com/api/v1';

    expect((service as any).buildPackageDownloadUrl(release, binaryArtifact)).toBe(
      'https://api.example.com/api/v1/firmware/artifacts/artifact-123/download',
    );
  });

  it('uses the explicit static binary base only when configured', () => {
    configValues.PUBLIC_API_BASE_URL = 'https://api.example.com/api/v1';
    configValues.FIRMWARE_PUBLIC_BINARY_BASE_URL = 'https://cdn.example.com/ota/';

    expect((service as any).buildPackageDownloadUrl(release, binaryArtifact)).toBe(
      'https://cdn.example.com/ota/controller_fw-r4.bin',
    );
  });
});
