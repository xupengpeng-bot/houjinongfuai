import { Client, Pool } from 'pg';
import {
  embeddedRealDeviceExecutionCatalog,
  type EmbeddedRealDeviceCase,
  type RealDeviceOracle,
  type RealDeviceStep,
} from './rd-cases';

type CommandRow = {
  id: string;
  command_code: string;
  command_status: string;
  session_id: string | null;
  session_ref: string | null;
  created_at: string;
  sent_at: string | null;
  acked_at: string | null;
  failed_at: string | null;
  timeout_at: string | null;
  response_payload_json: Record<string, any> | null;
};

type MessageRow = {
  direction: string;
  msg_type: string;
  event_type: string;
  server_rx_ts: string;
  payload_json: Record<string, any> | null;
};

type DeviceStateRow = {
  id: string;
  imei: string;
  device_code: string;
  device_name: string | null;
  online_state: string | null;
  connection_state: string | null;
  runtime_state: string | null;
  last_heartbeat_at: string | null;
  updated_at: string;
};

type SessionRow = {
  id: string;
  session_ref: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  end_reason_code: string | null;
};

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  settlement_status: string | null;
  payment_status: string | null;
  amount: number;
  locked_amount: number;
  refunded_amount: number;
  pricing_detail_json: Record<string, any> | null;
};

type WalletRow = {
  balance: number;
  locked_balance: number;
};

type ProbeCase = {
  label: string;
  kind: 'query' | 'execute';
  body: Record<string, unknown>;
};

type StepExecutionResult = {
  step_code: string;
  kind: string;
  command_id?: string | null;
  final_status?: string | null;
  final_transport?: Record<string, unknown> | null;
  messages?: MessageRow[];
  metrics_series?: Array<Record<string, unknown>>;
  queue_after?: Record<string, number>;
  device_state?: DeviceStateRow | null;
};

type IterationResult = {
  iteration: number;
  passed: boolean;
  reasons: string[];
  step_results: StepExecutionResult[];
  queue_after: Record<string, number>;
  active_sessions_after: SessionRow[];
};

const apiBase = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/houji_p1';
const imei = process.env.PROBE_IMEI || '861295087573980';
const targetRef = process.env.PROBE_TARGET_REF || 'pump_1';
const moduleCode = process.env.PROBE_MODULE_CODE || 'pump_direct_control';
const source = process.env.PROBE_SOURCE || 'codex_real_oracle_runner';
const singleTimeoutMs = Number(process.env.ORACLE_SINGLE_TIMEOUT_MS || 20000);
const pollIntervalMs = Number(process.env.ORACLE_POLL_INTERVAL_MS || 1000);
const settleDelayMs = Number(process.env.ORACLE_SETTLE_DELAY_MS || 3000);
const repeatCap = Math.max(1, Number(process.env.ORACLE_REPEAT_CAP || 3));
const readyOnly = !['false', '0', 'off', 'no'].includes(String(process.env.ORACLE_READY_ONLY || 'true').toLowerCase());
const caseIds = String(process.env.ORACLE_CASE_IDS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTransport(responsePayload: Record<string, any> | null | undefined) {
  const transport = responsePayload?.transport ?? {};
  const gatewayPayload = responsePayload?.gateway_payload ?? {};
  return {
    last_transition: transport.last_transition ?? null,
    nack_reason: transport.nack_reason ?? null,
    dead_letter_reason: transport.dead_letter_reason ?? null,
    gateway_reason_code: gatewayPayload.reason_code ?? null,
    gateway_reject_code: gatewayPayload.reject_code ?? null,
    gateway_message: gatewayPayload.msg ?? gatewayPayload.message ?? null,
  };
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function deepExtractMetric(payload: Record<string, any> | null | undefined, aliases: string[]): number | string | null {
  if (!payload) return null;
  const queue: Array<Record<string, any>> = [payload];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const alias of aliases) {
      if (alias in current) {
        const hit = current[alias];
        if (typeof hit === 'string' || typeof hit === 'number') return hit;
      }
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        queue.push(value as Record<string, any>);
      }
    }
  }
  return null;
}

