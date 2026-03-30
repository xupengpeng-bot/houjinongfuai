import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceGatewayService } from './device-gateway.service';

type MaintenanceLaneName = 'retry_sweep' | 'connection_sweep';

type MaintenanceLaneState = {
  intervalSeconds: number;
  running: boolean;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  skippedOverlapRuns: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: 'idle' | 'success' | 'error' | 'skipped_overlap' | 'disabled';
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  nextRunDueAt: string | null;
};

@Injectable()
export class DeviceGatewayMaintainerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceGatewayMaintainerService.name);
  private readonly startupTimers = new Map<MaintenanceLaneName, NodeJS.Timeout>();
  private readonly intervalTimers = new Map<MaintenanceLaneName, NodeJS.Timeout>();
  private readonly states: Record<MaintenanceLaneName, MaintenanceLaneState>;

  constructor(
    private readonly configService: ConfigService,
    private readonly gatewayService: DeviceGatewayService
  ) {
    this.states = {
      retry_sweep: this.createInitialState(this.getRetrySweepIntervalSeconds()),
      connection_sweep: this.createInitialState(this.getConnectionSweepIntervalSeconds())
    };
  }

  onModuleInit() {
    if (!this.isAutomationEnabled()) {
      this.states.retry_sweep.lastStatus = 'disabled';
      this.states.connection_sweep.lastStatus = 'disabled';
      return;
    }

    this.scheduleLane('retry_sweep', () => this.gatewayService.sweepRetries());
    this.scheduleLane('connection_sweep', () => this.gatewayService.sweepConnections());
  }

  onModuleDestroy() {
    for (const timer of this.startupTimers.values()) clearTimeout(timer);
    for (const timer of this.intervalTimers.values()) clearInterval(timer);
    this.startupTimers.clear();
    this.intervalTimers.clear();
  }

  getRecoveryHealth() {
    return {
      automation_mode: 'interval_background_maintainer',
      enabled: this.isAutomationEnabled(),
      startup_delay_seconds: this.getStartupDelaySeconds(),
      lanes: {
        retry_sweep: this.serializeState('retry_sweep'),
        connection_sweep: this.serializeState('connection_sweep')
      }
    };
  }

  private createInitialState(intervalSeconds: number): MaintenanceLaneState {
    return {
      intervalSeconds,
      running: false,
      totalRuns: 0,
      successRuns: 0,
      errorRuns: 0,
      skippedOverlapRuns: 0,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: 'idle',
      lastError: null,
      lastResult: null,
      nextRunDueAt: null
    };
  }

  private serializeState(name: MaintenanceLaneName) {
    const state = this.states[name];
    return {
      interval_seconds: state.intervalSeconds,
      running: state.running,
      total_runs: state.totalRuns,
      success_runs: state.successRuns,
      error_runs: state.errorRuns,
      skipped_overlap_runs: state.skippedOverlapRuns,
      last_started_at: state.lastStartedAt,
      last_completed_at: state.lastCompletedAt,
      last_status: state.lastStatus,
      last_error: state.lastError,
      last_result: state.lastResult,
      next_run_due_at: state.nextRunDueAt
    };
  }

  private isAutomationEnabled() {
    const raw = this.configService.get<string>('DEVICE_GATEWAY_AUTOMATION_ENABLED');
    if (raw === undefined || raw === null || raw === '') return true;
    const normalized = raw.trim().toLowerCase();
    return !['false', '0', 'off', 'no'].includes(normalized);
  }

  private getStartupDelaySeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_AUTOMATION_STARTUP_DELAY_SECONDS') || 5);
    if (!Number.isFinite(raw)) return 5;
    return Math.min(Math.max(Math.trunc(raw), 0), 300);
  }

  private getRetrySweepIntervalSeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_RETRY_SWEEP_INTERVAL_SECONDS') || 15);
    if (!Number.isFinite(raw)) return 15;
    return Math.min(Math.max(Math.trunc(raw), 5), 3600);
  }

  private getConnectionSweepIntervalSeconds() {
    const raw = Number(this.configService.get<string>('DEVICE_GATEWAY_CONNECTION_SWEEP_INTERVAL_SECONDS') || 30);
    if (!Number.isFinite(raw)) return 30;
    return Math.min(Math.max(Math.trunc(raw), 5), 3600);
  }

  private scheduleLane(name: MaintenanceLaneName, runner: () => Promise<Record<string, unknown>>) {
    const intervalSeconds = this.states[name].intervalSeconds;
    const startupDelaySeconds = this.getStartupDelaySeconds();
    this.states[name].nextRunDueAt = new Date(Date.now() + startupDelaySeconds * 1000).toISOString();

    const startupTimer = setTimeout(() => {
      void this.runLane(name, runner);
      const timer = setInterval(() => {
        void this.runLane(name, runner);
      }, intervalSeconds * 1000);
      this.intervalTimers.set(name, timer);
    }, startupDelaySeconds * 1000);

    this.startupTimers.set(name, startupTimer);
  }

  private async runLane(name: MaintenanceLaneName, runner: () => Promise<Record<string, unknown>>) {
    const state = this.states[name];
    if (state.running) {
      state.skippedOverlapRuns += 1;
      state.lastStatus = 'skipped_overlap';
      state.nextRunDueAt = new Date(Date.now() + state.intervalSeconds * 1000).toISOString();
      return;
    }

    state.running = true;
    state.totalRuns += 1;
    state.lastStartedAt = new Date().toISOString();
    state.lastError = null;

    try {
      const result = await runner();
      state.successRuns += 1;
      state.lastStatus = 'success';
      state.lastResult = result;
    } catch (error) {
      state.errorRuns += 1;
      state.lastStatus = 'error';
      state.lastError = this.stringifyError(error);
      this.logger.warn(`${name} failed: ${state.lastError}`);
    } finally {
      state.running = false;
      state.lastCompletedAt = new Date().toISOString();
      state.nextRunDueAt = new Date(Date.now() + state.intervalSeconds * 1000).toISOString();
    }
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
}
