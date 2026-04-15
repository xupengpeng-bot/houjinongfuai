export type RealDeviceCasePriority = 'P0' | 'P1' | 'P2';
export type RealDeviceCaseCategory =
  | 'connectivity'
  | 'query'
  | 'command'
  | 'pause_resume'
  | 'valve'
  | 'metering'
  | 'card_swipe'
  | 'abnormal'
  | 'stress';
export type RealDeviceAutomationReadiness = 'ready' | 'needs_operator' | 'needs_firmware_hook';
export type RealDeviceStepKind = 'query' | 'execute' | 'observe' | 'operator';
export type RealDeviceRepeatMode = 'single' | 'repeat' | 'burst' | 'chaos' | 'soak';

export type RealDeviceStep = {
  kind: RealDeviceStepKind;
  code: string;
  note?: string;
  apiPath?: '/ops/device-gateway/query' | '/ops/device-gateway/execute';
  bodyTemplate?: Record<string, unknown>;
};

export type RealDeviceRepeatPlan = {
  mode: RealDeviceRepeatMode;
  iterations: number;
  concurrency: number;
  minPassRate: number;
  stopOnFirstFailure: boolean;
};

export type RealDeviceOracle = {
  scope: 'device' | 'message' | 'command' | 'session' | 'order' | 'wallet';
  expectation: string;
};

export type EmbeddedRealDeviceCase = {
  id: string;
  title: string;
  priority: RealDeviceCasePriority;
  category: RealDeviceCaseCategory;
  readiness: RealDeviceAutomationReadiness;
  intent: 'happy_path' | 'negative' | 'timeout' | 'recovery' | 'stress' | 'protocol';
  preconditions: string[];
  steps: RealDeviceStep[];
  expectedFirmware: string[];
  expectedPlatform: string[];
  cleanup: string[];
  tags: string[];
  unstableFactors?: string[];
  repeat?: RealDeviceRepeatPlan;
  oracles?: RealDeviceOracle[];
  improvementTargets?: string[];
};

const syncQuery = (queryCode: 'QUERY_COMMON_STATUS' | 'QUERY_WORKFLOW_STATE' | 'QUERY_ELECTRIC_METER'): RealDeviceStep => ({
  kind: 'query',
  code: queryCode,
  apiPath: '/ops/device-gateway/query',
  bodyTemplate: {
    imei: '{{imei}}',
    query_code: queryCode,
    source: '{{source}}',
    dispatch_mode: 'sync',
  },
});

const syncAction = (
  actionCode: 'start_pump' | 'stop_pump' | 'pause_session' | 'resume_session' | 'open_valve' | 'close_valve',
  scope: 'module' | 'workflow',
): RealDeviceStep => ({
  kind: 'execute',
  code: actionCode,
  apiPath: '/ops/device-gateway/execute',
  bodyTemplate:
    scope === 'module'
      ? {
          imei: '{{imei}}',
          action_code: actionCode,
          scope,
          target_ref: '{{targetRef}}',
          module_code: '{{moduleCode}}',
          source: '{{source}}',
          dispatch_mode: 'sync',
        }
      : {
          imei: '{{imei}}',
          action_code: actionCode,
          scope,
          source: '{{source}}',
          dispatch_mode: 'sync',
        },
});

export const embeddedRealDeviceCaseCatalog: EmbeddedRealDeviceCase[] = [];

const buildDefaultRepeat = (item: EmbeddedRealDeviceCase): RealDeviceRepeatPlan => {
  if (item.intent === 'stress') {
    return {
      mode: 'chaos',
      iterations: item.priority === 'P0' ? 20 : 10,
      concurrency: item.readiness === 'ready' ? 6 : 3,
      minPassRate: item.priority === 'P0' ? 0.98 : 0.95,
      stopOnFirstFailure: false,
    };
  }

  if (item.intent === 'timeout' || item.intent === 'recovery' || item.intent === 'protocol') {
    return {
      mode: 'repeat',
      iterations: item.priority === 'P0' ? 8 : 5,
      concurrency: 1,
      minPassRate: item.priority === 'P0' ? 1 : 0.95,
      stopOnFirstFailure: false,
    };
  }

  return {
    mode: 'repeat',
    iterations: item.priority === 'P0' ? 5 : 3,
    concurrency: 1,
    minPassRate: item.priority === 'P0' ? 1 : 0.95,
    stopOnFirstFailure: false,
  };
};

const buildDefaultOracles = (item: EmbeddedRealDeviceCase): RealDeviceOracle[] => {
  const oracles: RealDeviceOracle[] = [
    { scope: 'command', expectation: 'command must close as acked or failed or dead_letter and must not stay sent forever' },
    { scope: 'message', expectation: 'AK or NK or QS must remain correlated to the originating command token' },
  ];

  if (item.category === 'connectivity') {
    oracles.push({ scope: 'device', expectation: 'device online_state and connection_state must match the real connectivity fact' });
  }

  if (['command', 'pause_resume', 'abnormal', 'stress'].includes(item.category)) {
    oracles.push({ scope: 'session', expectation: 'runtime_session must land in the expected lifecycle state and not remain stuck in pending transition' });
  }

  if (['command', 'pause_resume', 'metering', 'abnormal', 'stress'].includes(item.category)) {
    oracles.push({ scope: 'order', expectation: 'irrigation_order must reflect the formal billing lifecycle and amount freeze rules' });
  }

  if (item.category === 'metering') {
    oracles.push({ scope: 'order', expectation: 'usage and amount must be derived from cumulative delta against the captured baseline or meter epoch' });
  }

  if (item.category === 'card_swipe') {
    oracles.push({ scope: 'message', expectation: 'each real swipe must appear as an independent fact event and must not be swallowed by platform debounce' });
  }

  return oracles;
};

