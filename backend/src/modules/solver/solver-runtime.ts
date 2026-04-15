type GraphDraftNode = {
  node_code?: string | null;
  node_name?: string | null;
  node_type?: string | null;
  node_params?: Record<string, unknown> | null;
  pump_units?: Array<Record<string, unknown>> | null;
  altitude?: number | string | null;
};

type GraphDraftPipe = {
  pipe_code?: string | null;
  pipe_type?: string | null;
  from_node_code?: string | null;
  to_node_code?: string | null;
  length_m?: number | string | null;
  diameter_mm?: number | string | null;
};

type GraphDraft = {
  nodes?: GraphDraftNode[];
  pipes?: GraphDraftPipe[];
};

type SourceKind = 'groundwater' | 'surface_water' | 'river' | 'pond' | 'canal' | 'reservoir';
type RuntimeNodeType = 'source_station' | 'valve' | 'outlet' | 'sensor' | 'junction';

type RuntimeNode = {
  id: string;
  code: string;
  name: string;
  type: RuntimeNodeType;
  sourceKind: SourceKind | null;
  elevation: number;
  nodeParams: Record<string, unknown>;
  pumpUnits: Array<Record<string, unknown>>;
};

type RuntimePipe = {
  id: string;
  pipeType: 'main' | 'branch';
  fromNodeId: string;
  toNodeId: string;
};

type RuntimePump = {
  id: string;
  parentNodeId: string;
  parentNodeCode: string;
  parentNodeName: string;
  hydraulicNodeId: string;
  hydraulicNodeCode: string;
  ratedFlow: number;
  ratedHead: number;
  ratedPower: number;
  frequencyRange: [number, number];
  priority: number;
};

type RuntimeValve = {
  id: string;
  nodeId: string;
  nodeCode: string;
  pipeId: string | null;
  openingPct: number;
};

type RuntimeOutlet = {
  id: string;
  nodeId: string;
  nodeCode: string;
  name: string;
  targetFlow: number;
  minPressure: number;
};

type RuntimeBlueprint = {
  nodes: RuntimeNode[];
  pipes: RuntimePipe[];
  pumps: RuntimePump[];
  valves: RuntimeValve[];
  outlets: RuntimeOutlet[];
};

type OutletAssignment = {
  outletId: string;
  outletNodeId: string;
  outletName: string;
  sourceNodeId: string;
  sourceNodeCode: string;
  targetFlow: number;
  allocatedFlow: number;
  pipeIds: string[];
  nodeIds: string[];
};

export type SolverRuntimeSnapshot = {
  mode: 'network_allocation_v1';
  notes: string[];
  summary: {
    requested_outlet_count: number;
    assigned_outlet_count: number;
    unassigned_outlet_count: number;
    requested_demand_flow_m3h: number;
    assigned_demand_flow_m3h: number;
    planned_supply_flow_m3h: number;
    flow_gap_m3h: number;
    active_pump_count: number;
    active_valve_count: number;
  };
  mass_balance: {
    requested_demand_flow_m3h: number;
    assigned_demand_flow_m3h: number;
    planned_supply_flow_m3h: number;
    flow_gap_m3h: number;
    balance_status: 'balanced' | 'under_supplied' | 'over_supplied';
  };
  active_graph: {
    node_ids: string[];
    pipe_ids: string[];
    pump_ids: string[];
    valve_ids: string[];
    source_node_ids: string[];
  };
  allocation: {
    requested_outlet_ids: string[];
    assigned_outlet_ids: string[];
    unassigned_outlets: Array<{
      outlet_id: string;
      outlet_node_id: string;
      outlet_name: string;
      reason_code: string;
      reason: string;
    }>;
    outlet_allocations: Array<{
      outlet_id: string;
      outlet_node_id: string;
      outlet_name: string;
      source_node_id: string;
      source_node_code: string;
      target_flow_m3h: number;
      allocated_flow_m3h: number;
      pipe_ids: string[];
      node_ids: string[];
    }>;
  };
  controls: {
    pump_controls: Array<{
      pump_id: string;
      parent_node_id: string;
      parent_node_code: string;
      running: boolean;
      frequency_hz: number;
      planned_flow_m3h: number;
      rated_flow_m3h: number;
    }>;
    valve_controls: Array<{
      valve_id: string;
      node_id: string;
      node_code: string;
      pipe_id: string | null;
      open: boolean;
      opening_pct: number;
    }>;
  };
};

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumberOrFallback(value: unknown, fallback: number) {
  if (value == null) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return toNumber(value, fallback);
}

