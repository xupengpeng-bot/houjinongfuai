import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';

interface CleanupStep {
  label: string;
  sql: string;
}

interface CleanupResult {
  label: string;
  deleted: number;
}

const BACKEND_ROOT = resolve(__dirname, '..');

function readDatabaseUrlFromEnv(envFile: string) {
  if (!existsSync(envFile)) {
    return undefined;
  }

  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [key, ...rest] = trimmed.split('=');
    if (key === 'DATABASE_URL') {
      return rest.join('=').trim();
    }
  }

  return undefined;
}

async function countTable(pool: Pool, tableName: string) {
  const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${tableName}`);
  return Number(result.rows[0]?.count ?? '0');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? readDatabaseUrlFromEnv(resolve(BACKEND_ROOT, '.env'));
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for test data cleanup');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const steps: CleanupStep[] = [
    { label: 'order_settlement_slice', sql: 'delete from order_settlement_slice' },
    { label: 'order_funding_ledger', sql: 'delete from order_funding_ledger' },
    { label: 'device_command', sql: 'delete from device_command' },
    { label: 'conversation_context_snapshot', sql: 'delete from conversation_context_snapshot' },
    { label: 'ai_handoff', sql: 'delete from ai_handoff' },
    { label: 'work_order_action_log', sql: 'delete from work_order_action_log' },
    { label: 'work_order', sql: 'delete from work_order' },
    { label: 'alarm_event', sql: 'delete from alarm_event' },
    { label: 'uat_execution', sql: 'delete from uat_execution' },
    { label: 'uat_case', sql: 'delete from uat_case' },
    { label: 'command_dispatch', sql: 'delete from command_dispatch' },
    { label: 'session_status_log', sql: 'delete from session_status_log' },
    { label: 'irrigation_order', sql: 'delete from irrigation_order' },
    { label: 'network_pipe', sql: 'delete from network_pipe' },
    { label: 'network_node', sql: 'delete from network_node' },
    { label: 'network_model_version', sql: 'delete from network_model_version' },
    { label: 'network_model', sql: 'delete from network_model' },
    { label: 'data_scope_policy', sql: 'delete from data_scope_policy' },
    { label: 'metering_point', sql: 'delete from metering_point' },
    { label: 'project_block', sql: 'delete from project_block' },
    { label: 'runtime_session', sql: 'delete from runtime_session' },
    { label: 'runtime_decision', sql: 'delete from runtime_decision' },
    { label: 'runtime_container', sql: 'delete from runtime_container' },
    { label: 'device_connection_session', sql: 'delete from device_connection_session' },
    { label: 'device_message_log', sql: 'delete from device_message_log' },
    { label: 'asset', sql: 'delete from asset' },
    { label: 'project', sql: 'delete from project' },
    { label: 'maintenance_team', sql: 'delete from maintenance_team' },
    { label: 'pump_valve_relation', sql: 'delete from pump_valve_relation' },
    { label: 'topology_relation', sql: 'delete from topology_relation' },
    { label: 'well_runtime_policy', sql: 'delete from well_runtime_policy' },
    { label: 'billing_package', sql: 'delete from billing_package' },
    { label: 'valve', sql: 'delete from valve' },
    { label: 'pump', sql: 'delete from pump' },
    { label: 'well', sql: 'delete from well' },
    { label: 'device', sql: 'delete from device' },
    { label: 'device_type', sql: 'delete from device_type' },
    {
      label: 'sys_data_scope_region',
      sql: `
        delete from sys_data_scope
        where scope_type = 'region'
      `
    },
    { label: 'region', sql: 'delete from region' },
    {
      label: 'audit_log_runtime_uat',
      sql: `
        delete from audit_log
        where module_code in ('runtime', 'alarm', 'work_order', 'project', 'asset', 'region')
           or resource_type in ('runtime_session', 'alarm_event', 'work_order', 'project', 'asset', 'region')
      `
    },
    {
      label: 'operation_log_runtime_uat',
      sql: `
        delete from operation_log
        where module_code in ('runtime', 'alarm', 'project', 'asset', 'region')
      `
    }
  ];

  const finalCountTables = [
    'device_type',
    'device',
    'pump_valve_relation',
    'topology_relation',
    'runtime_session',
    'irrigation_order',
    'region',
    'project',
    'asset',
    'maintenance_team',
    'alarm_event',
    'work_order',
    'uat_case',
    'uat_execution'
  ];

  const client = await pool.connect();
  try {
    const regionReferenceBefore = await countTable(pool, 'region_reference');
    await client.query('begin');

    const results: CleanupResult[] = [];
    for (const step of steps) {
      const result = await client.query(step.sql);
      results.push({
        label: step.label,
        deleted: result.rowCount ?? 0
      });
    }

    await client.query('commit');

    const regionReferenceAfter = await countTable(pool, 'region_reference');
    if (regionReferenceAfter !== regionReferenceBefore) {
      throw new Error(
        `region_reference guard violated during cleanup: before=${regionReferenceBefore}, after=${regionReferenceAfter}`
      );
    }

    const finalCounts: Record<string, number> = {};
    for (const tableName of finalCountTables) {
      finalCounts[tableName] = await countTable(pool, tableName);
    }

    console.log(
      JSON.stringify(
        {
          deleted: results,
          final_counts: finalCounts
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