const buildDefaultImprovementTargets = (item: EmbeddedRealDeviceCase) => {
  const targets = ['fix protocol correlation gaps', 'fix state machine consistency', 'prevent silent timeout paths'];
  if (item.category === 'metering') targets.push('fix cumulative counter semantics and meter epoch reporting');
  if (item.category === 'card_swipe') targets.push('fix swipe journal durability and second-swipe intent handling');
  if (item.category === 'stress') targets.push('fix burst stability and queue drain behavior');
  return targets;
};

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'CONN-001',
    title: 'heartbeat should keep device online and connected',
    priority: 'P0',
    category: 'connectivity',
    readiness: 'ready',
    intent: 'happy_path',
    preconditions: ['device is powered on', 'device can reach the platform', 'heartbeat is enabled'],
    steps: [
      { kind: 'observe', code: 'HB', note: 'watch real heartbeat packets for at least 3 cycles' },
      syncQuery('QUERY_COMMON_STATUS'),
    ],
    expectedFirmware: ['device keeps reporting HB', 'HB payload keeps stable IMEI and increasing sequence'],
    expectedPlatform: ['device.online_state becomes online', 'device.connection_state becomes connected', 'query can be delivered immediately'],
    cleanup: [],
    tags: ['hb', 'online', 'connected'],
  },
  {
    id: 'CONN-002',
    title: 'heartbeat timeout should mark device offline',
    priority: 'P0',
    category: 'connectivity',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device starts online', 'operator can disable network or power without triggering irrigation'],
    steps: [
      { kind: 'operator', code: 'CUT_NETWORK', note: 'disconnect network long enough to exceed heartbeat timeout' },
      { kind: 'observe', code: 'CONNECTION_SWEEP', note: 'wait for connection sweep to run' },
    ],
    expectedFirmware: ['device stops sending heartbeat during outage'],
    expectedPlatform: ['device.online_state becomes offline', 'device.connection_state becomes disconnected', 'offline alarm or work order can be created'],
    cleanup: ['restore connectivity after observation'],
    tags: ['timeout', 'offline', 'heartbeat'],
  },
  {
    id: 'CONN-003',
    title: 'reconnect should requeue retry_pending non-sync commands only',
    priority: 'P0',
    category: 'connectivity',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device has at least one retry_pending query or non-sync command', 'operator can force a reconnect'],
    steps: [
      { kind: 'observe', code: 'RETRY_PENDING_QUEUE', note: 'confirm command exists before reconnect' },
      { kind: 'operator', code: 'RECONNECT_DEVICE', note: 'trigger a real reconnect' },
      { kind: 'observe', code: 'CONNECTION_RECOVERED', note: 'watch command status transitions' },
    ],
    expectedFirmware: ['device reconnects without replaying old start command locally'],
    expectedPlatform: ['retry_pending query or non-sync command becomes created then sent', 'sync start or pause or resume is not replayed'],
    cleanup: [],
    tags: ['reconnect', 'retry_pending'],
  },
  {
    id: 'CONN-004',
    title: 'reconnect must close synchronous start instead of replaying it',
    priority: 'P0',
    category: 'connectivity',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['a synchronous start command is pending', 'device can disconnect and reconnect before ACK'],
    steps: [
      syncAction('start_pump', 'module'),
      { kind: 'operator', code: 'RECONNECT_BEFORE_ACK', note: 'disconnect or reconnect device before it returns ACK' },
      { kind: 'observe', code: 'COMMAND_STATUS', note: 'watch pending start closure' },
    ],
    expectedFirmware: ['device does not auto-start after reconnect because of old command replay'],
    expectedPlatform: ['start command becomes dead_letter', 'runtime session moves from pending_start to ended', 'order is cancelled or refunded'],
    cleanup: [],
    tags: ['sync_start', 'reconnect', 'no_replay'],
  },
  {
    id: 'CONN-005',
    title: 'every AK or NK or QS must carry command correlation',
    priority: 'P0',
    category: 'connectivity',
    readiness: 'ready',
    intent: 'protocol',
    preconditions: ['device receives a platform command'],
    steps: [
      syncQuery('QUERY_WORKFLOW_STATE'),
      syncAction('stop_pump', 'module'),
    ],
    expectedFirmware: ['every reply includes the original command token in the compact contract field'],
    expectedPlatform: ['device_command never stays sent forever because of missing correlation', 'message log can be joined back to command row'],
    cleanup: [],
    tags: ['correlation', 'ack', 'nack', 'query_result'],
  },
  {
    id: 'CONN-006',
    title: 'duplicate message id should be idempotent',
    priority: 'P1',
    category: 'connectivity',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can resend the exact same msg_id payload'],
    steps: [{ kind: 'operator', code: 'RESEND_SAME_MSG_ID', note: 'send the same HB or ER packet twice' }],
    expectedFirmware: ['duplicate packet body is byte-identical'],
    expectedPlatform: ['second packet is accepted as duplicate', 'no second status transition or second settlement occurs'],
    cleanup: [],
    tags: ['idempotency', 'duplicate_msg_id'],
  },
);

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'STRESS-006',
    title: 'rapid start-stop loop should not create residual sessions or orders',
    priority: 'P0',
    category: 'stress',
    readiness: 'needs_operator',
    intent: 'stress',
    preconditions: ['device can safely execute repeated start and stop on test rig'],
    steps: [{ kind: 'observe', code: 'RUN_START_STOP_LOOP_X20', note: 'repeat start then stop for 20 rounds' }],
    expectedFirmware: ['each round returns explicit success or failure', 'device does not drift into illegal hidden state after repeated loops'],
    expectedPlatform: ['no residual running session or pending_start order remains after the loop', 'wallet and order counts stay consistent round by round'],
    cleanup: [],
    tags: ['loop', 'start_stop', 'residue'],
  },
  {
    id: 'STRESS-007',
    title: 'rapid pause-resume loop should not leak runtime or state',
    priority: 'P0',
    category: 'stress',
    readiness: 'needs_operator',
    intent: 'stress',
    preconditions: ['device is safely running and can be paused and resumed repeatedly'],
    steps: [{ kind: 'observe', code: 'RUN_PAUSE_RESUME_LOOP_X20', note: 'repeat pause then resume for 20 rounds' }],
    expectedFirmware: ['paused runtime stays frozen on every paused segment', 'device returns to running cleanly on every resume'],
    expectedPlatform: ['session never gets stuck in pausing or resuming', 'pause summary and amount freeze remain correct over many loops'],
    cleanup: ['stop session after verification'],
    tags: ['loop', 'pause_resume', 'runtime_freeze'],
  },
  {
    id: 'STRESS-008',
    title: 'query and control cross-fire should stay correlated',
    priority: 'P0',
    category: 'stress',
    readiness: 'ready',
    intent: 'stress',
    preconditions: ['device is online'],
    steps: [{ kind: 'observe', code: 'RUN_QUERY_CONTROL_CROSSFIRE', note: 'mix qcs or qwf or qem with pause or resume or stop bursts' }],
    expectedFirmware: ['query replies and control replies remain correlated even when interleaved'],
    expectedPlatform: ['no command closes on another command reply', 'message log ordering noise does not break lifecycle decisions'],
    cleanup: [],
    tags: ['crossfire', 'interleave', 'correlation'],
  },
  {
    id: 'STRESS-009',
    title: 'network flap chaos should not replay stale sync control',
    priority: 'P0',
    category: 'stress',
    readiness: 'needs_operator',
    intent: 'stress',
    preconditions: ['operator can flap network repeatedly while commands are in flight'],
    steps: [{ kind: 'operator', code: 'FLAP_NETWORK_X10', note: 'repeat short disconnect and reconnect cycles while issuing commands' }],
    expectedFirmware: ['device never auto-executes stale start or stale pause or stale resume after flaps'],
    expectedPlatform: ['sync control commands are closed safely instead of replayed later', 'queue eventually drains after chaos ends'],
    cleanup: [],
    tags: ['network_flap', 'chaos', 'stale_control'],
  },
  {
    id: 'STRESS-010',
    title: 'late success after timeout should be ignored as stale command success',
    priority: 'P0',
    category: 'stress',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can intentionally delay AK beyond platform timeout for a targeted command'],
    steps: [{ kind: 'operator', code: 'DELAY_ACK_PAST_TIMEOUT', note: 'emit a success reply after the platform has already timed the command out' }],
    expectedFirmware: ['late reply remains correlated to the original command token'],
    expectedPlatform: ['timed-out command is not revived into success incorrectly', 'old order or session is not reopened by stale late success'],
    cleanup: [],
    tags: ['late_ack', 'stale_success', 'timeout'],
  },
  {
    id: 'STRESS-011',
    title: 'out-of-order replies should not break state machine',
    priority: 'P1',
    category: 'stress',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can emit out-of-order replies in test mode'],
    steps: [{ kind: 'operator', code: 'SEND_OUT_OF_ORDER_RESPONSES', note: 'send later command reply before earlier command reply' }],
    expectedFirmware: ['test mode can reproduce the disorder deterministically'],
    expectedPlatform: ['state machine follows command correlation and factual runtime, not raw arrival order alone'],
    cleanup: [],
    tags: ['out_of_order', 'protocol'],
  },
  {
    id: 'STRESS-012',
    title: 'long soak run should keep queue and lifecycle clean',
    priority: 'P1',
    category: 'stress',
    readiness: 'needs_operator',
    intent: 'stress',
    preconditions: ['test device can be reserved for a longer soak window'],
    steps: [{ kind: 'observe', code: 'RUN_SOAK_2H', note: 'repeat query, start, stop, pause, resume patterns over a 2 hour window' }],
    expectedFirmware: ['device does not degrade into growing busy or silent-failure behavior over time'],
    expectedPlatform: ['queue health, session lifecycle and order lifecycle remain stable over long duration'],
    cleanup: [],
    tags: ['soak', 'long_run'],
  },
);

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'ABN-001',
    title: 'fault stop should be reported as abnormal stop',
    priority: 'P0',
    category: 'abnormal',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['firmware can enter a safe test fault state'],
    steps: [{ kind: 'operator', code: 'TRIGGER_FAULT_STOP', note: 'trigger safe fault stop on test rig' }],
    expectedFirmware: ['device reports abnormal stop fact with final rt or fq or ek'],
    expectedPlatform: ['session ends immediately', 'order settles with abnormal_stop=true and reason code'],
    cleanup: [],
    tags: ['fault', 'abnormal_stop'],
  },
  {
    id: 'ABN-002',
    title: 'power loss stop should be reported after recovery',
    priority: 'P0',
    category: 'abnormal',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device is running in safe test mode', 'operator can cut power'],
    steps: [{ kind: 'operator', code: 'CUT_POWER', note: 'cut power during running then restore it' }],
    expectedFirmware: ['after recovery, device reports historical stop fact instead of replaying old start'],
    expectedPlatform: ['session is ended from factual stop event', 'late recovery does not reopen the old order'],
    cleanup: [],
    tags: ['power_loss', 'recovery'],
  },
  {
    id: 'ABN-003',
    title: 'emergency stop should terminate session immediately',
    priority: 'P0',
    category: 'abnormal',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['test bench has emergency stop that is safe to trigger'],
    steps: [{ kind: 'operator', code: 'TRIGGER_ESTOP', note: 'trigger emergency stop during running' }],
    expectedFirmware: ['device reports stop fact with emergency reason immediately'],
    expectedPlatform: ['session ends without waiting for normal stop ACK flow', 'order settles as abnormal stop'],
    cleanup: [],
    tags: ['emergency_stop', 'abnormal_stop'],
  },
  {
    id: 'ABN-004',
    title: 'malformed NK without correlation should be treated as protocol defect',
    priority: 'P0',
    category: 'abnormal',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can emit a malformed NK in test mode'],
    steps: [{ kind: 'operator', code: 'SEND_MALFORMED_NK', note: 'emit NK without command token or equivalent correlation field' }],
    expectedFirmware: ['test mode demonstrates the malformed packet explicitly'],
    expectedPlatform: ['platform flags protocol defect and command does not remain sent forever after timeout closure logic'],
    cleanup: [],
    tags: ['malformed_nk', 'protocol_defect'],
  },
  {
    id: 'ABN-005',
    title: 'invalid payload should never leave command hanging forever',
    priority: 'P0',
    category: 'abnormal',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can emit intentionally broken response payload in test mode'],
    steps: [{ kind: 'operator', code: 'SEND_INVALID_PAYLOAD', note: 'reply with broken compact body or invalid payload' }],
    expectedFirmware: ['test packet is intentionally malformed'],
    expectedPlatform: ['command reaches failed or dead_letter after timeout or cleanup', 'maintenance sweep can close the residue automatically'],
    cleanup: [],
    tags: ['invalid_payload', 'cleanup'],
  },
  {
    id: 'STRESS-001',
    title: 'query storm should not explode sent backlog',
    priority: 'P0',
    category: 'stress',
    readiness: 'ready',
    intent: 'stress',
    preconditions: ['device is online', 'test environment allows burst traffic'],
    steps: [{ kind: 'observe', code: 'RUN_QUERY_STORM', note: 'use real-device stress suite query storm mode' }],
    expectedFirmware: ['device returns bounded QS or NK responses under load'],
    expectedPlatform: ['sent backlog remains bounded and eventually drains', 'command correlation remains correct'],
    cleanup: [],
    tags: ['stress', 'query_storm'],
  },
  {
    id: 'STRESS-002',
    title: 'mixed command storm should expose illegal state handling clearly',
    priority: 'P0',
    category: 'stress',
    readiness: 'ready',
    intent: 'stress',
    preconditions: ['device is online', 'commands can be issued rapidly without field risk'],
    steps: [{ kind: 'observe', code: 'RUN_MIXED_STORM', note: 'mix qcs or qwf or qem or start or stop or pause or resume bursts' }],
    expectedFirmware: ['illegal state commands return explicit NK instead of silence'],
    expectedPlatform: ['queue health shows explicit failed or dead_letter outcomes instead of a large indefinite sent set'],
    cleanup: [],
    tags: ['stress', 'mixed_commands'],
  },
  {
    id: 'STRESS-003',
    title: 'disconnect during sent command should be auto-closed by sweeper',
    priority: 'P0',
    category: 'stress',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device is online', 'operator can force disconnect after command dispatch'],
    steps: [syncAction('start_pump', 'module'), { kind: 'operator', code: 'DISCONNECT_AFTER_SENT', note: 'drop connection right after dispatch' }],
    expectedFirmware: ['device stays silent during disconnect'],
    expectedPlatform: ['timed-out sent command moves to dead_letter or review', 'pending_start or stop session is auto-closed according to rule'],
    cleanup: [],
    tags: ['disconnect', 'sent_timeout'],
  },
  {
    id: 'STRESS-004',
    title: 'disconnect with created or retry_pending control commands should be auto-recovered',
    priority: 'P0',
    category: 'stress',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device has created or retry_pending control commands queued', 'operator can keep device offline briefly'],
    steps: [{ kind: 'operator', code: 'KEEP_DEVICE_OFFLINE', note: 'leave device offline long enough for connection sweep' }],
    expectedFirmware: ['device does not execute stale sync control after reconnect'],
    expectedPlatform: ['connection sweep closes sync start or pause or resume or stop controls instead of leaving them hanging'],
    cleanup: [],
    tags: ['created_queue', 'retry_pending', 'disconnect_sweep'],
  },
  {
    id: 'STRESS-005',
    title: 'duplicate AK or duplicate stop fact should be idempotent',
    priority: 'P1',
    category: 'stress',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can resend the same AK or stop fact twice'],
    steps: [{ kind: 'operator', code: 'RESEND_DUPLICATE_ACK', note: 'repeat the same success response twice' }],
    expectedFirmware: ['duplicate success packet keeps same correlation and payload identity'],
    expectedPlatform: ['no duplicate settlement, no duplicate session transition, no duplicate wallet mutation'],
    cleanup: [],
    tags: ['duplicate_ack', 'idempotency'],
  },
);

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'METER-001',
    title: 'start success must capture billing baseline',
    priority: 'P0',
    category: 'metering',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device can start successfully', 'rt or fq or ek are available'],
    steps: [syncAction('start_pump', 'module'), { kind: 'observe', code: 'BASELINE_CAPTURE', note: 'inspect first successful running fact' }],
    expectedFirmware: ['first running fact includes cumulative rt or fq or ek'],
    expectedPlatform: ['pricing baseline stores start-time cumulative snapshot instead of raw absolute billing'],
    cleanup: ['stop session after verification'],
    tags: ['baseline', 'billing'],
  },
  {
    id: 'METER-002',
    title: 'billing should use cumulative delta from baseline',
    priority: 'P0',
    category: 'metering',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device is running long enough to accumulate runtime or water or energy'],
    steps: [{ kind: 'observe', code: 'RUNTIME_PROGRESS', note: 'sample platform progress twice during active running' }],
    expectedFirmware: ['same meter epoch keeps cumulative counters monotonic'],
    expectedPlatform: ['order amount uses current cumulative minus start baseline', 'historic total counter is never billed as current order usage'],
    cleanup: [],
    tags: ['delta', 'usage', 'billing'],
  },
  {
    id: 'METER-003',
    title: 'paused runtime must not keep growing',
    priority: 'P0',
    category: 'metering',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device can be paused safely'],
    steps: [syncAction('pause_session', 'workflow'), { kind: 'observe', code: 'PAUSE_WINDOW_60S', note: 'observe rt or fq or ek for at least 60 seconds while paused' }],
    expectedFirmware: ['rt stays flat during pause', 'no hidden running time is accumulated while paused'],
    expectedPlatform: ['order amount and usage stay frozen during pause window'],
    cleanup: ['resume or stop the session after verification'],
    tags: ['paused_runtime', 'freeze'],
  },
  {
    id: 'METER-004',
    title: 'stop event should carry final usage snapshot',
    priority: 'P0',
    category: 'metering',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device is running and can stop cleanly'],
    steps: [syncAction('stop_pump', 'module'), { kind: 'observe', code: 'FINAL_STOP_METERS', note: 'inspect stop event payload' }],
    expectedFirmware: ['stop event includes final rt or fq or ek and stop reason'],
    expectedPlatform: ['settlement can complete from stop fact without waiting for shadow data catch-up'],
    cleanup: [],
    tags: ['final_snapshot', 'stop_fact'],
  },
  {
    id: 'METER-005',
    title: 'counter reset event should be reported immediately',
    priority: 'P0',
    category: 'metering',
    readiness: 'needs_firmware_hook',
    intent: 'protocol',
    preconditions: ['firmware can simulate counter reset or expose a reset event in test mode'],
    steps: [{ kind: 'operator', code: 'TRIGGER_COUNTER_RESET', note: 'force counter reset in test mode' }],
    expectedFirmware: ['counter_reset fact is reported exactly once with new meter epoch'],
    expectedPlatform: ['platform marks meter continuity broken and stops direct delta subtraction across epochs'],
    cleanup: [],
    tags: ['counter_reset', 'meter_epoch'],
  },
  {
    id: 'METER-006',
    title: 'meter epoch change after reboot must be visible',
    priority: 'P0',
    category: 'metering',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device can be safely rebooted in test mode'],
    steps: [{ kind: 'operator', code: 'REBOOT_DEVICE', note: 'reboot the controller' }, { kind: 'observe', code: 'POST_REBOOT_STATUS', note: 'inspect first status or event after reboot' }],
    expectedFirmware: ['meter epoch changes after reboot when counters are not guaranteed continuous'],
    expectedPlatform: ['post-reboot readings are not blindly subtracted from pre-reboot baseline'],
    cleanup: [],
    tags: ['reboot', 'meter_epoch'],
  },
  {
    id: 'METER-007',
    title: 'same epoch counters must remain monotonic',
    priority: 'P1',
    category: 'metering',
    readiness: 'ready',
    intent: 'protocol',
    preconditions: ['device is online and reporting rt or fq or ek periodically'],
    steps: [{ kind: 'observe', code: 'STATUS_SERIES_X10', note: 'collect at least 10 sequential status snapshots' }],
    expectedFirmware: ['rt or fq or ek do not go backwards within a single epoch'],
    expectedPlatform: ['negative deltas are treated as protocol faults, not billed as negative usage'],
    cleanup: [],
    tags: ['monotonic', 'counters'],
  },
  {
    id: 'CARD-001',
    title: 'every swipe should be journaled as an independent fact',
    priority: 'P0',
    category: 'card_swipe',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device has real card reader and test card'],
    steps: [{ kind: 'operator', code: 'SWIPE_CARD_ONCE', note: 'perform one real swipe' }],
    expectedFirmware: ['one swipe generates one swipe fact event separate from command result'],
    expectedPlatform: ['one card_swipe_event row is created without swallowing the action'],
    cleanup: [],
    tags: ['swipe', 'journal'],
  },
  {
    id: 'CARD-002',
    title: 'same card second swipe should prefer stopping current irrigation',
    priority: 'P0',
    category: 'card_swipe',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device is already running a session started by the same card'],
    steps: [{ kind: 'operator', code: 'SWIPE_SAME_CARD_AGAIN', note: 'swipe the same card again during running' }],
    expectedFirmware: ['firmware interprets the second swipe as stop intent first'],
    expectedPlatform: ['stop flow is triggered instead of silently ignoring the swipe'],
    cleanup: [],
    tags: ['same_card', 'stop_intent'],
  },
  {
    id: 'CARD-003',
    title: 'short debounce window must not swallow a real second swipe',
    priority: 'P1',
    category: 'card_swipe',
    readiness: 'needs_operator',
    intent: 'negative',
    preconditions: ['operator can perform two close but real swipes'],
    steps: [{ kind: 'operator', code: 'SWIPE_TWICE_REAL', note: 'perform two real swipes separated by a short but valid interval' }],
    expectedFirmware: ['device debounce is short and local only', 'second real swipe still becomes a fact event'],
    expectedPlatform: ['platform receives two swipe facts and does not collapse them'],
    cleanup: [],
    tags: ['debounce', 'swipe'],
  },
  {
    id: 'CARD-004',
    title: 'swipe events should survive power interruption or be replayed as facts',
    priority: 'P1',
    category: 'card_swipe',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device supports queued swipe audit events', 'operator can cut power after swipe'],
    steps: [{ kind: 'operator', code: 'SWIPE_THEN_POWER_LOSS', note: 'swipe then interrupt power before upload completes' }],
    expectedFirmware: ['swipe event is persisted and replayed after recovery as a fact', 'old start command is not replayed'],
    expectedPlatform: ['journal is eventually complete after reconnect'],
    cleanup: [],
    tags: ['swipe_replay', 'power_loss'],
  },
);

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'PAUSE-001',
    title: 'pause command should freeze runtime and amount',
    priority: 'P0',
    category: 'pause_resume',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device is running a safe session', 'pause capability is enabled in firmware'],
    steps: [syncAction('pause_session', 'workflow'), { kind: 'observe', code: 'PAUSED_FACT', note: 'watch AK and paused runtime state' }],
    expectedFirmware: ['AK is sent only after true pause', 'cumulative runtime stops growing while paused'],
    expectedPlatform: ['session enters paused', 'order lifecycle becomes paused', 'amount freezes during pause'],
    cleanup: ['resume or stop the session after verification'],
    tags: ['pause', 'paused', 'freeze'],
  },
  {
    id: 'PAUSE-002',
    title: 'pause in invalid state should return NK and rollback',
    priority: 'P0',
    category: 'pause_resume',
    readiness: 'ready',
    intent: 'negative',
    preconditions: ['device is not currently running'],
    steps: [syncAction('pause_session', 'workflow')],
    expectedFirmware: ['device returns NK for invalid workflow state'],
    expectedPlatform: ['session does not remain stuck in pausing', 'billing state is restored'],
    cleanup: [],
    tags: ['pause_invalid', 'rollback'],
  },
  {
    id: 'PAUSE-003',
    title: 'resume command should unfreeze and return to running',
    priority: 'P0',
    category: 'pause_resume',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device is paused'],
    steps: [syncAction('resume_session', 'workflow'), { kind: 'observe', code: 'RESUMED_FACT', note: 'watch AK and running fact' }],
    expectedFirmware: ['AK is sent only after true resume', 'runtime resumes increasing after resume success'],
    expectedPlatform: ['session returns to running', 'pause summary accumulates paused duration', 'amount can grow again only after resume accepted'],
    cleanup: ['stop session after verification'],
    tags: ['resume', 'running_again'],
  },
  {
    id: 'PAUSE-004',
    title: 'resume in invalid state should stay paused',
    priority: 'P0',
    category: 'pause_resume',
    readiness: 'ready',
    intent: 'negative',
    preconditions: ['device is not in paused state'],
    steps: [syncAction('resume_session', 'workflow')],
    expectedFirmware: ['device returns NK for invalid workflow state'],
    expectedPlatform: ['session does not remain stuck in resuming', 'paused state or original state is restored correctly'],
    cleanup: [],
    tags: ['resume_invalid', 'rollback'],
  },
  {
    id: 'PAUSE-005',
    title: 'stop from paused or pausing state should be accepted',
    priority: 'P1',
    category: 'pause_resume',
    readiness: 'needs_operator',
    intent: 'recovery',
    preconditions: ['device is paused or pausing'],
    steps: [syncAction('stop_pump', 'module')],
    expectedFirmware: ['device can stop cleanly from paused or pause-transition state'],
    expectedPlatform: ['session is stoppable from paused-related states', 'order closes without reopening running'],
    cleanup: [],
    tags: ['stop_from_paused'],
  },
  {
    id: 'VALVE-001',
    title: 'open valve should return AK only after real open',
    priority: 'P1',
    category: 'valve',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['test valve path is wired and safe'],
    steps: [syncAction('open_valve', 'module')],
    expectedFirmware: ['AK is delayed until valve is truly open'],
    expectedPlatform: ['command closes cleanly and remains correlated'],
    cleanup: ['close valve after verification'],
    tags: ['ovl', 'valve_open'],
  },
  {
    id: 'VALVE-002',
    title: 'close valve should return AK only after real close',
    priority: 'P1',
    category: 'valve',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['valve is already open or closable in test mode'],
    steps: [syncAction('close_valve', 'module')],
    expectedFirmware: ['AK is delayed until valve is truly closed'],
    expectedPlatform: ['command closes cleanly and remains correlated'],
    cleanup: [],
    tags: ['cvl', 'valve_close'],
  },
  {
    id: 'VALVE-003',
    title: 'disabled or unconfigured valve should return explicit NK',
    priority: 'P1',
    category: 'valve',
    readiness: 'needs_operator',
    intent: 'negative',
    preconditions: ['use a device or module without valid valve capability'],
    steps: [syncAction('open_valve', 'module')],
    expectedFirmware: ['device returns explicit NK such as module_not_enabled or invalid_target'],
    expectedPlatform: ['platform does not leave valve command stuck in sent'],
    cleanup: [],
    tags: ['valve_negative', 'nack'],
  },
);

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'CMD-001',
    title: 'start command should succeed only after real start',
    priority: 'P0',
    category: 'command',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device can safely start in test mode', 'no protection latch is active'],
    steps: [syncAction('start_pump', 'module'), { kind: 'observe', code: 'RUNNING_FACT', note: 'watch AK and runtime running fact' }],
    expectedFirmware: ['AK is sent only after pump really enters running state', 'running fact carries session and meter snapshot'],
    expectedPlatform: ['runtime session enters running', 'order leaves pending_start', 'billing baseline is captured at start success'],
    cleanup: ['issue stop command after verification'],
    tags: ['start', 'sync_ack', 'running'],
  },
  {
    id: 'CMD-002',
    title: 'start blocked by protection should return explicit NK',
    priority: 'P0',
    category: 'command',
    readiness: 'needs_operator',
    intent: 'negative',
    preconditions: ['device can be put into safety interlock or protection-latched state'],
    steps: [syncAction('start_pump', 'module')],
    expectedFirmware: ['device returns NK with protection reason instead of silent timeout'],
    expectedPlatform: ['start command closes cleanly', 'pending_start order is cancelled if start never succeeded'],
    cleanup: [],
    tags: ['start', 'protection', 'nack'],
  },
  {
    id: 'CMD-003',
    title: 'start timeout should close pending_start immediately',
    priority: 'P0',
    category: 'command',
    readiness: 'needs_operator',
    intent: 'timeout',
    preconditions: ['device can suppress ACK or running fact for a test start command'],
    steps: [syncAction('start_pump', 'module'), { kind: 'observe', code: 'WAIT_START_TIMEOUT', note: 'wait until sync timeout window passes' }],
    expectedFirmware: ['device does not send delayed start ACK after timeout'],
    expectedPlatform: ['command becomes dead_letter', 'runtime session is ended', 'order is cancelled or refunded and not retried automatically'],
    cleanup: [],
    tags: ['start_timeout', 'pending_start'],
  },
  {
    id: 'CMD-004',
    title: 'duplicate start request should not create a second active order',
    priority: 'P0',
    category: 'command',
    readiness: 'needs_operator',
    intent: 'negative',
    preconditions: ['device can already be running a valid test session'],
    steps: [syncAction('start_pump', 'module'), syncAction('start_pump', 'module')],
    expectedFirmware: ['second start is rejected or ignored explicitly'],
    expectedPlatform: ['no second running order or session is created for the same device'],
    cleanup: ['stop the original session after verification'],
    tags: ['duplicate_start', 'idempotency'],
  },
  {
    id: 'CMD-005',
    title: 'stop command should end session with final snapshot',
    priority: 'P0',
    category: 'command',
    readiness: 'needs_operator',
    intent: 'happy_path',
    preconditions: ['device is already running a safe test session'],
    steps: [syncAction('stop_pump', 'module'), { kind: 'observe', code: 'STOPPED_FACT', note: 'watch AK and final stop event' }],
    expectedFirmware: ['AK is sent only after stop is real', 'final stop event carries final rt or fq or ek snapshot'],
    expectedPlatform: ['session moves to ended then settled', 'order amount freezes at stop accepted and finalizes at stop fact'],
    cleanup: [],
    tags: ['stop', 'final_snapshot'],
  },
  {
    id: 'CMD-006',
    title: 'stop timeout should freeze amount and move to review',
    priority: 'P0',
    category: 'command',
    readiness: 'needs_operator',
    intent: 'timeout',
    preconditions: ['device is running', 'device can suppress stop ACK or final stop fact'],
    steps: [syncAction('stop_pump', 'module'), { kind: 'observe', code: 'WAIT_STOP_TIMEOUT', note: 'wait until stop timeout is exceeded' }],
    expectedFirmware: ['device does not emit misleading late stop success for the timed-out command'],
    expectedPlatform: ['order enters stop_pending_review', 'amount is frozen at stop request snapshot', 'amount does not continue growing while waiting'],
    cleanup: ['manually stop device after verification if still running physically'],
    tags: ['stop_timeout', 'stop_pending_review'],
  },
  {
    id: 'CMD-007',
    title: 'stop when no session is running should return explicit NK',
    priority: 'P0',
    category: 'command',
    readiness: 'ready',
    intent: 'negative',
    preconditions: ['device is idle'],
    steps: [syncAction('stop_pump', 'module')],
    expectedFirmware: ['device returns NK like no_running_session or invalid_workflow_state'],
    expectedPlatform: ['command closes as failed, not sent forever'],
    cleanup: [],
    tags: ['stop_idle', 'nack'],
  },
);

