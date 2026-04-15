import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderSettlementService } from '../order/order-settlement.service';
import { RuntimeRepository } from './runtime.repository';
import { RuntimeService } from './runtime.service';

type ProgressMaintainerState = {
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
export class RuntimeProgressMaintainerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeProgressMaintainerService.name);
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly state: ProgressMaintainerState;

  constructor(
    private readonly configService: ConfigService,
    private readonly runtimeRepository: RuntimeRepository,
    private readonly orderSettlementService: OrderSettlementService,
    private readonly runtimeService: RuntimeService
  ) {
    this.state = {
      intervalSeconds: this.getSweepIntervalSeconds(),
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

  onModuleInit() {
    if (!this.isAutomationEnabled()) {
      this.state.lastStatus = 'disabled';
      return;
    }

    const startupDelaySeconds = this.getStartupDelaySeconds();
    this.state.nextRunDueAt = new Date(Date.now() + startupDelaySeconds * 1000).toISOString();
    this.startupTimer = setTimeout(() => {
      void this.runSweep();
      this.intervalTimer = setInterval(() => {
        void this.runSweep();
      }, this.state.intervalSeconds * 1000);
    }, startupDelaySeconds * 1000);
  }

  onModuleDestroy() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
  }

  getHealth() {
    return {
      automation_mode: 'interval_runtime_progress_maintainer',
      enabled: this.isAutomationEnabled(),
      startup_delay_seconds: this.getStartupDelaySeconds(),
      interval_seconds: this.state.intervalSeconds,
      running: this.state.running,
      total_runs: this.state.totalRuns,
      success_runs: this.state.successRuns,
      error_runs: this.state.errorRuns,
      skipped_overlap_runs: this.state.skippedOverlapRuns,
      last_started_at: this.state.lastStartedAt,
      last_completed_at: this.state.lastCompletedAt,
      last_status: this.state.lastStatus,
      last_error: this.state.lastError,
      last_result: this.state.lastResult,
      next_run_due_at: this.state.nextRunDueAt
    };
  }

  private isAutomationEnabled() {
    const raw = this.configService.get<string>('RUNTIME_PROGRESS_AUTOMATION_ENABLED');
    if (raw === undefined || raw === null || raw === '') return true;
    const normalized = raw.trim().toLowerCase();
    return !['false', '0', 'off', 'no'].includes(normalized);
  }

  private getStartupDelaySeconds() {
    const raw = Number(this.configService.get<string>('RUNTIME_PROGRESS_AUTOMATION_STARTUP_DELAY_SECONDS') || 15);
    if (!Number.isFinite(raw)) return 15;
    return Math.min(Math.max(Math.trunc(raw), 0), 300);
  }

  private getSweepIntervalSeconds() {
    const raw = Number(this.configService.get<string>('RUNTIME_PROGRESS_SWEEP_INTERVAL_SECONDS') || 60);
    if (!Number.isFinite(raw)) return 60;
    return Math.min(Math.max(Math.trunc(raw), 15), 3600);
  }

  private async runSweep() {
    if (this.state.running) {
      this.state.skippedOverlapRuns += 1;
      this.state.lastStatus = 'skipped_overlap';
      this.state.nextRunDueAt = new Date(Date.now() + this.state.intervalSeconds * 1000).toISOString();
      return;
    }

    this.state.running = true;
    this.state.totalRuns += 1;
    this.state.lastStartedAt = new Date().toISOString();
    this.state.lastError = null;

    try {
      const candidates = await this.runtimeRepository.listSessionsNeedingProgressSweep();
      let updatedCount = 0;
      let skippedCount = 0;
      let autoStopRequestedCount = 0;

      for (const candidate of candidates) {
        try {
          const progress = await this.orderSettlementService.syncProgressBySessionId(candidate.sessionId);
          if (!progress || 'skipped' in progress) {
            skippedCount += 1;
            continue;
          }
          updatedCount += 1;
          if (
            progress.creditLimitReached &&
            (candidate.sessionStatus === 'running' || candidate.sessionStatus === 'billing')
          ) {
            await this.runtimeService.stopSessionBySystem(candidate.sessionId, {
              reasonCode: 'CREDIT_LIMIT_REACHED',
              reasonText: 'credit limit reached during background progress sweep, stop requested automatically',
              endReasonCode: 'credit_limit_reached_auto_stop_requested',
              snapshot: {
                credit_limit_amount: progress.creditLimitAmount,
                current_amount: progress.amount,
                order_id: progress.orderId
              }
            });
            autoStopRequestedCount += 1;
          }
        } catch (error) {
          this.logger.warn(
            `runtime progress sync failed for session ${candidate.sessionId}: ${this.stringifyError(error)}`
          );
        }
      }

      this.state.successRuns += 1;
      this.state.lastStatus = 'success';
      this.state.lastResult = {
        scanned_session_count: candidates.length,
        updated_session_count: updatedCount,
        skipped_session_count: skippedCount,
        auto_stop_requested_count: autoStopRequestedCount
      };
    } catch (error) {
      this.state.errorRuns += 1;
      this.state.lastStatus = 'error';
      this.state.lastError = this.stringifyError(error);
      this.logger.warn(`runtime progress sweep failed: ${this.state.lastError}`);
    } finally {
      this.state.running = false;
      this.state.lastCompletedAt = new Date().toISOString();
      this.state.nextRunDueAt = new Date(Date.now() + this.state.intervalSeconds * 1000).toISOString();
    }
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
}
