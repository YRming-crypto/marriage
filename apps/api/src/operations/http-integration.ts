import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OperationsCenter } from "./operations-center.js";

export function registerOperationsHooks(app: FastifyInstance, operations: OperationsCenter) {
  const startedAt = new WeakMap<FastifyRequest, bigint>();

  app.addHook("onRequest", async (request) => {
    startedAt.set(request, process.hrtime.bigint());
  });

  app.addHook("onError", async (request, reply, cause) => {
    operations.logger.error("request.failed", {
      requestId: request.id,
      method: request.method,
      route: requestRoute(request),
      statusCode: errorStatusCode(cause, reply.statusCode),
      error: cause,
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = startedAt.get(request);
    const durationMs = start === undefined
      ? reply.elapsedTime
      : Number(process.hrtime.bigint() - start) / 1_000_000;
    startedAt.delete(request);
    operations.metrics.record({
      method: request.method,
      route: requestRoute(request),
      statusCode: reply.statusCode,
      durationMs: Math.max(0, durationMs),
    });
  });
}

function requestRoute(request: FastifyRequest) {
  const configuredRoute = request.routeOptions.url;
  return configuredRoute || request.url.split("?", 1)[0] || "/";
}

function errorStatusCode(cause: Error, replyStatusCode: number) {
  const statusCode = (cause as Error & { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) return statusCode;
  return replyStatusCode >= 400 ? replyStatusCode : 500;
}
