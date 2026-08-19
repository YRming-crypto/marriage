export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export interface StructuredLogEntry {
  id: number;
  level: LogLevel;
  event: string;
  occurredAt: number;
  context: LogContext;
}

export interface LogQuery {
  level?: LogLevel;
  event?: string;
  limit?: number;
}

export interface RequestMetricSample {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface LatencySummary {
  min: number;
  max: number;
  average: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface RouteMetricsSnapshot {
  method: string;
  route: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyMs: LatencySummary;
}

export interface RequestMetricsSnapshot {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyMs: LatencySummary;
  routes: RouteMetricsSnapshot[];
}

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface ComponentHealthResult {
  status: HealthStatus;
  detail?: string;
}

export interface ComponentHealthSnapshot extends ComponentHealthResult {
  name: string;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: number;
  components: ComponentHealthSnapshot[];
}

export type HealthCheck = () => ComponentHealthResult | Promise<ComponentHealthResult>;

export type CleanupTarget = "accountDeletions" | "otp" | "sessions" | "dataExports" | "typing" | "eventHistory";
export type MaintenanceStatus = "running" | "succeeded" | "failed";
export type CleanupResultStatus = "succeeded" | "failed";

export interface CleanupStep {
  target: CleanupTarget;
  cleanup: () => number | Promise<number>;
}

export interface CleanupStepResult {
  target: CleanupTarget;
  status: CleanupResultStatus;
  removedCount: number;
  error?: string;
}

export interface MaintenanceRun {
  id: string;
  taskName: string;
  actorId: string;
  status: MaintenanceStatus;
  startedAt: number;
  finishedAt: number | null;
  results: CleanupStepResult[];
  totalRemoved: number;
}

export interface CleanupPlan {
  taskName: string;
  actorId: string;
  steps: CleanupStep[];
}

export interface MaintenanceRunQuery {
  status?: MaintenanceStatus;
  taskName?: string;
  limit?: number;
}

export interface MaintenanceSummary {
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  totalRemoved: number;
  recentRuns: MaintenanceRun[];
}

export interface AdminOperationsSummary {
  generatedAt: number;
  health: HealthReport;
  requests: RequestMetricsSnapshot;
  maintenance: MaintenanceSummary;
  recentErrors: StructuredLogEntry[];
}