function normalizeCode(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function isSourceStationNodeType(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'source_station' || normalized === 'well' || normalized === 'pump';
}

function normalizeSourceKind(value: unknown, fallback: SourceKind = 'groundwater'): SourceKind {
  const normalized = String(value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'groundwater':
    case 'well':
    case 'jijing':
      return 'groundwater';
    case 'river':
      return 'river';
    case 'pond':
      return 'pond';
    case 'canal':
      return 'canal';
    case 'reservoir':
      return 'reservoir';
    case 'surface':
    case 'surface_water':
    case 'surfacewater':
    case 'pump_station':
    case 'pumpstation':
      return 'surface_water';
    default:
      return fallback;
  }
}

function inferSourceKindFromLegacyNodeType(nodeType: unknown): SourceKind | null {
  const normalized = String(nodeType ?? '').trim().toLowerCase();
  if (normalized === 'well') return 'groundwater';
  if (normalized === 'pump') return 'surface_water';
  return null;
}

function resolveSourceKind(nodeType: unknown, nodeParams: Record<string, unknown>) {
  if (typeof nodeParams.source_kind === 'string' && nodeParams.source_kind.trim()) {
    return normalizeSourceKind(nodeParams.source_kind);
  }
  return inferSourceKindFromLegacyNodeType(nodeType) ?? 'groundwater';
}

function getDefaultPumpSpec(node: Pick<RuntimeNode, 'sourceKind' | 'nodeParams'>) {
  const groundwater = node.sourceKind === 'groundwater';
  return {
    ratedFlow: toNumberOrFallback(node.nodeParams.rated_flow_m3h ?? node.nodeParams.design_flow_m3h, groundwater ? 25 : 40),
    ratedHead: toNumberOrFallback(node.nodeParams.rated_head_m ?? node.nodeParams.pump_head_m, groundwater ? 40 : 32),
    ratedPower: toNumberOrFallback(node.nodeParams.rated_power_kw, groundwater ? 7.5 : 11),
  };
}

function isVirtualSourceContainer(node: RuntimeNode) {
  const role = String(node.nodeParams.source_container_role ?? '').trim().toLowerCase();
  return role.includes('virtual');
}

function hasLegacyImplicitPumpConfig(node: RuntimeNode) {
  return (
    node.type === 'source_station' &&
    !isVirtualSourceContainer(node) &&
    (Number.isFinite(Number(node.nodeParams.rated_flow_m3h)) ||
      Number.isFinite(Number(node.nodeParams.design_flow_m3h)) ||
      Number.isFinite(Number(node.nodeParams.rated_head_m)) ||
      Number.isFinite(Number(node.nodeParams.pump_head_m)) ||
      Number.isFinite(Number(node.nodeParams.rated_power_kw)))
  );
}

function resolvePumpHydraulicNode(node: RuntimeNode, unit: Record<string, unknown>, nodeByCode: Map<string, RuntimeNode>) {
  const sourceCode = normalizeCode(
    unit.source_node_code ?? unit.intake_node_code ?? unit.well_node_code,
    node.code,
  );
  const hydraulicNode = nodeByCode.get(sourceCode) ?? node;
  return {
    hydraulicNodeId: hydraulicNode.id,
    hydraulicNodeCode: hydraulicNode.code,
  };
}

function toNodeType(value: unknown): RuntimeNodeType {
  if (isSourceStationNodeType(value)) return 'source_station';
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'valve' || normalized === 'outlet' || normalized === 'sensor' || normalized === 'junction') {
    return normalized as RuntimeNodeType;
  }
  return 'junction';
}