embeddedRealDeviceCaseCatalog.push(
  {
    id: 'QUERY-001',
    title: 'qcs should return common status result',
    priority: 'P0',
    category: 'query',
    readiness: 'ready',
    intent: 'happy_path',
    preconditions: ['device is online'],
    steps: [syncQuery('QUERY_COMMON_STATUS')],
    expectedFirmware: ['device returns QS for qcs instead of silence'],
    expectedPlatform: ['command finishes as acked or failed with explicit reason', 'common status payload is persisted to message log'],
    cleanup: [],
    tags: ['qcs', 'query'],
  },
  {
    id: 'QUERY-002',
    title: 'qwf should return workflow state result',
    priority: 'P0',
    category: 'query',
    readiness: 'ready',
    intent: 'happy_path',
    preconditions: ['device is online'],
    steps: [syncQuery('QUERY_WORKFLOW_STATE')],
    expectedFirmware: ['device returns workflow short code in QS payload'],
    expectedPlatform: ['workflow state can be parsed into runtime state', 'command closes cleanly'],
    cleanup: [],
    tags: ['qwf', 'workflow'],
  },
  {
    id: 'QUERY-003',
    title: 'qem should return electric meter result',
    priority: 'P0',
    category: 'query',
    readiness: 'ready',
    intent: 'happy_path',
    preconditions: ['device is online', 'electric metering module is available'],
    steps: [syncQuery('QUERY_ELECTRIC_METER')],
    expectedFirmware: ['device returns metering data or a clear NK if module is unavailable'],
    expectedPlatform: ['command does not remain sent', 'power metrics are logged when available'],
    cleanup: [],
    tags: ['qem', 'metering'],
  },
  {
    id: 'QUERY-004',
    title: 'unsupported query should fail explicitly',
    priority: 'P1',
    category: 'query',
    readiness: 'needs_firmware_hook',
    intent: 'negative',
    preconditions: ['firmware exposes a way to reject unsupported query codes'],
    steps: [
      {
        kind: 'query',
        code: 'QUERY_UNSUPPORTED',
        apiPath: '/ops/device-gateway/query',
        bodyTemplate: {
          imei: '{{imei}}',
          query_code: 'QUERY_UNSUPPORTED',
          source: '{{source}}',
          dispatch_mode: 'sync',
        },
      },
    ],
    expectedFirmware: ['device returns NK instead of silence'],
    expectedPlatform: ['platform records explicit reject code and closes command as failed or dead_letter'],
    cleanup: [],
    tags: ['unsupported_query', 'nack'],
  },
  {
    id: 'QUERY-005',
    title: 'query storm should stay correlated under concurrency',
    priority: 'P0',
    category: 'query',
    readiness: 'ready',
    intent: 'stress',
    preconditions: ['device is online and idle enough to answer rapid queries'],
    steps: [
      syncQuery('QUERY_COMMON_STATUS'),
      syncQuery('QUERY_WORKFLOW_STATE'),
      syncQuery('QUERY_ELECTRIC_METER'),
      { kind: 'observe', code: 'QUERY_STORM_X20', note: 'run concurrent qcs or qwf or qem rounds' },
    ],
    expectedFirmware: ['device keeps returning correlated QS or NK results under burst load'],
    expectedPlatform: ['no large sent backlog remains after the storm', 'wrong-command correlation does not occur'],
    cleanup: [],
    tags: ['storm', 'concurrency', 'query'],
  },
);

