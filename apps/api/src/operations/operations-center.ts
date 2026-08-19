import { HealthRegistry } from "./health.js";
import { StructuredLogger } from "./logger.js";
import { MaintenanceService } from "./maintenance.js";
import { RequestMetrics } from "./metrics.js";
import type { AdminOperationsSummary, MaintenanceRun } from "./types.js";

export interface OperationsCenterOptions {
  now?: () => number;
  createRunId?: () => string;
  maxLogEntries?: number;
  maxMaintenanceRuns?: number;
}
export interface AdminSummaryOptions {
  recentRunLimit?: number;
  recentErrorLimit?: number;
}

export class OperationsCenter {
  readonly logger: StructuredLogger;
  readonly metrics: RequestMetrics;
  readonly health: HealthRegistry;
  readonly maintenance: MaintenanceService;
  private readonly now: () => number;

  constructor(options: OperationsCenterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.logger = new StructuredLogger({
      now: this.now,
      maxEntries: options.maxLogEntries,
    });
    this.metrics = new RequestMetrics();
    this.health = new HealthRegistry({ now: this.now });
    this.maintenance = new MaintenanceService({
      now: this.now,
      createId: options.createRunId,
      maxRuns: options.maxMaintenanceRuns,
    });
  }

  async getAdminSummary(options: AdminSummaryOptions = {}): Promise<AdminOperationsSummary> {
    const recentRunLimit = options.recentRunLimit ?? 10;
    const recentErrorLimit = options.recentErrorLimit ?? 20;
    validateLimit(recentRunLimit);
    validateLimit(recentErrorLimit);

    const allRuns = this.maintenance.listRuns();
    const recentRuns = this.maintenance.listRuns({ limit: recentRunLimit }).reverse();
    return {
      generatedAt: this.now(),
      health: await this.health.checkAll(),
      requests: this.metrics.snapshot(),
      maintenance: summarizeRuns(allRuns, recentRuns),
      recentErrors: this.logger.list({ level: "error", limit: recentErrorLimit }).reverse(),
    };
  }
}

function summarizeRuns(allRuns: MaintenanceRun[], recentRuns: MaintenanceRun[]) {
  return {
    runningCount: allRuns.filter((run) => run.status === "running").length,
    succeededCount: allRuns.filter((run) => run.status === "succeeded").length,
    failedCount: allRuns.filter((run) => run.status === "failed").length,
    totalRemoved: allRuns.reduce((total, run) => total + run.totalRemoved, 0),
    recentRuns,
  };
}

function validateLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError("摘要条数必须是正整数");
  }
}
