import { afterEach, describe, expect, it, vi } from "vitest";
import { StableCursorError, paginateByStableId } from "./pagination.js";

const CURSOR_SECRET = "pagination-test-secret-with-at-least-32-characters";

const items = [
  { id: "member-a", score: 91 },
  { id: "member-b", score: 84 },
  { id: "member-c", score: 79 },
  { id: "member-d", score: 73 },
];

describe("stable cursor pagination", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns consecutive pages without duplicates", () => {
    const first = paginateByStableId(items, { pageSize: 2, secret: CURSOR_SECRET, scope: "recommendations:default", sortKey: (item) => [-item.score] });
    const second = paginateByStableId(items, { pageSize: 2, secret: CURSOR_SECRET, cursor: first.nextCursor, scope: "recommendations:default", sortKey: (item) => [-item.score] });

    expect(first.items.map((item) => item.id)).toEqual(["member-a", "member-b"]);
    expect(first.nextCursor).toBeTypeOf("string");
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(["member-c", "member-d"]);
    expect(second.nextCursor).toBeNull();
    expect(second.hasMore).toBe(false);
  });

  it("continues from the ordering tuple when the previous item was deleted", () => {
    expect(() => paginateByStableId(items, { pageSize: 2, secret: CURSOR_SECRET, cursor: "not-a-cursor" }))
      .toThrow(StableCursorError);

    const first = paginateByStableId(items, { pageSize: 2, secret: CURSOR_SECRET, scope: "score", sortKey: (item) => [-item.score] });
    const afterDeletion = items.filter((item) => item.id !== "member-b");
    const second = paginateByStableId(afterDeletion, { pageSize: 2, secret: CURSOR_SECRET, cursor: first.nextCursor, scope: "score", sortKey: (item) => [-item.score] });
    expect(second.items.map((item) => item.id)).toEqual(["member-c", "member-d"]);
  });

  it("keeps the first-page result order when sort values change between pages", () => {
    const first = paginateByStableId(items, {
      pageSize: 1,
      secret: CURSOR_SECRET,
      scope: "score-changing",
      sortKey: (item) => [-item.score],
    });
    const changed = items
      .map((item) => item.id === "member-a"
        ? { ...item, score: 1 }
        : item.id === "member-d"
          ? { ...item, score: 99 }
          : item)
      .concat({ id: "member-new", score: 50 })
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

    const second = paginateByStableId(changed, {
      pageSize: 1,
      secret: CURSOR_SECRET,
      cursor: first.nextCursor,
      scope: "score-changing",
      sortKey: (item) => [-item.score],
    });
    const third = paginateByStableId(changed, {
      pageSize: 1,
      secret: CURSOR_SECRET,
      cursor: second.nextCursor,
      scope: "score-changing",
      sortKey: (item) => [-item.score],
    });
    const fourth = paginateByStableId(changed, {
      pageSize: 1,
      secret: CURSOR_SECRET,
      cursor: third.nextCursor,
      scope: "score-changing",
      sortKey: (item) => [-item.score],
    });

    expect([
      ...first.items,
      ...second.items,
      ...third.items,
      ...fourth.items,
    ].map((item) => item.id)).toEqual(["member-a", "member-b", "member-c", "member-d"]);
    expect(fourth.nextCursor).toBeNull();
    expect(fourth.hasMore).toBe(false);
  });

  it("continues after the pagination module is independently reloaded", async () => {
    const first = paginateByStableId(items, {
      pageSize: 2,
      secret: CURSOR_SECRET,
      scope: "cross-process",
      sortKey: (item) => [-item.score],
    });

    vi.resetModules();
    const independentlyLoaded = await import("./pagination.js");
    const second = independentlyLoaded.paginateByStableId(items.map((item) => ({ ...item })), {
      pageSize: 2,
      secret: CURSOR_SECRET,
      cursor: first.nextCursor,
      scope: "cross-process",
      sortKey: (item) => [-item.score],
    });

    expect(second.items.map((item) => item.id)).toEqual(["member-c", "member-d"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a cursor signed with a different secret", () => {
    const first = paginateByStableId(items, {
      pageSize: 2,
      secret: CURSOR_SECRET,
      scope: "secret-bound",
      sortKey: (item) => [-item.score],
    });

    expect(() => paginateByStableId(items, {
      pageSize: 2,
      secret: "a-different-pagination-secret-with-32-characters",
      cursor: first.nextCursor,
      scope: "secret-bound",
      sortKey: (item) => [-item.score],
    })).toThrowError("cursor signature is invalid");
  });

  it("rejects a cursor after its 30 minute lifetime", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T10:00:00.000Z"));
    const first = paginateByStableId(items, {
      pageSize: 2,
      secret: CURSOR_SECRET,
      scope: "expiring",
      sortKey: (item) => [-item.score],
    });

    vi.advanceTimersByTime(30 * 60 * 1_000 + 1);
    expect(() => paginateByStableId(items, {
      pageSize: 2,
      secret: CURSOR_SECRET,
      cursor: first.nextCursor,
      scope: "expiring",
      sortKey: (item) => [-item.score],
    })).toThrowError("cursor has expired");
  });

  it("rejects a cursor reused with a different query scope", () => {
    const first = paginateByStableId(items, { pageSize: 2, secret: CURSOR_SECRET, scope: "gender=female", sortKey: (item) => [-item.score] });
    expect(() => paginateByStableId(items, { pageSize: 2, secret: CURSOR_SECRET, cursor: first.nextCursor, scope: "gender=male", sortKey: (item) => [-item.score] }))
      .toThrowError("cursor does not belong to this query");
  });

  it("validates page size and duplicate identifiers", () => {
    expect(() => paginateByStableId(items, { pageSize: 0, secret: CURSOR_SECRET })).toThrow(StableCursorError);
    expect(() => paginateByStableId(items, { pageSize: 51, secret: CURSOR_SECRET })).toThrow(StableCursorError);
    expect(() => paginateByStableId([items[0]!, items[0]!], { pageSize: 2, secret: CURSOR_SECRET }))
      .toThrowError("item identifiers must be unique");
  });
});