export const embeddedRealDeviceExecutionCatalog = embeddedRealDeviceCaseCatalog.map((item) => ({
  ...item,
  repeat: item.repeat ?? buildDefaultRepeat(item),
  oracles: item.oracles ?? buildDefaultOracles(item),
  improvementTargets: item.improvementTargets ?? buildDefaultImprovementTargets(item),
}));

export const embeddedRealDeviceCaseSummary = () => ({
  total: embeddedRealDeviceExecutionCatalog.length,
  ready: embeddedRealDeviceExecutionCatalog.filter((item) => item.readiness === 'ready').length,
  needs_operator: embeddedRealDeviceExecutionCatalog.filter((item) => item.readiness === 'needs_operator').length,
  needs_firmware_hook: embeddedRealDeviceExecutionCatalog.filter((item) => item.readiness === 'needs_firmware_hook').length,
  p0: embeddedRealDeviceExecutionCatalog.filter((item) => item.priority === 'P0').length,
  p1: embeddedRealDeviceExecutionCatalog.filter((item) => item.priority === 'P1').length,
  p2: embeddedRealDeviceExecutionCatalog.filter((item) => item.priority === 'P2').length,
  repeat_cases: embeddedRealDeviceExecutionCatalog.filter((item) => item.repeat?.mode === 'repeat').length,
  chaos_cases: embeddedRealDeviceExecutionCatalog.filter((item) => item.repeat?.mode === 'chaos').length,
});
