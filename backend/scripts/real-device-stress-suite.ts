import { Client, Pool } from 'pg';

type ProbeKind = 'query' | 'execute';

type ProbeCase = {
  label: string;
  kind: ProbeKind;
  body: Record<string, unknown>;
};

type CommandRow = {
  id: string;
  command_code: string;
  command_status: string;
  created_at: string;
  sent_at: string | null;
  acked_at: string | null;
  failed_at: string | null;
  timeout_at: string | null;
  response_payload_json: Record<string, any> | null;
};

type Queryable = Pick<Client, 'query'>;

const apiBase = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/houji_p1';
const imei = process.env.PROBE_IMEI || '861295087573980';
const targetRef = process.env.PROBE_TARGET_REF || 'pump_1';
const moduleCode = process.env.PROBE_MODULE_CODE || 'pump_direct_control';
const source = process.env.PROBE_SOURCE || 'codex_real_stress_suite';
const singleTimeoutMs = Number(process.env.SUITE_SINGLE_TIMEOUT_MS || 20000);
const settleDelayMs = Number(process.env.SUITE_SETTLE_DELAY_MS || 4000);
const queryStormRounds = Number(process.env.SUITE_QUERY_STORM_ROUNDS || 4);
const queryStormConcurrency = Number(process.env.SUITE_QUERY_STORM_CONCURRENCY || 6);
const mixedStormRounds = Number(process.env.SUITE_MIXED_STORM_ROUNDS || 3);
const mixedStormConcurrency = Number(process.env.SUITE_MIXED_STORM_CONCURRENCY || 5);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
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

