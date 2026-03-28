import { Injectable } from '@nestjs/common';

@Injectable()
export class RuntimeIngestService {
  getMode() {
    return 'skeleton';
  }
}
