import { describe, expect, it } from "vitest";
import {
  HealthRegistry,
  MaintenanceConflictError,
  MaintenanceService,
  OperationsCenter,
  RequestMetrics,
  StructuredLogger,
  type CleanupTarget,
  type MaintenanceRun,
} from "./index.js";

const NOW = Date.parse("2026-08-14T08:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("StructuredLogger", () => {
  it("recursively redacts phones, tokens, verification codes, and message bodies", () => {
    const logger = new StructuredLogger({ now: () => NOW });
    const context = {
      phone: "13800138000",
      accessToken: "secret-access-token",
      nested: {
        verificationCode: "482931",
        messageBody: "今晚见面吗？",
        safe: "conversation-1",
      },
      message: {
        body: "这是正文一",
        text: "这是正文二",
        content: "这是正文三",
        id: "message-1",
      },
      otp: { code: "654321", expiresAt: NOW + 60_000 },
      authorization: "Bearer abc.def.ghi",
      note: "联系电话 13900139000，验证码: 123456，token=raw-token-value",
    };

    const entry = logger.info("request.received", context);
    const serialized = JSON.stringify(entry);

    expect(entry).toMatchObject({
      id: 1,
      level: "info",
      event: "request.received",
      occurredAt: NOW,
      context: {
        phone: "[REDACTED]",
        accessToken: "[REDACTED]",
        nested: {
          verificationCode: "[REDACTED]",
          messageBody: "[REDACTED]",
          safe: "conversation-1",
        },
        message: {
          body: "[REDACTED]",
          text: "[REDACTED]",
          content: "[REDACTED]",
          id: "message-1",
        },
        otp: { code: "[REDACTED]", expiresAt: NOW + 60_000 },
        authorization: "[REDACTED]",
      },
    });
    expect(serialized).not.toContain("13800138000");
    expect(serialized).not.toContain("13900139000");
    expect(serialized).not.toContain("482931");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("654321");
    expect(serialized).not.toContain("secret-access-token");
    expect(serialized).not.toContain("raw-token-value");
    expect(serialized).not.toContain("今晚见面吗");
    expect(serialized).not.toContain("这是正文");
    expect(context.nested.messageBody).toBe("今晚见面吗？");
  });

  it("serializes errors safely and returns defensive copies of bounded logs", () => {
    const logger = new StructuredLogger({ now: () => NOW, maxEntries: 2 });
    const error = new Error("短信发送失败，手机号 13800138000");
    Object.assign(error, { token: "do-not-log", code: "SMS_UNAVAILABLE" });

    const recorded = logger.error("sms.failed", { error });
    expect(recorded.context.error).toEqual({
      name: "Error",
      message: "短信发送失败，手机号 [REDACTED]",
      token: "[REDACTED]",
      code: "SMS_UNAVAILABLE",
    });
    logger.warn("health.degraded", { component: "sms" });
    logger.info("health.recovered", { component: "sms" });

    const entries = logger.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.event)).toEqual(["health.degraded", "health.recovered"]);
    expect(JSON.stringify(recorded)).not.toContain("13800138000");

    entries[0]!.context.component = "changed";
    expect(logger.list()[0]!.context.component).toBe("sms");
  });
});

describe("RequestMetrics", () => {
  it("reports request counts, error rate, and nearest-rank latency percentiles", () => {
    const metrics = new RequestMetrics();
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach((durationMs, index) => {
      metrics.record({
        method: "GET",
        route: index < 8 ? "/api/matches" : "/api/messages",
        statusCode: index === 8 ? 400 : index === 9 ? 500 : 200,
        durationMs,
      });
    });

    expect(metrics.snapshot()).toMatchObject({
      requestCount: 10,
      errorCount: 2,
      errorRate: 0.2,
      latencyMs: { min: 10, max: 100, average: 55, p50: 50, p95: 100, p99: 100 },
    });
    expect(metrics.snapshot().routes).toEqual([
      expect.objectContaining({ method: "GET", route: "/api/matches", requestCount: 8 }),
      expect.objectContaining({ method: "GET", route: "/api/messages", requestCount: 2, errorRate: 1 }),
    ]);
  });

  it("validates samples and returns a zero-safe empty snapshot", () => {
    const metrics = new RequestMetrics();

    expect(metrics.snapshot()).toMatchObject({
      requestCount: 0,
      errorCount: 0,
      errorRate: 0,
      latencyMs: { min: 0, max: 0, average: 0, p50: 0, p95: 0, p99: 0 },
      routes: [],
    });
    expect(() => metrics.record({ method: "", route: "/", statusCode: 200, durationMs: 1 })).toThrow();
    expect(() => metrics.record({ method: "GET", route: "/", statusCode: 99, durationMs: -1 })).toThrow();
  });
});

