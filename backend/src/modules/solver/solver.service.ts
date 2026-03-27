import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { NetworkModelService } from '../network-model/network-model.service';
import { buildPumpValveTopologyRelationReadModel } from '../topology/pump-valve-topology-read-model';
import {
  SOLVER_CONTRACT_VERSION,
  SolverExplainRequestDto,
  SolverPlanRequestDto,
  SolverPreviewRequestDto,
  SolverSimulateRequestDto
} from './solver.dto';

/**
 * Solver kernel is intentionally stubbed: preview/plan/explain/simulate return
 * stable envelope only. Scheduling algorithms are out of Phase 1 scope (COD-2026-03-26-013).
 * COD-035+: preview/plan require a **published** `network_model_version_id`; graph counts come from DB.
 */
@Injectable()
export class SolverService {
  constructor(
    private readonly db: DatabaseService,
    private readonly networkModels: NetworkModelService
  ) {}

  private async buildReadModel(dto: SolverPreviewRequestDto) {
    const ver = await this.networkModels.getPublishedVersionById(dto.network_model_version_id);
    if (!ver) {
      throw new BadRequestException(
        'solver requires network_model_version_id to reference a published network_model_version row'
      );
    }

    const counts = await this.networkModels.countGraphElements(ver.id);

    const networkModelVersion = {
      id: ver.id,
      networkModelId: ver.network_model_id,
      versionNo: ver.version_no,
      isPublished: ver.is_published,
      publishedAt: ver.published_at,
      sourceFileRef: ver.source_file_ref,
      createdAt: ver.created_at
    };

    const networkGraphSnapshot = {
      source: 'database' as const,
      versionId: ver.id,
      nodeCount: counts.nodeCount,
      pipeCount: counts.pipeCount
    };

    let pumpValveTopology: Record<string, unknown> | null = null;
    if (dto.pump_valve_relation_id) {
      const r = await this.db.query<{
        id: string;
        well_id: string;
        pump_id: string;
        valve_id: string;
        relation_role: string;
        topology_relation_type_state: Record<string, unknown>;
      }>(
        `
        select
          id,
          well_id,
          pump_id,
          valve_id,
          relation_role,
          coalesce(topology_relation_type_state, '{}'::jsonb) as topology_relation_type_state
        from pump_valve_relation
        where id = $1
        `,
        [dto.pump_valve_relation_id]
      );
      const row = r.rows[0];
      if (row) {
        const readModel = buildPumpValveTopologyRelationReadModel(row.topology_relation_type_state);
        pumpValveTopology = {
          id: row.id,
          wellId: row.well_id,
          pumpId: row.pump_id,
          valveId: row.valve_id,
          relationRole: row.relation_role,
          pumpValveTopologyReadModel: readModel
        };
      }
    }

    return { networkModelVersion, networkGraphSnapshot, pumpValveTopology };
  }

  async preview(dto: SolverPreviewRequestDto) {
    const readModel = await this.buildReadModel(dto);
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only — graph bound to published network_model_version',
      readModel,
      result: {
        feasible: true,
        horizonMinutes: null as number | null,
        units: [] as unknown[]
      }
    };
  }

  async plan(dto: SolverPlanRequestDto) {
    const readModel = await this.buildReadModel(dto);
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only — graph bound to published network_model_version',
      readModel,
      result: {
        planId: null as string | null,
        steps: [] as unknown[]
      }
    };
  }

  explain(_dto: SolverExplainRequestDto) {
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only',
      result: {
        explanations: [] as unknown[]
      }
    };
  }

  simulate(_dto: SolverSimulateRequestDto) {
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only',
      result: {
        timeline: [] as unknown[]
      }
    };
  }
}
