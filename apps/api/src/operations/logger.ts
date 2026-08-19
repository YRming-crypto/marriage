import { cloneSanitized, redactContext } from "./redaction.js";
import type { LogContext, LogLevel, LogQuery, StructuredLogEntry } from "./types.js";

export interface StructuredLoggerOptions {
  now?: () => number;
  maxEntries?: number;
}
export class StructuredLogger {
  private readonly entries: StructuredLogEntry[] = [];
  private readonly now: () => number;
  private readonly maxEntries: number;
  private nextId = 1;

  constructor(options: StructuredLoggerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 1000;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new TypeError("maxEntries 必须是正整数");
    }
  }

  debug(event: string, context: LogContext = {}) {
    return this.write("debug", event, context);
  }

  info(event: string, context: LogContext = {}) {
    return this.write("info", event, context);
  }

  warn(event: string, context: LogContext = {}) {
    return this.write("warn", event, context);
  }

  error(event: string, context: LogContext = {}) {
    return this.write("error", event, context);
  }

  list(query: LogQuery = {}) {
    validateLimit(query.limit);
    const matching = this.entries.filter((entry) => (
      (query.level === undefined || entry.level === query.level)
      && (query.event === undefined || entry.event === query.event)
    ));
    const limited = query.limit === undefined ? matching : matching.slice(-query.limit);
    return cloneSanitized(limited);
  }

  clear() {
    const removedCount = this.entries.length;
    this.entries.length = 0;
    return removedCount;
  }

  private write(level: LogLevel, event: string, context: LogContext) {
    const normalizedEvent = event.trim();
    if (!normalizedEvent) {
      throw new TypeError("日志事件名不能为空");
    }
    const entry: StructuredLogEntry = {
      id: this.nextId++,
      level,
      event: normalizedEvent,
      occurredAt: this.now(),
      context: redactContext(context),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return cloneSanitized(entry);
  }
}

function validateLimit(limit: number | undefined) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new TypeError("limit 必须是正整数");
  }
}