function baseScenarios(): ProbeCase[] {
  return [
    {
      label: 'qcs',
      kind: 'query',
      body: {
        imei,
        query_code: 'QUERY_COMMON_STATUS',
        source,
        dispatch_mode: 'sync',
      },
    },
    {
      label: 'qwf',
      kind: 'query',
      body: {
        imei,
        query_code: 'QUERY_WORKFLOW_STATE',
        source,
        dispatch_mode: 'sync',
      },
    },
    {
      label: 'qem',
      kind: 'query',
      body: {
        imei,
        query_code: 'QUERY_ELECTRIC_METER',
        source,
        dispatch_mode: 'sync',
      },
    },
    {
      label: 'pause_session',
      kind: 'execute',
      body: {
        imei,
        action_code: 'pause_session',
        scope: 'workflow',
        source,
        dispatch_mode: 'sync',
      },
    },
    {
      label: 'resume_session',
      kind: 'execute',
      body: {
        imei,
        action_code: 'resume_session',
        scope: 'workflow',
        source,
        dispatch_mode: 'sync',
      },
    },
    {
      label: 'stop_pump',
      kind: 'execute',
      body: {
        imei,
        action_code: 'stop_pump',
        scope: 'module',
        target_ref: targetRef,
        module_code: moduleCode,
        source,
        dispatch_mode: 'sync',
      },
    },
    {
      label: 'start_pump',
      kind: 'execute',
      body: {
        imei,
        action_code: 'start_pump',
        scope: 'module',
        target_ref: targetRef,
        module_code: moduleCode,
        source,
        dispatch_mode: 'sync',
      },
    },
  ];
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

async function waitForCommand(client: Queryable, commandId: string) {
  const deadline = Date.now() + singleTimeoutMs;
  let lastRow: CommandRow | null = null;
  while (Date.now() < deadline) {
    const result = await client.query<CommandRow>(
      `
      select
        id,
        command_code,
        command_status,
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
      if (['acked', 'failed', 'dead_letter'].includes(row.command_status)) {
        return row;
      }
    }
    await sleep(1000);
  }
  return lastRow;
}

async function loadCommandById(client: Queryable, commandId: string) {
  const result = await client.query<CommandRow>(
    `
    select
      id,
      command_code,
      command_status,
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
  return result.rows[0] ?? null;
}

async function runSingle(pool: Pool, probe: ProbeCase, runLabel: string) {
  const path = probe.kind === 'query' ? '/ops/device-gateway/query' : '/ops/device-gateway/execute';
  const issuedAt = new Date().toISOString();
  const body = { ...probe.body, source: `${source}.${runLabel}` };
  const response = await postProbe(path, body);
  const commandId = response.body?.data?.command?.id ?? null;
  const delivery = response.body?.data?.delivery ?? null;
  const dbClient = await pool.connect();
  try {
    const finalCommand = commandId ? await waitForCommand(dbClient, commandId) : null;

    return {
      run_label: runLabel,
      case_label: probe.label,
      kind: probe.kind,
      issued_at: issuedAt,
      command_id: commandId,
      http_status: response.status,
      delivery,
      final_status: finalCommand?.command_status ?? null,
      final_transport: summarizeTransport(finalCommand?.response_payload_json),
    };
  } finally {
    dbClient.release();
  }
}

async function loadDeviceState(client: Client) {
  const device = await client.query(
    `
    select
      id,
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
  return device.rows[0] ?? null;
}

function randomMixedProbe(index: number): ProbeCase {
  const options: ProbeCase[] = [
    {
      label: `mixed_qcs_${index}`,
      kind: 'query',
      body: { imei, query_code: 'QUERY_COMMON_STATUS', dispatch_mode: 'sync' },
    },
    {
      label: `mixed_qwf_${index}`,
      kind: 'query',
      body: { imei, query_code: 'QUERY_WORKFLOW_STATE', dispatch_mode: 'sync' },
    },
    {
      label: `mixed_qem_${index}`,
      kind: 'query',
      body: { imei, query_code: 'QUERY_ELECTRIC_METER', dispatch_mode: 'sync' },
    },
    {
      label: `mixed_start_${index}`,
      kind: 'execute',
      body: {
        imei,
        action_code: 'start_pump',
        scope: 'module',
        target_ref: targetRef,
        module_code: moduleCode,
        dispatch_mode: 'sync',
      },
    },
    {
      label: `mixed_stop_${index}`,
      kind: 'execute',
      body: {
        imei,
        action_code: 'stop_pump',
        scope: 'module',
        target_ref: targetRef,
        module_code: moduleCode,
        dispatch_mode: 'sync',
      },
    },
    {
      label: `mixed_pause_${index}`,
      kind: 'execute',
      body: { imei, action_code: 'pause_session', scope: 'workflow', dispatch_mode: 'sync' },
    },
    {
      label: `mixed_resume_${index}`,
      kind: 'execute',
      body: { imei, action_code: 'resume_session', scope: 'workflow', dispatch_mode: 'sync' },
    },
  ];
  return options[index % options.length];
}

function buildIssueSummary(results: Array<Record<string, any>>) {
  const byStatus: Record<string, number> = {};
  const byReason: Record<string, number> = {};

  for (const result of results) {
    const status = String(result.final_status ?? 'unknown');
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const reason =
      result.final_transport?.nack_reason ??
      result.final_transport?.gateway_reason_code ??
      result.final_transport?.dead_letter_reason ??
      'none';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }

  return { by_status: byStatus, by_reason: byReason };
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  await client.connect();

  try {
    const report: Record<string, unknown> = {
      started_at: new Date().toISOString(),
      api_base: apiBase,
      imei,
      target_ref: targetRef,
      module_code: moduleCode,
      source,
      initial_device_state: await loadDeviceState(client),
    };

    const scenarioResults: Array<Record<string, unknown>> = [];
    for (const scenario of baseScenarios()) {
      scenarioResults.push(await runSingle(pool, scenario, 'scenario'));
      await sleep(settleDelayMs);
    }

    const queryStormCases: ProbeCase[] = [];
    for (let round = 0; round < queryStormRounds; round += 1) {
      queryStormCases.push(
        {
          label: `storm_qcs_${round}`,
          kind: 'query',
          body: { imei, query_code: 'QUERY_COMMON_STATUS', dispatch_mode: 'sync' },
        },
        {
          label: `storm_qwf_${round}`,
          kind: 'query',
          body: { imei, query_code: 'QUERY_WORKFLOW_STATE', dispatch_mode: 'sync' },
        },
        {
          label: `storm_qem_${round}`,
          kind: 'query',
          body: { imei, query_code: 'QUERY_ELECTRIC_METER', dispatch_mode: 'sync' },
        },
      );
    }

    const queryStormResults: Array<Record<string, unknown>> = [];
    for (const group of chunk(queryStormCases, queryStormConcurrency)) {
      const rows = await Promise.all(
        group.map((probe, index) => runSingle(pool, probe, `query_storm_${queryStormResults.length + index}`)),
      );
      queryStormResults.push(...rows);
      await sleep(settleDelayMs);
    }

    const mixedStormCases: ProbeCase[] = [];
    for (let round = 0; round < mixedStormRounds * mixedStormConcurrency; round += 1) {
      mixedStormCases.push(randomMixedProbe(round));
    }

    const mixedStormResults: Array<Record<string, unknown>> = [];
    for (const group of chunk(mixedStormCases, mixedStormConcurrency)) {
      const rows = await Promise.all(
        group.map((probe, index) => runSingle(pool, probe, `mixed_storm_${mixedStormResults.length + index}`)),
      );
      mixedStormResults.push(...rows);
      await sleep(settleDelayMs);
    }

    await sleep(settleDelayMs * 2);

    const allResults = [...scenarioResults, ...queryStormResults, ...mixedStormResults];
    for (const result of allResults) {
      const commandId = String(result.command_id ?? '');
      if (!commandId || result.final_status !== 'sent') continue;
      const refreshed = await loadCommandById(client, commandId);
      result.final_status = refreshed?.command_status ?? result.final_status;
      result.final_transport = summarizeTransport(refreshed?.response_payload_json);
    }

    report.scenario_results = scenarioResults;
    report.query_storm_results = queryStormResults;
    report.mixed_storm_results = mixedStormResults;
    report.summary = buildIssueSummary(allResults);
    report.final_device_state = await loadDeviceState(client);
    report.finished_at = new Date().toISOString();

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
    await pool.end();
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
