import { Body, Controller, Get, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import { ok } from '../../common/http/api-response';
import { NetworkWorkbenchService } from './network-workbench.service';

@Controller('ops')
export class NetworkWorkbenchController {
  constructor(private readonly service: NetworkWorkbenchService) {}

  @Get('device-gateway/contract')
  contract() {
    return ok(this.service.getDeviceContract());
  }

  @Post('device-gateway/simulator/preview')
  preview(@Body() body?: { scenario?: string; imei?: string; action?: string; session_ref?: string; command_id?: string }) {
    return ok(this.service.previewSimulator(body));
  }

  @Post('device-gateway/simulator/script')
  async scriptedFlow(
    @Body()
    body?: {
      project_id?: string;
      block_id?: string;
      pump_valve_relation_id?: string;
      session_ref?: string;
      imei_prefix?: string;
    }
  ) {
    return ok(await this.service.simulateScript(body ?? {}));
  }

  @Get('network-workbench/config')
  async config(@Query('project_id') projectId?: string, @Query('block_id') blockId?: string) {
    return ok(await this.service.getConfig(projectId, blockId));
  }

  @Get('network-workbench/network-model/graph')
  async graph(
    @Query('project_id') projectId?: string,
    @Query('block_id') blockId?: string,
    @Query('version_id') versionId?: string
  ) {
    return ok(await this.service.getGraph(projectId, blockId, versionId));
  }

  @Get('network-workbench/dispatch')
  async dispatch(@Query('project_id') projectId?: string, @Query('block_id') blockId?: string) {
    return ok(await this.service.getDispatch(projectId, blockId));
  }

  @Get('network-workbench/handoff-package')
  async handoffPackage(@Query('project_id') projectId?: string, @Query('block_id') blockId?: string) {
    return ok(await this.service.getHandoffPackage(projectId, blockId));
  }

  @Get('network-workbench/source-file')
  async sourceFile(
    @Query('source_file_ref') sourceFileRef?: string,
    @Res({ passthrough: true }) res?: Response
  ) {
    const file = await this.service.downloadSourceFile(sourceFileRef);
    const ext = path.extname(file.file_name).toLowerCase();
    const mimeType = ext === '.dxf' ? 'application/dxf' : 'application/octet-stream';
    res?.setHeader('Content-Type', mimeType);
    res?.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    return new StreamableFile(fs.createReadStream(file.absolute_path));
  }

  @Post('network-workbench/upload-source')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'source_file', maxCount: 1 },
      { name: 'sidecar_file', maxCount: 1 }
    ])
  )
  async uploadSource(
    @UploadedFiles()
    files: {
      source_file?: Array<{ buffer: Buffer; originalname?: string; size?: number }>;
      sidecar_file?: Array<{ buffer: Buffer; originalname?: string; size?: number }>;
    },
    @Body() body?: { project_id?: string; block_id?: string; source_kind?: string }
  ) {
    return ok(await this.service.uploadSource(body ?? {}, files));
  }

  @Post('network-workbench/source-preview')
  async sourcePreview(
    @Body()
    body?: {
      project_id?: string;
      block_id?: string;
      source_kind?: string;
      source_file_ref?: string;
      map_provider?: string;
      layer_hint?: string;
      layer_mapping?: {
        well_layer?: string | null;
        pump_layer?: string | null;
        valve_layer?: string | null;
        pipe_layer?: string | null;
        outlet_layer?: string | null;
        sensor_layer?: string | null;
      };
      graph_draft?: {
        import_mode?: string;
        overwrite_existing?: boolean;
        nodes?: Array<{
          node_code?: string;
          node_type?: string;
          asset_id?: string | null;
          latitude?: number | string | null;
          longitude?: number | string | null;
          altitude?: number | string | null;
        }>;
        pipes?: Array<{
          pipe_code?: string;
          pipe_type?: string;
          from_node_code?: string;
          to_node_code?: string;
          length_m?: number | string | null;
          diameter_mm?: number | string | null;
        }>;
      };
    }
  ) {
    return ok(await this.service.previewSource(body ?? {}));
  }

  @Post('network-workbench/save-config')
  async saveConfig(
    @Body()
    body?: {
      project_id?: string;
      block_id?: string;
      version_id?: string;
      source_name?: string;
      source_kind?: string;
      source_file_ref?: string;
      map_provider?: string;
      layer_hint?: string;
      relation_strategy?: string;
      notes?: string;
      publish?: boolean;
      auto_generate_relations?: boolean;
      layer_mapping?: {
        well_layer?: string | null;
        pump_layer?: string | null;
        valve_layer?: string | null;
        pipe_layer?: string | null;
        outlet_layer?: string | null;
        sensor_layer?: string | null;
      };
      graph_draft?: {
        import_mode?: string;
        overwrite_existing?: boolean;
        nodes?: Array<{
          node_code?: string;
          node_type?: string;
          asset_id?: string | null;
          latitude?: number | string | null;
          longitude?: number | string | null;
          altitude?: number | string | null;
        }>;
        pipes?: Array<{
          pipe_code?: string;
          pipe_type?: string;
          from_node_code?: string;
          to_node_code?: string;
          length_m?: number | string | null;
          diameter_mm?: number | string | null;
        }>;
      };
    }
  ) {
    return ok(await this.service.saveConfig(body ?? {}));
  }

  @Post('network-workbench/generate-relations')
  async generateRelations(
    @Body() body?: { project_id?: string; block_id?: string; relation_strategy?: string }
  ) {
    return ok(
      await this.service.generateRelations(body?.project_id, body?.block_id, body?.relation_strategy ?? 'pump_chain_auto')
    );
  }
}