function buildRuntimeBlueprint(graphDraft: GraphDraft | null | undefined): RuntimeBlueprint | null {
  if (!graphDraft) return null;

  const nodes: RuntimeNode[] = (Array.isArray(graphDraft.nodes) ? graphDraft.nodes : [])
    .map((node, index) => {
      const code = normalizeCode(node.node_code, `node_${index + 1}`);
      const nodeParams =
        node.node_params && typeof node.node_params === 'object' && !Array.isArray(node.node_params)
          ? node.node_params
          : {};
      return {
        id: code,
        code,
        name: typeof node.node_name === 'string' && node.node_name.trim() ? node.node_name.trim() : code,
        type: toNodeType(node.node_type),
        sourceKind: isSourceStationNodeType(node.node_type) ? resolveSourceKind(node.node_type, nodeParams) : null,
        elevation: toNumber(node.altitude, 0),
        nodeParams,
        pumpUnits: Array.isArray(node.pump_units) ? node.pump_units.filter((item) => item && typeof item === 'object') : [],
      };
    })
    .filter((node) => Boolean(node.code));

  const nodeByCode = new Map(nodes.map((node) => [node.code, node] as const));

  const pipes: RuntimePipe[] = (Array.isArray(graphDraft.pipes) ? graphDraft.pipes : [])
    .map((pipe, index) => ({
      id: normalizeCode(pipe.pipe_code, `pipe_${index + 1}`),
      pipeType: (String(pipe.pipe_type ?? '').trim().toLowerCase() === 'branch' ? 'branch' : 'main') as 'main' | 'branch',
      fromNodeId: normalizeCode(pipe.from_node_code, ''),
      toNodeId: normalizeCode(pipe.to_node_code, ''),
    }))
    .filter((pipe) => pipe.fromNodeId && pipe.toNodeId && nodeByCode.has(pipe.fromNodeId) && nodeByCode.has(pipe.toNodeId));

  const pumps: RuntimePump[] = [];
  for (const node of nodes.filter((item) => item.type === 'source_station')) {
    const explicitUnits = node.pumpUnits.filter((unit) => (unit as Record<string, unknown>).enabled !== false);
    const fallbackPumpSpec = getDefaultPumpSpec(node);
    const units =
      explicitUnits.length > 0
        ? explicitUnits
        : hasLegacyImplicitPumpConfig(node)
          ? [
              {
                unit_code: `${node.code}-P1`,
                unit_name: `${node.name}-泵1`,
                enabled: true,
                rated_flow_m3h: fallbackPumpSpec.ratedFlow,
                rated_head_m: fallbackPumpSpec.ratedHead,
                rated_power_kw: fallbackPumpSpec.ratedPower,
              },
            ]
          : [];

    if (units.length === 0) {
      continue;
    }

    units.forEach((unit, index) => {
      const normalizedUnit = unit as Record<string, unknown>;
      const pumpId = normalizeCode(normalizedUnit.unit_code, `${node.code}-P${index + 1}`);
      const hydraulicNode = resolvePumpHydraulicNode(node, normalizedUnit, nodeByCode);
      pumps.push({
        id: pumpId,
        parentNodeId: node.id,
        parentNodeCode: node.code,
        parentNodeName: node.name,
        hydraulicNodeId: hydraulicNode.hydraulicNodeId,
        hydraulicNodeCode: hydraulicNode.hydraulicNodeCode,
        ratedFlow: toNumberOrFallback(normalizedUnit.rated_flow_m3h, fallbackPumpSpec.ratedFlow),
        ratedHead: toNumberOrFallback(normalizedUnit.rated_head_m, fallbackPumpSpec.ratedHead),
        ratedPower: toNumberOrFallback(normalizedUnit.rated_power_kw, fallbackPumpSpec.ratedPower),
        frequencyRange: [30, 50],
        priority: index + 1,
      });
    });
  }

  const valves: RuntimeValve[] = nodes
    .filter((item) => item.type === 'valve')
    .map((node) => {
      const connectedPipe = pipes.find((pipe) => pipe.fromNodeId === node.id || pipe.toNodeId === node.id) ?? null;
      return {
        id: `${node.code}-valve`,
        nodeId: node.id,
        nodeCode: node.code,
        pipeId: connectedPipe?.id ?? null,
        openingPct: clamp(toNumber(node.nodeParams.default_open_ratio_pct, 100), 0, 100),
      };
    });

  const outlets: RuntimeOutlet[] = nodes
    .filter((item) => item.type === 'outlet')
    .map((node) => ({
      id: `${node.code}-outlet`,
      nodeId: node.id,
      nodeCode: node.code,
      name: node.name,
      targetFlow: toNumber(node.nodeParams.target_flow_m3h, 10),
      minPressure: toNumber(node.nodeParams.min_pressure_m, 15),
    }));

  return { nodes, pipes, pumps, valves, outlets };
}

