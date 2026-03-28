import { Injectable } from '@nestjs/common';

@Injectable()
export class DeviceGatewayService {
  getProtocolName() {
    return 'tcp-json-v1';
  }
}
