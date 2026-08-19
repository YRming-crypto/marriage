import type { LogContext } from "./types.js";

const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";

const sensitiveKeyPatterns = [
  /phone/i,
  /mobile/i,
  /authorization/i,
  /cookie/i,
  /password/i,
  /secret/i,
  /token/i,
  /(?:otp|verification|verify|sms).*code/i,
  /code.*(?:otp|verification|verify|sms)/i,
  /message.*(?:body|content|text)/i,
  /(?:body|content|text).*message/i,
];

function isSensitiveKey(key: string, parentKey?: string) {
  if (sensitiveKeyPatterns.some((pattern) => pattern.test(key))) {
    return true;
  }
  return parentKey !== undefined && (
    (/message/i.test(parentKey) && /^(?:body|content|text)$/i.test(key))
    || (/(?:otp|verification|verify|sms)/i.test(parentKey) && /^code$/i.test(key))
  );
}

export function redactText(value: string) {
  return value
    .replace(/\b1[3-9]\d{9}\b/g, REDACTED)
    .replace(
      /((?:验证码|动态码|otp|verification\s*code)\s*[:=：]?\s*)\d{4,8}/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /((?:access[_ -]?token|refresh[_ -]?token|token|authorization)\s*[:=：]\s*)(?:bearer\s+)?[^\s,;，；]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/(bearer\s+)[A-Za-z0-9._~-]+/gi, `$1${REDACTED}`);
}

function redactValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
  parentKey?: string,
): unknown {
  if (key && isSensitiveKey(key, parentKey)) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);

  if (value instanceof Error) {
    const safeError: LogContext = {
      name: value.name,
      message: redactText(value.message),
    };
    for (const [errorKey, errorValue] of Object.entries(value)) {
      safeError[errorKey] = redactValue(errorValue, errorKey, seen, key);
    }
    return safeError;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, undefined, seen, key));
  }

  const result: LogContext = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    result[nestedKey] = redactValue(nestedValue, nestedKey, seen, key);
  }
  return result;
}

export function redactContext(context: LogContext): LogContext {
  return redactValue(context, undefined, new WeakSet()) as LogContext;
}

export function cloneSanitized<T>(value: T): T {
  return redactValue(value, undefined, new WeakSet()) as T;
}