function buildDirectedAdjacency(pipes: RuntimePipe[]) {
  const outgoing = new Map<string, RuntimePipe[]>();
  const incoming = new Map<string, RuntimePipe[]>();
  for (const pipe of pipes) {
    const out = outgoing.get(pipe.fromNodeId) ?? [];
    out.push(pipe);
    outgoing.set(pipe.fromNodeId, out);
    const inc = incoming.get(pipe.toNodeId) ?? [];
    inc.push(pipe);
    incoming.set(pipe.toNodeId, inc);
  }
  return { outgoing, incoming };
}

function findDirectedPath(sourceNodeIds: string[], targetNodeId: string, pipes: RuntimePipe[]) {
  if (sourceNodeIds.length === 0) return null;
  const { outgoing, incoming } = buildDirectedAdjacency(pipes);
  const bfs = (nextEdges: (nodeId: string) => Array<{ nextNodeId: string; pipeId: string }>) => {
    const queue = sourceNodeIds.map((sourceNodeId) => ({
      sourceNodeId,
      nodeId: sourceNodeId,
      nodeIds: [sourceNodeId],
      pipeIds: [] as string[],
    }));
    const visited = new Set<string>(sourceNodeIds);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.nodeId === targetNodeId) {
        return current;
      }
      for (const candidate of nextEdges(current.nodeId)) {
        if (visited.has(candidate.nextNodeId)) continue;
        visited.add(candidate.nextNodeId);
        queue.push({
          sourceNodeId: current.sourceNodeId,
          nodeId: candidate.nextNodeId,
          nodeIds: [...current.nodeIds, candidate.nextNodeId],
          pipeIds: [...current.pipeIds, candidate.pipeId],
        });
      }
    }
    return null;
  };

  const directed = bfs((nodeId) =>
    (outgoing.get(nodeId) ?? []).map((pipe) => ({
      nextNodeId: pipe.toNodeId,
      pipeId: pipe.id,
    })),
  );
  if (directed) return directed;

  return bfs((nodeId) => [
    ...(outgoing.get(nodeId) ?? []).map((pipe) => ({
      nextNodeId: pipe.toNodeId,
      pipeId: pipe.id,
    })),
    ...(incoming.get(nodeId) ?? []).map((pipe) => ({
      nextNodeId: pipe.fromNodeId,
      pipeId: pipe.id,
    })),
  ]);
}

function describeReason(reasonCode: string) {
  switch (reasonCode) {
    case 'NO_REACHABLE_SOURCE_PATH':
      return '上游没有可达的供水源链路';
    case 'NO_SOURCE_CAPACITY':
      return '可达泵站剩余供水能力不足';
    case 'SOURCE_CAPACITY_EXHAUSTED':
      return '可达泵站供水能力已耗尽';
    default:
      return '当前未能分配到有效供水链路';
  }
}