async function postProbe(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, body: json };
}

async function waitForCommand(client: Client, commandId: string) {
  const deadline = Date.now() + singleTimeoutMs;
  let lastRow: CommandRow | null = null;
  while (Date.now() < deadline) {
    const result = await client.query<CommandRow>(
      `
      select
        id,
        command_code,
        command_status,
        session_id::text,
        session_ref,
        created_at::text,
        sent_at::text,
        acked_at::text,
        failed_at::text,
        timeout_at::text,
        response_payload_json
      from device_command
      where id = $1::uuid
      limit 1
      `,
      [commandId],
    );
    const row = result.rows[0] ?? null;
    if (row) {
      lastRow = row;
      if (['acked', 'failed', 'dead_letter'].includes(row.command_status)) return row;
    }
    await sleep(pollIntervalMs);
  }
  return lastRow;
}

async function loadMessagesByCommandId(client: Client, commandId: string) {
  const result = await client.query<MessageRow>(
    `
    select
      direction,
      msg_type,
      event_type,
      server_rx_ts::text,
      payload_json
    from device_message_log_v2
    where command_id = $1::uuid
    order by server_rx_ts asc
    limit 20
    `,
    [commandId],
  );
  return result.rows;
}

async function loadDeviceState(client: Client) {
  const result = await client.query<DeviceStateRow>(
    `
    select
      id::text,
      imei,
      device_code,
      device_name,
      online_state,
      connection_state,
      runtime_state,
      last_heartbeat_at::text,
      updated_at::text
    from device
    where imei = $1
    limit 1
    `,
    [imei],
  );
  return result.rows[0] ?? null;
}

async function loadQueueResidue(client: Client) {
  const result = await client.query<{ created: number; sent: number; retry_pending: number }>(
    `
    select
      count(*) filter (where command_status = 'created')::int as created,
      count(*) filter (where command_status = 'sent')::int as sent,
      count(*) filter (where command_status = 'retry_pending')::int as retry_pending
    from device_command
    where imei = $1
      and created_at > now() - interval '30 minutes'
    `,
    [imei],
  );
  return result.rows[0] ?? { created: 0, sent: 0, retry_pending: 0 };
}

async function loadActiveSessions(client: Client) {
  const result = await client.query<SessionRow>(
    `
    select
      id::text,
      session_ref,
      status,
      started_at::text,
      ended_at::text,
      end_reason_code
    from runtime_session
    where device_key = $1
      and status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
    order by updated_at desc
    limit 20
    `,
    [imei],
  );
  return result.rows;
}

