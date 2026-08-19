import type {
  LatencySummary,
  RequestMetricSample,
  RequestMetricsSnapshot,
  RouteMetricsSnapshot,
} from "./types.js";

interface MetricBucket {
  requestCount: number;
  errorCount: number;
  latencies: number[];
}
export class RequestMetrics {
  private readonly total: MetricBucket = createBucket();
  private readonly routes = new Map<string, MetricBucket>();

  record(sample: RequestMetricSample) {
    const normalized = validateSample(sample);
    recordInBucket(this.total, normalized);
    const key = `${normalized.method} ${normalized.route}`;
    const bucket = this.routes.get(key) ?? createBucket();
    recordInBucket(bucket, normalized);
    this.routes.set(key, bucket);
  }

  snapshot(): RequestMetricsSnapshot {
    const routes: RouteMetricsSnapshot[] = [...this.routes.entries()]
      .map(([key, bucket]) => {
        const separator = key.indexOf(" ");
        return {
          method: key.slice(0, separator),
          route: key.slice(separator + 1),
          requestCount: bucket.requestCount,
          errorCount: bucket.errorCount,
          errorRate: rate(bucket.errorCount, bucket.requestCount),
          latencyMs: summarizeLatency(bucket.latencies),
        };
      })
      .sort((left, right) => (
        right.requestCount - left.requestCount
        || left.method.localeCompare(right.method)
        || left.route.localeCompare(right.route)
      ));

    return {
      requestCount: this.total.requestCount,
      errorCount: this.total.errorCount,
      errorRate: rate(this.total.errorCount, this.total.requestCount),
      latencyMs: summarizeLatency(this.total.latencies),
      routes,
    };
  }

  reset() {
    const previous = this.snapshot();
    this.total.requestCount = 0;
    this.total.errorCount = 0;
    this.total.latencies.length = 0;
    this.routes.clear();
    return previous;
  }
}

function createBucket(): MetricBucket {
  return { requestCount: 0, errorCount: 0, latencies: [] };
}

function validateSample(sample: RequestMetricSample): RequestMetricSample {
  const method = sample.method.trim().toUpperCase();
  const route = sample.route.trim();
  if (!method || !route) {
    throw new TypeError("method 和 route 不能为空");
  }
  if (!Number.isInteger(sample.statusCode) || sample.statusCode < 100 || sample.statusCode > 599) {
    throw new TypeError("statusCode 必须是有效 HTTP 状态码");
  }
  if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
    throw new TypeError("durationMs 必须是非负有限数");
  }
  return { ...sample, method, route };
}

function recordInBucket(bucket: MetricBucket, sample: RequestMetricSample) {
  bucket.requestCount += 1;
  if (sample.statusCode >= 400) {
    bucket.errorCount += 1;
  }
  bucket.latencies.push(sample.durationMs);
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function summarizeLatency(values: number[]): LatencySummary {
  if (values.length === 0) {
    return { min: 0, max: 0, average: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: sorted[0]!,
    max: sorted.at(-1)!,
    average: round(sum / sorted.length),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], fraction: number) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