describe("HealthRegistry", () => {
  it("aggregates healthy, degraded, unhealthy, and thrown component checks", async () => {
    const health = new HealthRegistry({ now: () => NOW });
    health.register("api", () => ({ status: "healthy", detail: "ready" }));
    health.register("database", async () => ({ status: "degraded", detail: "slow" }));
    health.register("ai-provider", () => {
      throw new Error("token=provider-secret");
    });

    const report = await health.checkAll();

    expect(report.status).toBe("unhealthy");
    expect(report.checkedAt).toBe(NOW);
    expect(report.components).toEqual([
      { name: "ai-provider", status: "unhealthy", detail: "检查失败" },
      { name: "api", status: "healthy", detail: "ready" },
      { name: "database", status: "degraded", detail: "slow" },
    ]);
    expect(JSON.stringify(report)).not.toContain("provider-secret");
  });

  it("supports replacement, removal, and an empty healthy registry", async () => {
    const health = new HealthRegistry({ now: () => NOW });
    health.register("database", () => ({ status: "unhealthy" }));
    health.register("database", () => ({ status: "healthy" }));

    expect((await health.checkAll()).status).toBe("healthy");
    expect(health.unregister("database")).toBe(true);
    expect(health.unregister("database")).toBe(false);
    expect(await health.checkAll()).toEqual({ status: "healthy", checkedAt: NOW, components: [] });
  });
});

describe("MaintenanceService", () => {
  it("records running and succeeded cleanup runs with every target result", async () => {
    let now = NOW;
    let sequence = 0;
    const service = new MaintenanceService({
      now: () => now,
      createId: () => `run-${++sequence}`,
    });
    const gate = deferred<number>();
    const targets: CleanupTarget[] = ["accountDeletions", "otp", "sessions", "dataExports", "typing", "eventHistory"];
    const runPromise = service.runCleanup({
      taskName: "expired-resources",
      actorId: "admin-1",
      steps: targets.map((target, index) => ({
        target,
        cleanup: index === 0 ? () => gate.promise : () => index + 1,
      })),
    });

    expect(service.getRun("run-1")).toMatchObject({
      status: "running",
      taskName: "expired-resources",
      actorId: "admin-1",
      startedAt: NOW,
      finishedAt: null,
      results: [],
    });

    now += 25;
    gate.resolve(3);
    const run = await runPromise;

    expect(run.status).toBe("succeeded");
    expect(run.finishedAt).toBe(NOW + 25);
    expect(run.results.map((result) => [result.target, result.status, result.removedCount])).toEqual([
      ["accountDeletions", "succeeded", 3],
      ["otp", "succeeded", 2],
      ["sessions", "succeeded", 3],
      ["dataExports", "succeeded", 4],
      ["typing", "succeeded", 5],
      ["eventHistory", "succeeded", 6],
    ]);
    expect(run.totalRemoved).toBe(23);
  });

  it("continues after a failed cleanup step and marks the run failed without leaking errors", async () => {
    const service = new MaintenanceService({ now: () => NOW, createId: () => "run-failed" });

    const run = await service.runCleanup({
      taskName: "expired-resources",
      actorId: "admin-1",
      steps: [
        { target: "otp", cleanup: () => 2 },
        { target: "sessions", cleanup: () => { throw new Error("token=secret-token"); } },
        { target: "typing", cleanup: () => 4 },
      ],
    });

    expect(run).toMatchObject({ status: "failed", totalRemoved: 6 });
    expect(run.results).toEqual([
      { target: "otp", status: "succeeded", removedCount: 2 },
      { target: "sessions", status: "failed", removedCount: 0, error: "清理失败" },
      { target: "typing", status: "succeeded", removedCount: 4 },
    ]);
    expect(JSON.stringify(run)).not.toContain("secret-token");
  });

  it("rejects concurrent runs for the same task but permits another task", async () => {
    let sequence = 0;
    const service = new MaintenanceService({
      now: () => NOW,
      createId: () => `run-${++sequence}`,
    });
    const gate = deferred<number>();
    const first = service.runCleanup({
      taskName: "expired-resources",
      actorId: "admin-1",
      steps: [{ target: "otp", cleanup: () => gate.promise }],
    });

    await expect(service.runCleanup({
      taskName: "expired-resources",
      actorId: "admin-2",
      steps: [],
    })).rejects.toBeInstanceOf(MaintenanceConflictError);

    await expect(service.runCleanup({
      taskName: "metrics-rollup",
      actorId: "admin-2",
      steps: [],
    })).resolves.toMatchObject({ status: "succeeded" });

    gate.resolve(1);
    await first;
    await expect(service.runCleanup({
      taskName: "expired-resources",
      actorId: "admin-2",
      steps: [],
    })).resolves.toMatchObject({ status: "succeeded" });
  });

  it("validates plans and returns defensive run copies", async () => {
    const service = new MaintenanceService({ now: () => NOW, createId: () => "run-1" });
    await expect(service.runCleanup({ taskName: " ", actorId: "admin", steps: [] })).rejects.toThrow();
    await expect(service.runCleanup({
      taskName: "cleanup",
      actorId: " ",
      steps: [],
    })).rejects.toThrow();
    await expect(service.runCleanup({
      taskName: "cleanup",
      actorId: "admin",
      steps: [
        { target: "otp", cleanup: () => -1 },
        { target: "otp", cleanup: () => 1 },
      ],
    })).rejects.toThrow();

    const completed = await service.runCleanup({ taskName: "cleanup", actorId: "admin", steps: [] });
    completed.status = "failed";
    expect(service.getRun("run-1")?.status).toBe("succeeded");
  });

  it("restores persisted runs in order and finalizes interrupted runs defensively", () => {
    const persistedRuns: MaintenanceRun[] = [
      {
        id: "run-completed",
        taskName: "expired-resources",
        actorId: "admin-1",
        status: "succeeded",
        startedAt: NOW - 200,
        finishedAt: NOW - 100,
        results: [{ target: "otp", status: "succeeded", removedCount: 2 }],
        totalRemoved: 2,
      },
      {
        id: "run-interrupted",
        taskName: "metrics-rollup",
        actorId: "admin-2",
        status: "running",
        startedAt: NOW - 50,
        finishedAt: null,
        results: [{ target: "sessions", status: "succeeded", removedCount: 1 }],
        totalRemoved: 1,
      },
    ];
    const service = new MaintenanceService({ now: () => NOW });

    service.restoreRuns(persistedRuns);

    expect(service.listRuns()).toEqual([
      persistedRuns[0],
      {
        ...persistedRuns[1],
        status: "failed",
        finishedAt: NOW,
      },
    ]);

    persistedRuns[0]!.results[0]!.removedCount = 999;
    const restored = service.listRuns();
    restored[1]!.results[0]!.removedCount = 888;

    expect(service.getRun("run-completed")?.results[0]?.removedCount).toBe(2);
    expect(service.getRun("run-interrupted")?.results[0]?.removedCount).toBe(1);
  });

  it("replaces existing history, keeps the newest bounded runs, and skips blank identities", async () => {
    const service = new MaintenanceService({
      now: () => NOW,
      createId: () => "in-memory-run",
      maxRuns: 3,
    });
    await service.runCleanup({ taskName: "before-restore", actorId: "admin", steps: [] });
    const persistedRuns: MaintenanceRun[] = [
      {
        id: "run-too-old",
        taskName: "cleanup",
        actorId: "admin",
        status: "succeeded",
        startedAt: 1,
        finishedAt: 2,
        results: [],
        totalRemoved: 0,
      },
      {
        id: "run-kept-1",
        taskName: "cleanup",
        actorId: "admin",
        status: "succeeded",
        startedAt: 3,
        finishedAt: 4,
        results: [],
        totalRemoved: 0,
      },
      {
        id: "   ",
        taskName: "cleanup",
        actorId: "admin",
        status: "failed",
        startedAt: 5,
        finishedAt: 6,
        results: [],
        totalRemoved: 0,
      },
      {
        id: "run-kept-2",
        taskName: "cleanup",
        actorId: "admin",
        status: "failed",
        startedAt: 7,
        finishedAt: 8,
        results: [],
        totalRemoved: 0,
      },
    ];

    service.restoreRuns(persistedRuns);

    expect(service.listRuns().map((run) => run.id)).toEqual(["run-kept-1", "run-kept-2"]);
    expect(service.getRun("in-memory-run")).toBeUndefined();
  });
});

