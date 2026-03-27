import { Controller, Get, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { NetworkModelService } from './network-model.service';

@Controller('ops/network-models')
class NetworkModelController {
  constructor(private readonly networkModels: NetworkModelService) {}

  /** Returns the single published version for this hydraulic model header, if any. */
  @Get(':networkModelId/published-version')
  async published(@Param('networkModelId') networkModelId: string) {
    const row = await this.networkModels.getPublishedVersion(networkModelId);
    if (!row) {
      throw new NotFoundException('no published network_model_version for this network_model');
    }
    return ok(row);
  }

  /**
   * Publishes one version (and unpublishes siblings). Establishes the DB-backed graph the solver must use.
   */
  @Post(':networkModelId/versions/:versionId/publish')
  async publish(
    @Param('networkModelId') networkModelId: string,
    @Param('versionId') versionId: string
  ) {
    const row = await this.networkModels.publishVersion(networkModelId, versionId);
    return ok(row);
  }
}

@Module({
  controllers: [NetworkModelController],
  providers: [NetworkModelService],
  exports: [NetworkModelService]
})
export class NetworkModelModule {}
