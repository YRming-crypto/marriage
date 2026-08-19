import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CURSOR_PREFIX = "v3.";
const MAX_PAGE_SIZE = 50;
export const MAX_STABLE_CURSOR_LENGTH = 65_536;
const MAX_DECOMPRESSED_CURSOR_BYTES = 2 * 1024 * 1024;
const MAX_SCOPE_LENGTH = 512;
const MIN_SECRET_LENGTH = 16;
const CURSOR_TTL_MS = 30 * 60 * 1_000;
const SIGNATURE_DOMAIN = "stable-page-cursor-v3\0";
const SCOPE_DOMAIN = "stable-page-scope-v3\0";

type StableCursorValue = string | number;
type EncodedCursor = readonly [
  version: 3,
  expiresAt: number,
  scopeDigest: string,
  position: number,
  orderedIds: string[],
];

export class StableCursorError extends Error {
  readonly code = "INVALID_CURSOR";

  constructor(message: string) {
    super(message);
    this.name = "StableCursorError";
  }
}

export interface StablePageOptions<T> {
  pageSize: number;
  secret: string;
  cursor?: string | null;
  scope?: string;
  sortKey?: (item: T) => readonly StableCursorValue[];
}

export interface StablePage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function paginateByStableId<T extends { id: string }>(
  items: readonly T[],
  options: StablePageOptions<T>,
): StablePage<T> {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > MAX_PAGE_SIZE) {
    throw new StableCursorError(`page size must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  validateSecret(options.secret);

  const scope = options.scope ?? "stable-id";
  if (!scope || scope.length > MAX_SCOPE_LENGTH) throw new StableCursorError("cursor scope is invalid");
  const entries = validateEntries(items, options.sortKey);

  if (!options.cursor) return createFirstPage(entries, options.pageSize, scope, options.secret);

  const decoded = decodeCursor(options.cursor, options.secret);
  const [, expiresAt, encodedScope, initialPosition, orderedIds] = decoded;
  if (!secureEqual(encodedScope, digestScope(scope, options.secret))) {
    throw new StableCursorError("cursor does not belong to this query");
  }
  if (expiresAt <= Date.now()) throw new StableCursorError("cursor has expired");

  const itemsById = new Map(entries.map((entry) => [entry.item.id, entry.item]));
  const pageItems: T[] = [];
  let position = initialPosition;
  while (position < orderedIds.length && pageItems.length < options.pageSize) {
    const item = itemsById.get(orderedIds[position]!);
    position += 1;
    if (item) pageItems.push(item);
  }

  const hasMore = orderedIds.slice(position).some((id) => itemsById.has(id));
  return {
    items: pageItems,
    nextCursor: hasMore
      ? encodeCursor([3, expiresAt, encodedScope, position, orderedIds], options.secret)
      : null,
    hasMore,
  };
}

function validateEntries<T extends { id: string }>(
  items: readonly T[],
  sortKey: StablePageOptions<T>["sortKey"],
) {
  const identifiers = new Set<string>();
  const entries = items.map((item) => {
    if (typeof item.id !== "string" || !item.id.trim() || identifiers.has(item.id)) {
      throw new StableCursorError("item identifiers must be unique non-empty strings");
    }
    identifiers.add(item.id);
    const rank = sortKey?.(item) ?? [];
    if (!Array.isArray(rank) || rank.some((value) => !validCursorValue(value))) {
      throw new StableCursorError("item ordering keys must contain finite numbers or strings");
    }
    return { item, key: [...rank, item.id] };
  });

  for (let index = 1; index < entries.length; index += 1) {
    if (compareKeys(entries[index - 1]!.key, entries[index]!.key) >= 0) {
      throw new StableCursorError("items must use a deterministic ascending ordering key");
    }
  }
  return entries;
}

function createFirstPage<T extends { id: string }>(
  entries: ReadonlyArray<{ item: T; key: StableCursorValue[] }>,
  pageSize: number,
  scope: string,
  secret: string,
): StablePage<T> {
  const pageEntries = entries.slice(0, pageSize);
  const hasMore = pageEntries.length < entries.length;
  if (!hasMore) return { items: pageEntries.map((entry) => entry.item), nextCursor: null, hasMore: false };

  const cursor = encodeCursor([
    3,
    Date.now() + CURSOR_TTL_MS,
    digestScope(scope, secret),
    pageEntries.length,
    entries.map((entry) => entry.item.id),
  ], secret);
  return {
    items: pageEntries.map((entry) => entry.item),
    nextCursor: cursor,
    hasMore: true,
  };
}

function validCursorValue(value: unknown): value is StableCursorValue {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function sameKeyShape(left: readonly StableCursorValue[], right: readonly StableCursorValue[]) {
  return left.length === right.length && left.every((value, index) => typeof value === typeof right[index]);
}

function compareKeys(left: readonly StableCursorValue[], right: readonly StableCursorValue[]) {
  if (!sameKeyShape(left, right)) throw new StableCursorError("item ordering keys are incompatible");
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (leftValue === rightValue) continue;
    return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function encodeCursor(value: EncodedCursor, secret: string) {
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 });
  const payload = compressed.toString("base64url");
  const cursor = `${CURSOR_PREFIX}${payload}.${sign(payload, secret)}`;
  if (cursor.length > MAX_STABLE_CURSOR_LENGTH) {
    throw new StableCursorError("result set is too large for stable pagination");
  }
  return cursor;
}

function decodeCursor(cursor: string, secret: string): EncodedCursor {
  if (typeof cursor !== "string" || cursor.length > MAX_STABLE_CURSOR_LENGTH || !cursor.startsWith(CURSOR_PREFIX)) {
    throw new StableCursorError("cursor is malformed");
  }
  const [payload, signature, ...remainder] = cursor.slice(CURSOR_PREFIX.length).split(".");
  if (!payload || !signature || remainder.length > 0 || !base64Url(payload) || !base64Url(signature)) {
    throw new StableCursorError("cursor is malformed");
  }
  if (!secureEqual(signature, sign(payload, secret))) throw new StableCursorError("cursor signature is invalid");

  try {
    const compressed = Buffer.from(payload, "base64url");
    if (compressed.toString("base64url") !== payload) throw new StableCursorError("cursor is malformed");
    const decodedText = inflateRawSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_CURSOR_BYTES }).toString("utf8");
    const decoded = JSON.parse(decodedText) as unknown;
    if (!validDecodedCursor(decoded)) throw new StableCursorError("cursor is malformed");
    return decoded;
  } catch (cause) {
    if (cause instanceof StableCursorError) throw cause;
    throw new StableCursorError("cursor is malformed");
  }
}

function validDecodedCursor(value: unknown): value is EncodedCursor {
  if (!Array.isArray(value) || value.length !== 5) return false;
  const [version, expiresAt, scopeDigest, position, orderedIds] = value;
  if (version !== 3 || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
    || typeof scopeDigest !== "string" || scopeDigest.length !== 43 || !base64Url(scopeDigest)
    || !Number.isSafeInteger(position) || position < 1
    || !Array.isArray(orderedIds) || position > orderedIds.length) {
    return false;
  }
  const identifiers = new Set<string>();
  return orderedIds.every((id) => {
    if (typeof id !== "string" || !id.trim() || identifiers.has(id)) return false;
    identifiers.add(id);
    return true;
  });
}

function validateSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new StableCursorError(`cursor secret must contain at least ${MIN_SECRET_LENGTH} characters`);
  }
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(SIGNATURE_DOMAIN).update(payload).digest("base64url");
}

function digestScope(scope: string, secret: string) {
  return createHmac("sha256", secret).update(SCOPE_DOMAIN).update(scope).digest("base64url");
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
