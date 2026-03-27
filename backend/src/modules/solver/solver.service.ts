import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { resolveEffectiveTopologyRelationTypeV1 } from '../topology/topology-relation-type-v1';
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
 * COD-035: preview/plan include `readModel` (network graph version + pump-valve topology context).
 */
@Injectable()
export class SolverService {
  constructor(private readonly db: DatabaseService) {}

  private async buildReadModel(dto: {
    network_model_version_id?: string;
    pump_valve_relation_id?: string;
  }) {
    let networkModelVersion: Record<string, unknown> | null = null;
    if (dto.network_model_version_id) {
      const r = await this.db.query(
        `
        select id, network_model_id, version_no, is_published, source_file_ref, created_at
        from network_model_version
        where id = $1
        `,
        [dto.network_model_version_id]
      );
      networkModelVersion = (r.rows[0] as Record<string, unknown>) ?? null;
    }

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
        pumpValveTopology = {
          id: row.id,
          wellId: row.well_id,
          pumpId: row.pump_id,
          valveId: row.valve_id,
          relationRole: row.relation_role,
          topologyRelationTypeState: row.topology_relation_type_state,
          topologyRelationTypeEffective: resolveEffectiveTopologyRelationTypeV1(
            row.topology_relation_type_state
          )
        };
      }
    }

    return { networkModelVersion, pumpValveTopology };
  }

  async preview(dto: SolverPreviewRequestDto) {
    const readModel = await this.buildReadModel(dto);
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only',
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
      notes: 'solver kernel not implemented; envelope only',
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