async function loadOrderBySessionId(client: Client, sessionId: string) {
  const result = await client.query<OrderRow>(
    `
    select
      id::text,
      order_no,
      status,
      settlement_status,
      payment_status,
      amount::float8,
      locked_amount::float8,
      refunded_amount::float8,
      pricing_detail_json
    from irrigation_order
    where session_id = $1::uuid
    limit 1
    `,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

async function loadWalletBySessionId(client: Client, sessionId: string) {
  const result = await client.query<WalletRow>(
    `
    select
      fw.balance::float8 as balance,
      coalesce(fw.locked_balance, 0)::float8 as locked_balance
    from irrigation_order io
    join farmer_wallet fw on fw.tenant_id = io.tenant_id and fw.user_id = io.user_id
    where io.session_id = $1::uuid
    limit 1
    `,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

async function runSingleProbe(client: Client, probe: ProbeCase, runLabel: string): Promise<StepExecutionResult> {
  const path = probe.kind === 'query' ? '/ops/device-gateway/query' : '/ops/device-gateway/execute';
  const response = await postProbe(path, probe.body);
  const commandId = response.body?.data?.command?.id ?? null;
  const finalCommand = commandId ? await waitForCommand(client, commandId) : null;
  const messages = commandId ? await loadMessagesByCommandId(client, commandId) : [];
  return {
    step_code: probe.label,
    kind: probe.kind,
    command_id: commandId,
    final_status: finalCommand?.command_status ?? null,
    final_transport: summarizeTransport(finalCommand?.response_payload_json),
    messages,
  };
}

async function executeObserveStep(client: Client, step: RealDeviceStep, caseDef: EmbeddedRealDeviceCase): Promise<StepExecutionResult> {
  if (step.code === 'HB') {
    await sleep(2000);
    return { step_code: step.code, kind: step.kind, device_state: await loadDeviceState(client) };
  }

  if (step.code === 'STATUS_SERIES_X10') {
    const series: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 10; index += 1) {
      const probe = await runSingleProbe(
        client,
        {
          label: `status_series_${index}`,
          kind: 'query',
          body: {
            imei,
            query_code: 'QUERY_COMMON_STATUS',
            source: `${source}.${caseDef.id}.${index}`,
            dispatch_mode: 'sync',
          },
        },
        `${caseDef.id}_${index}`,
      );
      const inbound = [...(probe.messages ?? [])].reverse().find((item) => item.direction === 'inbound');
      series.push({
        index,
        final_status: probe.final_status,
        rt: deepExtractMetric(inbound?.payload_json, ['rt', 'cumulative_runtime_sec']),
        fq: deepExtractMetric(inbound?.payload_json, ['fq', 'total_m3']),
        ek: deepExtractMetric(inbound?.payload_json, ['ek', 'energy_kwh']),
      });
      await sleep(500);
    }
    return { step_code: step.code, kind: step.kind, metrics_series: series };
  }

  const buildStormCases = (mode: 'query' | 'mixed' | 'crossfire') => {
    const probes: ProbeCase[] = [];
    const rounds = mode === 'query' ? 12 : 18;
    for (let index = 0; index < rounds; index += 1) {
      if (mode === 'query') {
        const queryCode = index % 3 === 0 ? 'QUERY_COMMON_STATUS' : index % 3 === 1 ? 'QUERY_WORKFLOW_STATE' : 'QUERY_ELECTRIC_METER';
        probes.push({
          label: `${mode}_${index}`,
          kind: 'query',
          body: { imei, query_code: queryCode, source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' },
        });
        continue;
      }

      const choice = index % (mode === 'mixed' ? 7 : 6);
      if (choice === 0) probes.push({ label: `${mode}_${index}`, kind: 'query', body: { imei, query_code: 'QUERY_COMMON_STATUS', source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
      if (choice === 1) probes.push({ label: `${mode}_${index}`, kind: 'query', body: { imei, query_code: 'QUERY_WORKFLOW_STATE', source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
      if (choice === 2) probes.push({ label: `${mode}_${index}`, kind: 'query', body: { imei, query_code: 'QUERY_ELECTRIC_METER', source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
      if (choice === 3) probes.push({ label: `${mode}_${index}`, kind: 'execute', body: { imei, action_code: 'stop_pump', scope: 'module', target_ref: targetRef, module_code: moduleCode, source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
      if (choice === 4) probes.push({ label: `${mode}_${index}`, kind: 'execute', body: { imei, action_code: 'pause_session', scope: 'workflow', source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
      if (choice === 5) probes.push({ label: `${mode}_${index}`, kind: 'execute', body: { imei, action_code: 'resume_session', scope: 'workflow', source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
      if (mode === 'mixed' && choice === 6) probes.push({ label: `${mode}_${index}`, kind: 'execute', body: { imei, action_code: 'start_pump', scope: 'module', target_ref: targetRef, module_code: moduleCode, source: `${source}.${caseDef.id}.${mode}`, dispatch_mode: 'sync' } });
    }
    return probes;
  };

  const mode =
    step.code === 'QUERY_STORM_X20'
      ? 'query'
      : step.code === 'RUN_MIXED_STORM'
        ? 'mixed'
        : step.code === 'RUN_QUERY_CONTROL_CROSSFIRE'
          ? 'crossfire'
          : null;

  if (mode) {
    const probes = buildStormCases(mode);
    const results = await Promise.all(probes.map((probe, index) => runSingleProbe(client, probe, `${caseDef.id}_${mode}_${index}`)));
    return {
      step_code: step.code,
      kind: step.kind,
      queue_after: await loadQueueResidue(client),
      messages: [],
      final_transport: {
        statuses: results.map((item) => item.final_status),
      },
    };
  }

  return { step_code: step.code, kind: step.kind };
}

async function executeStep(client: Client, step: RealDeviceStep, caseDef: EmbeddedRealDeviceCase) {
  if (step.kind === 'query' || step.kind === 'execute') {
    const body = { ...(step.bodyTemplate ?? {}), imei, target_ref: targetRef, module_code: moduleCode, source: `${source}.${caseDef.id}` };
    return runSingleProbe(client, { label: step.code, kind: step.kind, body }, `${caseDef.id}_${step.code}`);
  }

  return executeObserveStep(client, step, caseDef);
}

function hasCorrelatedInboundMessage(stepResult: StepExecutionResult) {
  const messages = stepResult.messages ?? [];
  return messages.some((item) => item.direction === 'inbound');
}

function evaluateOracle(oracle: RealDeviceOracle, context: {
  deviceState: DeviceStateRow | null;
  queueAfter: Record<string, number>;
  activeSessionsAfter: SessionRow[];
  stepResults: StepExecutionResult[];
}): string[] {
  const failures: string[] = [];
  if (oracle.scope === 'command') {
    const unresolved = context.stepResults.filter(
      (item) => item.command_id && ['created', 'sent', 'retry_pending', null, undefined].includes(item.final_status as any),
    );
    if (unresolved.length > 0) failures.push(`unresolved_commands:${unresolved.map((item) => item.step_code).join(',')}`);
  }
  if (oracle.scope === 'message') {
    const uncorrelated = context.stepResults.filter(
      (item) => item.command_id && (item.final_status === 'acked' || item.final_status === 'failed') && !hasCorrelatedInboundMessage(item),
    );
    if (uncorrelated.length > 0) failures.push(`uncorrelated_messages:${uncorrelated.map((item) => item.step_code).join(',')}`);
  }
  if (oracle.scope === 'device') {
    if (context.deviceState?.connection_state !== 'connected' || context.deviceState?.online_state !== 'online') {
      failures.push(`device_state:${context.deviceState?.online_state ?? 'unknown'}/${context.deviceState?.connection_state ?? 'unknown'}`);
    }
  }
  if (oracle.scope === 'session') {
    const stuck = context.activeSessionsAfter.filter((item) => ['pending_start', 'pausing', 'resuming'].includes(item.status));
    if (stuck.length > 0) failures.push(`stuck_sessions:${stuck.map((item) => `${item.session_ref ?? item.id}:${item.status}`).join(',')}`);
  }
  if (oracle.scope === 'order') {
    if (context.queueAfter.sent > 0) failures.push(`queue_sent_residue:${context.queueAfter.sent}`);
  }
  return failures;
}

function evaluateCaseSpecific(caseDef: EmbeddedRealDeviceCase, iteration: IterationResult) {
  const failures: string[] = [];
  const stepResults = iteration.step_results;
  const first = stepResults[0];

  const expectExplicitFailure = ['CMD-007', 'PAUSE-002', 'PAUSE-004'].includes(caseDef.id);
  if (expectExplicitFailure && first && first.final_status === 'acked') {
    failures.push(`expected_failure_but_acked:${caseDef.id}`);
  }

  const expectQuerySuccess = ['QUERY-001', 'QUERY-002', 'QUERY-003'].includes(caseDef.id);
  if (expectQuerySuccess && first && first.final_status !== 'acked') {
    failures.push(`expected_query_success:${caseDef.id}:${first.final_status ?? 'null'}`);
  }

  if (caseDef.id === 'METER-007') {
    const series = stepResults.find((item) => item.step_code === 'STATUS_SERIES_X10')?.metrics_series ?? [];
    const rtValues = series.map((item) => asNumber(item.rt)).filter((item): item is number => item !== null);
    if (rtValues.length < 2) {
      failures.push('metrics_missing:rt');
    } else {
      for (let index = 1; index < rtValues.length; index += 1) {
        if (rtValues[index] < rtValues[index - 1]) {
          failures.push(`runtime_not_monotonic:${rtValues[index - 1]}->${rtValues[index]}`);
          break;
        }
      }
    }
  }

  if (['QUERY-005', 'STRESS-001', 'STRESS-002', 'STRESS-008'].includes(caseDef.id) && iteration.queue_after.sent > 0) {
    failures.push(`stress_residue_sent:${iteration.queue_after.sent}`);
  }

  return failures;
}

function buildImprovementDirectives(caseDef: EmbeddedRealDeviceCase, reasons: string[]) {
  return {
    case_id: caseDef.id,
    title: caseDef.title,
    reasons,
    improvement_targets: caseDef.improvementTargets,
    short_instructions: [
      `修复 ${caseDef.id} 对应问题，不要只处理现象，要修根因。`,
      `重点检查：${caseDef.improvementTargets?.join('、') ?? '协议关联、状态机一致性、静默超时路径'}`,
      `完成后回归：${caseDef.id} 及其相邻高风险场景。`,
    ],
  };
}

async function runCase(client: Client, caseDef: EmbeddedRealDeviceCase): Promise<{ case_id: string; passed: boolean; pass_rate: number; iterations: IterationResult[]; directives: any[] }> {
  const iterationLimit = Math.min(caseDef.repeat?.iterations ?? 1, repeatCap);
  const iterations: IterationResult[] = [];

  for (let index = 0; index < iterationLimit; index += 1) {
    const stepResults: StepExecutionResult[] = [];
    for (const step of caseDef.steps) {
      stepResults.push(await executeStep(client, step, caseDef));
      await sleep(300);
    }

    await sleep(settleDelayMs);
    const queueAfter = await loadQueueResidue(client);
    const activeSessionsAfter = await loadActiveSessions(client);
    const deviceState = await loadDeviceState(client);
    const oracleFailures = (caseDef.oracles ?? []).flatMap((oracle) =>
      evaluateOracle(oracle, {
        deviceState,
        queueAfter,
        activeSessionsAfter,
        stepResults,
      }),
    );
    const caseFailures = evaluateCaseSpecific(caseDef, {
      iteration: index + 1,
      passed: false,
      reasons: [],
      step_results: stepResults,
      queue_after: queueAfter,
      active_sessions_after: activeSessionsAfter,
    });

    const reasons = [...oracleFailures, ...caseFailures];
    iterations.push({
      iteration: index + 1,
      passed: reasons.length === 0,
      reasons,
      step_results: stepResults,
      queue_after: queueAfter,
      active_sessions_after: activeSessionsAfter,
    });
  }

  const passCount = iterations.filter((item) => item.passed).length;
  const passRate = iterations.length === 0 ? 0 : passCount / iterations.length;
  const passed = passRate >= (caseDef.repeat?.minPassRate ?? 1);
  const directives = passed
    ? []
    : [
        buildImprovementDirectives(
          caseDef,
          [...new Set(iterations.flatMap((item) => item.reasons))],
        ),
      ];

  return {
    case_id: caseDef.id,
    passed,
    pass_rate: Number(passRate.toFixed(4)),
    iterations,
    directives,
  };
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const cases = embeddedRealDeviceExecutionCatalog.filter((item) => {
      if (readyOnly && item.readiness !== 'ready') return false;
      if (caseIds.length > 0 && !caseIds.includes(item.id)) return false;
      return true;
    });

    const report: Record<string, unknown> = {
      started_at: new Date().toISOString(),
      api_base: apiBase,
      imei,
      source,
      repeat_cap: repeatCap,
      ready_only: readyOnly,
      selected_case_ids: cases.map((item) => item.id),
      initial_device_state: await loadDeviceState(client),
      initial_queue_residue: await loadQueueResidue(client),
    };

    const caseReports = [];
    for (const caseDef of cases) {
      caseReports.push(await runCase(client, caseDef));
    }

    report.case_reports = caseReports;
    report.failed_case_count = caseReports.filter((item: any) => !item.passed).length;
    report.improvement_directives = caseReports.flatMap((item: any) => item.directives);
    report.final_device_state = await loadDeviceState(client);
    report.final_queue_residue = await loadQueueResidue(client);
    report.finished_at = new Date().toISOString();

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