function buildOutletAssignments(blueprint: RuntimeBlueprint, activeOutletIds: string[], eligibleSourceNodeIds?: string[] | null) {
  const activeOutletSpecs = blueprint.outlets.filter((outlet) => activeOutletIds.includes(outlet.id));
  const requestedOutletIds = activeOutletSpecs.map((item) => item.id);
  const sourcePumpGroups = new Map<string, RuntimePump[]>();
  for (const pump of blueprint.pumps) {
    if (Array.isArray(eligibleSourceNodeIds) && eligibleSourceNodeIds.length > 0 && !eligibleSourceNodeIds.includes(pump.parentNodeId)) {
      continue;
    }
    const group = sourcePumpGroups.get(pump.parentNodeId) ?? [];
    group.push(pump);
    sourcePumpGroups.set(pump.parentNodeId, group);
  }

  const sourceRank = new Map<string, number>();
  const remainingCapacityBySource = new Map<string, number>();
  const assignedCountBySource = new Map<string, number>();
  for (const [sourceNodeId, pumps] of sourcePumpGroups.entries()) {
    const sorted = [...pumps].sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return right.ratedFlow - left.ratedFlow;
    });
    sourcePumpGroups.set(sourceNodeId, sorted);
    sourceRank.set(sourceNodeId, sorted[0]?.priority ?? Number.MAX_SAFE_INTEGER);
    remainingCapacityBySource.set(
      sourceNodeId,
      sorted.reduce((sum, item) => sum + item.ratedFlow * ((item.frequencyRange[1] ?? 50) / 50), 0),
    );
    assignedCountBySource.set(sourceNodeId, 0);
  }

  const outletCandidates = activeOutletSpecs
    .map((outlet) => {
      const candidates = [...sourcePumpGroups.entries()]
        .map(([sourceNodeId, pumps]) => {
          const hydraulicNodeIds = [...new Set(pumps.map((pump) => pump.hydraulicNodeId))];
          const path = findDirectedPath(hydraulicNodeIds, outlet.nodeId, blueprint.pipes);
          if (!path) return null;
          return {
            sourceNodeId,
            sourceNodeCode: pumps[0]?.parentNodeCode ?? sourceNodeId,
            path,
            rank: sourceRank.get(sourceNodeId) ?? Number.MAX_SAFE_INTEGER,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      return { outlet, candidates };
    })
    .sort((left, right) => {
      if (left.candidates.length !== right.candidates.length) {
        return left.candidates.length - right.candidates.length;
      }
      return right.outlet.targetFlow - left.outlet.targetFlow;
    });

  const assignments: OutletAssignment[] = [];
  const unassignedOutletIds: string[] = [];
  const unassignedOutletReasons = new Map<string, string>();
  const allocatedDemandBySource = new Map<string, number>();
  const activePipeIds = new Set<string>();
  const activeNodeIds = new Set<string>();
  const activeSourceNodeIds = new Set<string>();

  for (const { outlet, candidates } of outletCandidates) {
    if (candidates.length === 0) {
      unassignedOutletIds.push(outlet.id);
      unassignedOutletReasons.set(outlet.id, 'NO_REACHABLE_SOURCE_PATH');
      continue;
    }

    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        remainingCapacity: remainingCapacityBySource.get(candidate.sourceNodeId) ?? 0,
        assignedCount: assignedCountBySource.get(candidate.sourceNodeId) ?? 0,
      }))
      .sort((left, right) => {
        const leftBucket =
          left.remainingCapacity >= outlet.targetFlow ? 0 : left.remainingCapacity > 0 ? 1 : 2;
        const rightBucket =
          right.remainingCapacity >= outlet.targetFlow ? 0 : right.remainingCapacity > 0 ? 1 : 2;
        if (leftBucket !== rightBucket) return leftBucket - rightBucket;
        const leftReuseBucket = left.assignedCount > 0 ? 0 : 1;
        const rightReuseBucket = right.assignedCount > 0 ? 0 : 1;
        if (leftReuseBucket !== rightReuseBucket) return leftReuseBucket - rightReuseBucket;
        if (left.rank !== right.rank) return left.rank - right.rank;
        if (left.path.pipeIds.length !== right.path.pipeIds.length) return left.path.pipeIds.length - right.path.pipeIds.length;
        return right.remainingCapacity - left.remainingCapacity;
      });

    const selected = ranked.find((item) => item.remainingCapacity > 0);
    if (!selected) {
      unassignedOutletIds.push(outlet.id);
      unassignedOutletReasons.set(outlet.id, 'NO_SOURCE_CAPACITY');
      continue;
    }

    const allocatedFlow = Math.min(outlet.targetFlow, selected.remainingCapacity);
    if (allocatedFlow <= 0) {
      unassignedOutletIds.push(outlet.id);
      unassignedOutletReasons.set(outlet.id, 'SOURCE_CAPACITY_EXHAUSTED');
      continue;
    }

    assignments.push({
      outletId: outlet.id,
      outletNodeId: outlet.nodeId,
      outletName: outlet.name,
      sourceNodeId: selected.sourceNodeId,
      sourceNodeCode: selected.sourceNodeCode,
      targetFlow: outlet.targetFlow,
      allocatedFlow,
      pipeIds: selected.path.pipeIds,
      nodeIds: selected.path.nodeIds,
    });

    remainingCapacityBySource.set(selected.sourceNodeId, Math.max(selected.remainingCapacity - allocatedFlow, 0));
    assignedCountBySource.set(selected.sourceNodeId, selected.assignedCount + 1);
    allocatedDemandBySource.set(
      selected.sourceNodeId,
      (allocatedDemandBySource.get(selected.sourceNodeId) ?? 0) + allocatedFlow,
    );
    activeSourceNodeIds.add(selected.sourceNodeId);
    selected.path.pipeIds.forEach((pipeId) => activePipeIds.add(pipeId));
    selected.path.nodeIds.forEach((nodeId) => activeNodeIds.add(nodeId));
  }

  return {
    requestedOutletIds,
    assignments,
    unassignedOutletIds,
    unassignedOutletReasons,
    allocatedDemandBySource,
    activePipeIds: [...activePipeIds],
    activeNodeIds: [...activeNodeIds],
    activeSourceNodeIds: [...activeSourceNodeIds],
  };
}

