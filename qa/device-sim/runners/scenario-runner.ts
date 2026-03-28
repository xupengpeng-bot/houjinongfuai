export interface DeviceSimScenarioStep {
  atMs: number;
  direction: 'up' | 'down';
  msgType: string;
  payload: Record<string, unknown>;
}

export interface DeviceSimScenario {
  scenarioCode: string;
  imei: string;
  steps: DeviceSimScenarioStep[];
}

export function loadScenarioSkeleton(input: DeviceSimScenario): DeviceSimScenario {
  return input;
}
