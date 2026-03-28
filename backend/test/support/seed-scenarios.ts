export const SCENARIOS = {
  S01: {
    code: 'S01',
    name: 'normal_start_stop',
    semantics: 'normal scan start, active runtime, and settled stop order',
    defaultTargetType: 'valve',
    defaultSceneCode: 'farmer_scan_start',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000501',
      wellCode: 'WELL-S01-001',
      valveId: '00000000-0000-0000-0000-000000000701',
      valveCode: 'VALVE-S01-001',
      pumpId: '00000000-0000-0000-0000-000000000601',
      billingPackageId: '00000000-0000-0000-0000-000000000801'
    }
  },
  S02: {
    code: 'S02',
    name: 'insufficient_balance',
    semantics: 'insufficient balance deny baseline for later funding UAT',
    defaultTargetType: 'valve',
    defaultSceneCode: 'insufficient_balance_scene',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000502',
      wellCode: 'WELL-S02-001',
      valveId: '00000000-0000-0000-0000-000000000702',
      valveCode: 'VALVE-S02-001'
    }
  },
  S03: {
    code: 'S03',
    name: 'policy_missing',
    semantics: 'policy missing deny scenario',
    defaultTargetType: 'valve',
    defaultSceneCode: 'policy_missing_scene',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000503',
      wellCode: 'WELL-S03-001',
      valveId: '00000000-0000-0000-0000-000000000703',
      valveCode: 'VALVE-S03-001'
    }
  },
  S04: {
    code: 'S04',
    name: 'topology_blocked',
    semantics: 'topology or offline blocking scenario',
    defaultTargetType: 'valve',
    defaultSceneCode: 'farmer_scan_start',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000504',
      wellCode: 'WELL-S04-001',
      valveId: '00000000-0000-0000-0000-000000000704',
      valveCode: 'VALVE-S04-001',
      offlineDeviceId: '00000000-0000-0000-0000-000000000424'
    }
  },
  S05: {
    code: 'S05',
    name: 'free_package',
    semantics: 'free billing package allow scenario',
    defaultTargetType: 'valve',
    defaultSceneCode: 'farmer_scan_start',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000505',
      wellCode: 'WELL-S05-001',
      valveId: '00000000-0000-0000-0000-000000000705',
      valveCode: 'VALVE-S05-001',
      billingPackageId: '00000000-0000-0000-0000-000000000803'
    }
  },
  S06: {
    code: 'S06',
    name: 'active_session_order',
    semantics: 'seeded active session and active order baseline',
    defaultTargetType: 'well',
    defaultSceneCode: 'farmer_scan_start',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000506',
      wellCode: 'WELL-S06-001',
      valveId: '00000000-0000-0000-0000-000000000706',
      valveCode: 'VALVE-S06-001',
      sessionId: '00000000-0000-0000-0000-000000003106',
      orderId: '00000000-0000-0000-0000-000000003306'
    }
  },
  S07: {
    code: 'S07',
    name: 'alert_workorder',
    semantics: 'alert and work order visibility baseline',
    defaultTargetType: 'well',
    defaultSceneCode: 'farmer_scan_start',
    objects: {
      alarmPendingId: '00000000-0000-0000-0000-000000003501',
      alarmProcessingId: '00000000-0000-0000-0000-000000003502',
      alarmResolvedId: '00000000-0000-0000-0000-000000003503',
      workOrderCreatedId: '00000000-0000-0000-0000-000000003601',
      workOrderAssignedId: '00000000-0000-0000-0000-000000003602',
      workOrderInProgressId: '00000000-0000-0000-0000-000000003603',
      workOrderCompletedId: '00000000-0000-0000-0000-000000003604',
      workOrderClosedId: '00000000-0000-0000-0000-000000003605'
    }
  },
  S08: {
    code: 'S08',
    name: 'object_baseline_fallback',
    semantics: 'object baseline plus fallback allow source chain',
    defaultTargetType: 'valve',
    defaultSceneCode: 'farmer_scan_start',
    objects: {
      wellId: '00000000-0000-0000-0000-000000000507',
      wellCode: 'WELL-S08-001',
      valveId: '00000000-0000-0000-0000-000000000707',
      valveCode: 'VALVE-S08-001',
      relationId: '00000000-0000-0000-0000-000000001007',
      billingPackageIdFromRelation: '00000000-0000-0000-0000-000000000804',
      interactionPolicyWellId: '00000000-0000-0000-0000-000000000851',
      interactionPolicyValveId: '00000000-0000-0000-0000-000000000852',
      scenarioTemplateId: '00000000-0000-0000-0000-000000000861',
      wellDeviceTypeId: '00000000-0000-0000-0000-000000000301'
    },
    expectedFallbackSources: {
      billingPackageId: 'pump_valve_relation',
      maxRunSeconds: 'interaction_policy',
      concurrencyLimit: 'interaction_policy',
      idleTimeoutSeconds: 'device_type_default',
      stopProtectionMode: 'scenario_template'
    }
  }
} as const;

export type ScenarioCode = keyof typeof SCENARIOS;