export function buildSolverRuntimeSnapshot(input: {
  graphDraft: GraphDraft | null | undefined;
  activeOutletIds: string[];
  eligibleSourceNodeIds?: string[] | null;
}): SolverRuntimeSnapshot | null {
  const blueprint = buildRuntimeBlueprint(input.graphDraft);
  if (!blueprint) return null;

  const requestedOutletIds = input.activeOutletIds.filter((id) => blueprint.outlets.some((outlet) => outlet.id === id));
  if (requestedOutletIds.length === 0) {
    return {
      mode: 'network_allocation_v1',
      notes: ['No active outlet ids were provided to the runtime allocation layer.'],
      summary: {
        requested_outlet_count: 0,
        assigned_outlet_count: 0,
        unassigned_outlet_count: 0,
        requested_demand_flow_m3h: 0,
        assigned_demand_flow_m3h: 0,
        planned_supply_flow_m3h: 0,
        flow_gap_m3h: 0,
        active_pump_count: 0,
        active_valve_count: 0,
      },
      mass_balance: {
        requested_demand_flow_m3h: 0,
        assigned_demand_flow_m3h: 0,
        planned_supply_flow_m3h: 0,
        flow_gap_m3h: 0,
        balance_status: 'balanced',
      },
      active_graph: {
        node_ids: [],
        pipe_ids: [],
        pump_ids: [],
        valve_ids: [],
        source_node_ids: [],
      },
      allocation: {
        requested_outlet_ids: [],
        assigned_outlet_ids: [],
        unassigned_outlets: [],
        outlet_allocations: [],
      },
      controls: {
        pump_controls: blueprint.pumps.map((pump) => ({
          pump_id: pump.id,
          parent_node_id: pump.parentNodeId,
          parent_node_code: pump.parentNodeCode,
          running: false,
          frequency_hz: pump.frequencyRange[0],
          planned_flow_m3h: 0,
          rated_flow_m3h: pump.ratedFlow,
        })),
        valve_controls: blueprint.valves.map((valve) => ({
          valve_id: valve.id,
          node_id: valve.nodeId,
          node_code: valve.nodeCode,
          pipe_id: valve.pipeId,
          open: false,
          opening_pct: 0,
        })),
      },
    };
  }

  const allocation = buildOutletAssignments(blueprint, requestedOutletIds, input.eligibleSourceNodeIds);
  const assignedOutletIds = new Set(allocation.assignments.map((item) => item.outletId));
  const assignedSourceNodeIds = new Set(allocation.activeSourceNodeIds);

  const sourceDemandMap = new Map(allocation.allocatedDemandBySource);
  const candidatePumps = blueprint.pumps
    .filter((pump) => assignedSourceNodeIds.size === 0 || assignedSourceNodeIds.has(pump.parentNodeId))
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (left.parentNodeId !== right.parentNodeId) return left.parentNodeId.localeCompare(right.parentNodeId);
      return right.ratedFlow - left.ratedFlow;
    });

  const pumpControls = new Map<
    string,
    {
      pump_id: string;
      parent_node_id: string;
      parent_node_code: string;
      running: boolean;
      frequency_hz: number;
      planned_flow_m3h: number;
      rated_flow_m3h: number;
    }
  >();
  let plannedSupplyFlow = 0;

  for (const pump of candidatePumps) {
    const minFrequency = pump.frequencyRange[0];
    const maxFrequency = pump.frequencyRange[1];
    const remainingDemand = sourceDemandMap.get(pump.parentNodeId) ?? 0;
    const minFlow = pump.ratedFlow * (minFrequency / 50);
    if (remainingDemand <= 0) {
      pumpControls.set(pump.id, {
        pump_id: pump.id,
        parent_node_id: pump.parentNodeId,
        parent_node_code: pump.parentNodeCode,
        running: false,
        frequency_hz: minFrequency,
        planned_flow_m3h: 0,
        rated_flow_m3h: pump.ratedFlow,
      });
      continue;
    }

    const desiredFlow = clamp(remainingDemand < minFlow ? minFlow : remainingDemand, minFlow, pump.ratedFlow);
    const frequency = clamp((desiredFlow / Math.max(pump.ratedFlow, 1)) * 50, minFrequency, maxFrequency);
    const suppliedFlow = pump.ratedFlow * (frequency / 50);
    plannedSupplyFlow += suppliedFlow;
    sourceDemandMap.set(pump.parentNodeId, Math.max(0, remainingDemand - suppliedFlow));
    pumpControls.set(pump.id, {
      pump_id: pump.id,
      parent_node_id: pump.parentNodeId,
      parent_node_code: pump.parentNodeCode,
      running: true,
      frequency_hz: Math.round(frequency),
      planned_flow_m3h: suppliedFlow,
      rated_flow_m3h: pump.ratedFlow,
    });
  }

  for (const pump of blueprint.pumps) {
    if (!pumpControls.has(pump.id)) {
      pumpControls.set(pump.id, {
        pump_id: pump.id,
        parent_node_id: pump.parentNodeId,
        parent_node_code: pump.parentNodeCode,
        running: false,
        frequency_hz: pump.frequencyRange[0],
        planned_flow_m3h: 0,
        rated_flow_m3h: pump.ratedFlow,
      });
    }
  }

  const activePipeIds = new Set(allocation.activePipeIds);
  const activeNodeIds = new Set(allocation.activeNodeIds);
  const activePumpIds = new Set(
    [...pumpControls.values()].filter((item) => item.running).map((item) => item.pump_id),
  );

  for (const pump of blueprint.pumps) {
    if (activePumpIds.has(pump.id)) {
      activeNodeIds.add(pump.parentNodeId);
    }
  }

  const valveControls = blueprint.valves.map((valve) => {
    const open =
      assignedOutletIds.size > 0 &&
      ((valve.pipeId ? activePipeIds.has(valve.pipeId) : false) || activeNodeIds.has(valve.nodeId));
    return {
      valve_id: valve.id,
      node_id: valve.nodeId,
      node_code: valve.nodeCode,
      pipe_id: valve.pipeId,
      open,
      opening_pct: open ? Math.max(valve.openingPct, 10) : 0,
    };
  });

  const activeValveIds = valveControls.filter((item) => item.open).map((item) => item.valve_id);

  const requestedDemandFlow = blueprint.outlets
    .filter((outlet) => requestedOutletIds.includes(outlet.id))
    .reduce((sum, outlet) => sum + outlet.targetFlow, 0);
  const assignedDemandFlow = allocation.assignments.reduce((sum, item) => sum + item.allocatedFlow, 0);
  const flowGap = Number((plannedSupplyFlow - assignedDemandFlow).toFixed(3));
  const balanceStatus =
    Math.abs(flowGap) <= 0.5 ? 'balanced' : flowGap < 0 ? 'under_supplied' : 'over_supplied';

  return {
    mode: 'network_allocation_v1',
    notes: [
      'Runtime snapshot is generated by the backend network allocation layer.',
      'Hydraulic kernel is not yet attached; planned supply and allocated outlet demand are balanced heuristically.',
    ],
    summary: {
      requested_outlet_count: requestedOutletIds.length,
      assigned_outlet_count: allocation.assignments.length,
      unassigned_outlet_count: allocation.unassignedOutletIds.length,
      requested_demand_flow_m3h: Number(requestedDemandFlow.toFixed(3)),
      assigned_demand_flow_m3h: Number(assignedDemandFlow.toFixed(3)),
      planned_supply_flow_m3h: Number(plannedSupplyFlow.toFixed(3)),
      flow_gap_m3h: flowGap,
      active_pump_count: activePumpIds.size,
      active_valve_count: activeValveIds.length,
    },
    mass_balance: {
      requested_demand_flow_m3h: Number(requestedDemandFlow.toFixed(3)),
      assigned_demand_flow_m3h: Number(assignedDemandFlow.toFixed(3)),
      planned_supply_flow_m3h: Number(plannedSupplyFlow.toFixed(3)),
      flow_gap_m3h: flowGap,
      balance_status: balanceStatus,
    },
    active_graph: {
      node_ids: [...activeNodeIds],
      pipe_ids: [...activePipeIds],
      pump_ids: [...activePumpIds],
      valve_ids: activeValveIds,
      source_node_ids: allocation.activeSourceNodeIds,
    },
    allocation: {
      requested_outlet_ids: requestedOutletIds,
      assigned_outlet_ids: allocation.assignments.map((item) => item.outletId),
      unassigned_outlets: allocation.unassignedOutletIds.map((outletId) => {
        const outlet = blueprint.outlets.find((item) => item.id === outletId);
        const reasonCode = allocation.unassignedOutletReasons.get(outletId) ?? 'UNASSIGNED';
        return {
          outlet_id: outletId,
          outlet_node_id: outlet?.nodeId ?? outletId,
          outlet_name: outlet?.name ?? outletId,
          reason_code: reasonCode,
          reason: describeReason(reasonCode),
        };
      }),
      outlet_allocations: allocation.assignments.map((item) => ({
        outlet_id: item.outletId,
        outlet_node_id: item.outletNodeId,
        outlet_name: item.outletName,
        source_node_id: item.sourceNodeId,
        source_node_code: item.sourceNodeCode,
        target_flow_m3h: Number(item.targetFlow.toFixed(3)),
        allocated_flow_m3h: Number(item.allocatedFlow.toFixed(3)),
        pipe_ids: item.pipeIds,
        node_ids: item.nodeIds,
      })),
    },
    controls: {
      pump_controls: [...pumpControls.values()],
      valve_controls: valveControls,
    },
  };
}
