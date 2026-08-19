import { cloneSanitized } from "./redaction.js";
import type {
  CleanupPlan,
  CleanupStepResult,
  MaintenanceRun,
  MaintenanceRunQuery,
} from "./types.js";

export interface MaintenanceServiceOptions {
  now?: () => number;
  createId?: () => string;
  maxRuns?: number;
}

export class MaintenanceConflictError extends Error {
  readonly code = "MAINTENANCE_ALREADY_RUNNING";
  readonly statusCode = 409;

  constructor(taskName: string) {
    super(`维护任务 ${taskName} 正在运行`);
    this.name = "MaintenanceConflictError";
  }
}

export class MaintenanceService {
  private readonly runs: MaintenanceRun[] = [];
  private readonly activeTasks = new Set<string>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly maxRuns: number;

  constructor(options: MaintenanceServiceOptions = {}) {
    let sequence = 0;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `maintenance-${this.now()}-${++sequence}`);
    this.maxRuns = options.maxRuns ?? 200;
    if (!Number.isInteger(this.maxRuns) || this.maxRuns < 1) {
      throw new TypeError("maxRuns 必须是正整数");
    }
  }

  async runCleanup(plan: CleanupPlan): Promise<MaintenanceRun> {
    const normalized = validatePlan(plan);
    if (this.activeTasks.has(normalized.taskName)) {
      throw new MaintenanceConflictError(normalized.taskName);
    }

    const run: MaintenanceRun = {
      id: this.createId(),
      taskName: normalized.taskName,
      actorId: normalized.actorId,
      status: "running",
      startedAt: this.now(),
      finishedAt: null,
      results: [],
      totalRemoved: 0,
    };
    if (!run.id.trim() || this.runs.some((existing) => existing.id === run.id)) {
      throw new TypeError("维护任务 ID 必须非空且唯一");
    }
    this.activeTasks.add(normalized.taskName);
    this.runs.push(run);
    this.trimRuns();

    try {
      for (const step of normalized.steps) {
        const result = await executeStep(step.target, step.cleanup);
        run.results.push(result);
        run.totalRemoved += result.removedCount;
      }
      run.status = run.results.some((result) => result.status === "failed") ? "failed" : "succeeded";
      run.finishedAt = this.now();
      return cloneSanitized(run);
    } finally {
      if (run.status === "running") {
        run.status = "failed";
        run.finishedAt = this.now();
      }
      this.activeTasks.delete(normalized.taskName);
    }
  }

  getRun(id: string) {
    const run = this.runs.find((candidate) => candidate.id === id);
    return run === undefined ? undefined : cloneSanitized(run);
  }

  listRuns(query: MaintenanceRunQuery = {}) {
    validateLimit(query.limit);
    const matching = this.runs.filter((run) => (
      (query.status === undefined || run.status === query.status)
      && (query.taskName === undefined || run.taskName === query.taskName)
    ));
    const limited = query.limit === undefined ? matching : matching.slice(-query.limit);
    return cloneSanitized(limited);
  }

  restoreRuns(runs: MaintenanceRun[]) {
    this.runs.length = 0;
    for (const run of runs.slice(-this.maxRuns)) {
      if (!run.id?.trim() || !run.taskName?.trim() || !run.actorId?.trim()) continue;
      this.runs.push(cloneSanitized({
        ...run,
        status: run.status === "running" ? "failed" : run.status,
        finishedAt: run.finishedAt ?? this.now(),
      }));
    }
  }

  private trimRuns() {
    if (this.runs.length <= this.maxRuns) {
      return;
    }
    const removableIndex = this.runs.findIndex((run) => run.status !== "running");
    if (removableIndex >= 0) {
      this.runs.splice(removableIndex, 1);
    }
  }
}

function validatePlan(plan: CleanupPlan): CleanupPlan {
  const taskName = plan.taskName.trim();
  const actorId = plan.actorId.trim();
  if (!taskName || !actorId) {
    throw new TypeError("taskName 和 actorId 不能为空");
  }
  if (!Array.isArray(plan.steps)) {
    throw new TypeError("steps 必须是数组");
  }
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.target)) {
      throw new TypeError(`清理目标 ${step.target} 重复`);
    }
    if (!["accountDeletions", "otp", "sessions", "dataExports", "typing", "eventHistory"].includes(step.target)) {
      throw new TypeError("存在未知清理目标");
    }
    if (typeof step.cleanup !== "function") {
      throw new TypeError("cleanup 必须是函数");
    }
    seen.add(step.target);
  }
  return { taskName, actorId, steps: [...plan.steps] };
}

async function executeStep(
  target: CleanupStepResult["target"],
  cleanup: () => number | Promise<number>,
): Promise<CleanupStepResult> {
  try {
    const removedCount = await cleanup();
    if (!Number.isInteger(removedCount) || removedCount < 0) {
      throw new TypeError("清理数量必须是非负整数");
    }
    return { target, status: "succeeded", removedCount };
  } catch {
    return { target, status: "failed", removedCount: 0, error: "清理失败" };
  }
}

function validateLimit(limit: number | undefined) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new TypeError("limit 必须是正整数");
  }
}
