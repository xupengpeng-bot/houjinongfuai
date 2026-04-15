import { Client } from 'pg';

type QueryProbe = {
  kind: 'query';
  label: string;
  body: Record<string, unknown>;
};

type ActionProbe = {
  kind: 'execute';
  label: string;
  body: Record<string, unknown>;
};

type ProbeCase = QueryProbe | ActionProbe;

type CommandRow = {
  id: string;
  command_code: string;
  command_status: string;
  created_at: string;
  sent_at: string | null;
  acked_at: string | null;
  failed_at: string | null;
  timeout_at: string | null;
  request_payload_json: Record<string, unknown> | null;
  response_payload_json: Record<string, unknown> | null;
};

type MessageRow = {
  direction: string;
  msg_type: string;
  event_type: string;
  server_rx_ts: string;
  payload_json: Record<string, unknown> | null;
};

const apiBase = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/houji_p1';
const imei = process.env.PROBE_IMEI || '861295087573980';
const targetRef = process.env.PROBE_TARGET_REF || 'pump_1';
const moduleCode = process.env.PROBE_MODULE_CODE || 'pump_direct_control';
const source = process.env.PROBE_SOURCE || 'codex_real_brutal_probe';
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 30000);
const pollIntervalMs = Number(process.env.PROBE_POLL_INTERVAL_MS || 1500);
const settleDelayMs = Number(process.env.PROBE_SETTLE_DELAY_MS || 5000);

const probes: ProbeCase[] = [
  {
    kind: 'query',
    label: 'query_common_status',
    body: {
      imei,
      query_code: 'QUERY_COMMON_STATUS',
      source,
      dispatch_mode: 'sync',
    },
  },
  {
    kind: 'query',
    label: 'query_workflow_state',
    body: {
      imei,
      query_code: 'QUERY_WORKFLOW_STATE',
      source,
      dispatch_mode: 'sync',
    },
  },
  {
    kind: 'query',
    label: 'query_electric_meter',
    body: {
      imei,
      query_code: 'QUERY_ELECTRIC_METER',
      source,
      dispatch_mode: 'sync',
    },
  },
  {
    kind: 'execute',
    label: 'pause_session',
    body: {
      imei,
      action_code: 'pause_session',
      scope: 'workflow',
      target_ref: null,
      module_code: null,
      source,
      dispatch_mode: 'sync',
    },
  },
  {
    kind: 'execute',
    label: 'resume_session',
    body: {
      imei,
      action_code: 'resume_session',
      scope: 'workflow',
      target_ref: null,
      module_code: null,
      source,
      dispatch_mode: 'sync',
    },
  },
  {
    kind: 'execute',
    label: 'stop_pump',
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
    kind: 'execute',
    label: 'start_pump',
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
  {
    kind: 'execute',
    label: 'stop_pump_after_start',
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
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return null;
  const text = JSON.stringify(payload);
  if (text.length <= 1200) return payload;
  return {
    preview: `${text.slice(0, 1200)}...`,
  };
}

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return {
    status: response.status,
    ok: response.ok,
    body: json,
  };
}

async function waitForCommand(client: Client, commandId: string) {
  const deadline = Date.now() + timeoutMs;
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
        request_payload_json,
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

    await sleep(pollIntervalMs);
  }

  return lastRow;
}

async function loadRecentMessages(client: Client, commandId: string) {
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
    order by server_rx_ts desc
    limit 6
    `,
    [commandId],
  );
  return result.rows.map((row) => ({
    direction: row.direction,
    msg_type: row.msg_type,
    event_type: row.event_type,
    server_rx_ts: row.server_rx_ts,
    payload_json: trimPayload(row.payload_json),
  }));
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

  const latestMessages = await client.query(
    `
    select
      direction,
      msg_type,
      event_type,
      server_rx_ts::text
    from device_message_log_v2
    where imei = $1
    order by server_rx_ts desc
    limit 8
    `,
    [imei],
  );

  return {
    device: device.rows[0] ?? null,
    latest_messages: latestMessages.rows,
  };
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const report: Record<string, unknown> = {
      probe_started_at: new Date().toISOString(),
      api_base: apiBase,
      imei,
      target_ref: targetRef,
      module_code: moduleCode,
      source,
      initial_state: await loadDeviceState(client),
      cases: [],
    };

    for (const probe of probes) {
      const path = probe.kind === 'query' ? '/ops/device-gateway/query' : '/ops/device-gateway/execute';
      const issuedAt = new Date().toISOString();
      const response = await postJson(path, probe.body);
      const commandId = response.body?.data?.command?.id || null;
      const delivery = response.body?.data?.delivery || null;

      let finalCommand: CommandRow | null = null;
      let messages: Array<Record<string, unknown>> = [];
      if (commandId) {
        finalCommand = await waitForCommand(client, commandId);
        messages = await loadRecentMessages(client, commandId);
      }

      (report.cases as Array<Record<string, unknown>>).push({
        label: probe.label,
        kind: probe.kind,
        issued_at: issuedAt,
        request_body: probe.body,
        http_status: response.status,
        api_ok: response.ok,
        immediate_delivery: delivery,
        command_id: commandId,
        final_command: finalCommand
          ? {
              id: finalCommand.id,
              command_code: finalCommand.command_code,
              command_status: finalCommand.command_status,
              created_at: finalCommand.created_at,
              sent_at: finalCommand.sent_at,
              acked_at: finalCommand.acked_at,
              failed_at: finalCommand.failed_at,
              timeout_at: finalCommand.timeout_at,
              response_payload_json: trimPayload(finalCommand.response_payload_json),
            }
          : null,
        recent_messages: messages,
      });

      await sleep(settleDelayMs);
    }

    report.final_state = await loadDeviceState(client);
    report.probe_finished_at = new Date().toISOString();

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
