import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Member } from "@ai-marriage/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getMembers } from "./client";
import { useMembers } from "./useMembers";

vi.mock("./client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message);
      this.name = "ApiError";
    }
  },
  getMembers: vi.fn(),
}));

const member = (id: string, nickname: string): Member & { lobbyStatus: "verified" } => ({
  id,
  userId: `user-${id}`,
  lobbyStatus: "verified",
  nickname,
  gender: "女性",
  age: 46,
  city: "杭州",
  district: "西湖",
  job: "教育工作者",
  maritalStatus: "离异",
  goal: "认真交往",
  tags: ["阅读"],
  introduction: "期待真诚、稳定的关系。",
  photoUrl: `https://example.com/${id}.jpg`,
  activeLabel: "今日活跃",
  verified: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useMembers 分页请求隔离", () => {
  beforeEach(() => vi.mocked(getMembers).mockReset());
  afterEach(cleanup);

  it("查询变化后忽略旧查询尚未完成的加载更多结果", async () => {
    const oldPage = deferred<Awaited<ReturnType<typeof getMembers>>>();
    const firstMember = member("first", "首屏会员");
    const staleMember = member("stale", "旧分页会员");
    const newMember = member("new", "新查询会员");
    vi.mocked(getMembers)
      .mockResolvedValueOnce({ items: [firstMember], total: 2, pageSize: 1, nextCursor: "old-next", hasMore: true })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ items: [newMember], total: 1, pageSize: 1, nextCursor: null, hasMore: false });

    const { result, rerender } = renderHook(({ city }) => useMembers({ city }), {
      initialProps: { city: "杭州" },
    });
    await waitFor(() => expect(result.current.members).toEqual([firstMember]));

    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    rerender({ city: "上海" });
    await waitFor(() => expect(result.current.members).toEqual([newMember]));

    await act(async () => {
      oldPage.resolve({ items: [staleMember], total: 2, pageSize: 1, nextCursor: "stale-next", hasMore: true });
      await oldPage.promise;
    });

    expect(result.current.members).toEqual([newMember]);
    expect(result.current.total).toBe(1);
    expect(result.current.hasMore).toBe(false);
  });

  it("同步连续调用加载更多时只发送一个分页请求", async () => {
    const pendingPage = deferred<Awaited<ReturnType<typeof getMembers>>>();
    vi.mocked(getMembers)
      .mockResolvedValueOnce({ items: [member("first", "首屏会员")], total: 2, pageSize: 1, nextCursor: "next", hasMore: true })
      .mockReturnValue(pendingPage.promise);
    const { result } = renderHook(() => useMembers({ city: "杭州" }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });

    expect(getMembers).toHaveBeenCalledTimes(2);
    await act(async () => {
      pendingPage.resolve({ items: [], total: 2, pageSize: 1, nextCursor: null, hasMore: false });
      await pendingPage.promise;
    });
  });

  it("分页游标失效时自动重新获取当前查询首屏并替换旧列表", async () => {
    const oldMember = member("old", "旧首屏会员");
    const refreshedMember = member("refreshed", "刷新后会员");
    vi.mocked(getMembers)
      .mockResolvedValueOnce({ items: [oldMember], total: 2, pageSize: 1, nextCursor: "expired", hasMore: true })
      .mockRejectedValueOnce(new ApiError("分页游标已失效。", "INVALID_CURSOR", 400))
      .mockResolvedValueOnce({ items: [refreshedMember], total: 1, pageSize: 1, nextCursor: null, hasMore: false });
    const { result } = renderHook(() => useMembers({ city: "杭州" }));
    await waitFor(() => expect(result.current.members).toEqual([oldMember]));

    act(() => { void result.current.loadMore(); });

    await waitFor(() => expect(result.current.members).toEqual([refreshedMember]));
    expect(getMembers).toHaveBeenCalledTimes(3);
    expect(getMembers).toHaveBeenLastCalledWith({ city: "杭州" });
    expect(result.current.total).toBe(1);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.error).toBe("");
  });
});
