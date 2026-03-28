import { Module } from '@nestjs/common';
import { RuntimeIngestRepository } from './runtime-ingest.repository';
import { RuntimeIngestService } from './runtime-ingest.service';

@Module({
  providers: [RuntimeIngestRepository, RuntimeIngestService],
  exports: [RuntimeIngestRepository, RuntimeIngestService]
})
export class RuntimeIngestModule {}
