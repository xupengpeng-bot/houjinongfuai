import { Injectable } from '@nestjs/common';

@Injectable()
export class TcpJsonV1Server {
  getMode() {
    return 'skeleton';
  }
}