describe("OperationsCenter", () => {
  it("builds a stable administrator maintenance summary", async () => {
    let sequence = 0;
    const center = new OperationsCenter({
      now: () => NOW,
      createRunId: () => `run-${++sequence}`,
    });
    center.health.register("api", () => ({ status: "healthy" }));
    center.health.register("database", () => ({ status: "degraded", detail: "连接池繁忙" }));
    center.metrics.record({ method: "GET", route: "/api/me", statusCode: 200, durationMs: 20 });
    center.metrics.record({ method: "POST", route: "/api/messages", statusCode: 500, durationMs: 80 });
    center.logger.error("request.failed", { route: "/api/messages", messageBody: "敏感消息" });
    await center.maintenance.runCleanup({
      taskName: "expired-resources",
      actorId: "admin-1",
      steps: [{ target: "sessions", cleanup: () => 3 }],
    });

    const summary = await center.getAdminSummary({ recentRunLimit: 5, recentErrorLimit: 5 });

    expect(summary).toMatchObject({
      generatedAt: NOW,
      health: { status: "degraded" },
      requests: { requestCount: 2, errorCount: 1, errorRate: 0.5 },
      maintenance: {
        runningCount: 0,
        succeededCount: 1,
        failedCount: 0,
        totalRemoved: 3,
      },
    });
    expect(summary.maintenance.recentRuns).toHaveLength(1);
    expect(summary.recentErrors).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain("敏感消息");

    summary.maintenance.recentRuns[0]!.status = "failed";
    expect((await center.getAdminSummary()).maintenance.recentRuns[0]!.status).toBe("succeeded");
  });
});
