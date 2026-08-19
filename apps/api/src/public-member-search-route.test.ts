import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("公开会员服务端搜索", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createApp() {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    return { app, store };
  }

  it("在服务端筛选并使用稳定游标连续翻页", async () => {
    const { app } = createApp();
    const first = await app.inject({
      method: "GET",
      url: "/api/members?gender=%E5%A5%B3%E6%80%A7&minAge=40&maxAge=50&pageSize=1&sort=age-asc",
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data.items).toHaveLength(1);
    expect(first.json().data.items[0]).toMatchObject({ gender: "女性", age: 42 });
    expect(first.json().data).toMatchObject({ total: 2, hasMore: true, nextCursor: expect.any(String) });

    const second = await app.inject({
      method: "GET",
      url: `/api/members?gender=%E5%A5%B3%E6%80%A7&minAge=40&maxAge=50&pageSize=1&sort=age-asc&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data.items).toHaveLength(1);
    expect(second.json().data.items[0]).toMatchObject({ gender: "女性", age: 45 });
    expect(second.json().data).toMatchObject({ total: 2, hasMore: false, nextCursor: null });
  });

  it("翻页期间年龄排序值变化时仍按首屏结果集顺序返回且不重复遗漏", async () => {
    const { app, store } = createApp();
    const first = await app.inject({
      method: "GET",
      url: "/api/members?gender=%E5%A5%B3%E6%80%A7&pageSize=1&sort=age-asc",
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data.items[0]).toMatchObject({ id: "chen-jiayi", age: 42 });
    store.members.get("chen-jiayi")!.age = 55;
    store.members.get("lin-wanqing")!.age = 41;

    const second = await app.inject({
      method: "GET",
      url: `/api/members?gender=%E5%A5%B3%E6%80%A7&pageSize=1&sort=age-asc&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data.items.map((item: { id: string }) => item.id)).toEqual(["lin-wanqing"]);
    expect(second.json().data).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("拒绝非法公开筛选和游标", async () => {
    const { app } = createApp();
    const invalidRange = await app.inject({ method: "GET", url: "/api/members?minAge=60&maxAge=40" });
    const invalidCursor = await app.inject({ method: "GET", url: "/api/members?cursor=not-a-cursor" });

    expect(invalidRange.statusCode).toBe(400);
    expect(invalidRange.json()).toMatchObject({ error: { code: "INVALID_MEMBER_SEARCH" } });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toMatchObject({ error: { code: "INVALID_CURSOR" } });
  });

  it("拒绝把一个筛选结果的游标用于另一组筛选条件", async () => {
    const { app } = createApp();
    const first = await app.inject({ method: "GET", url: "/api/members?gender=%E5%A5%B3%E6%80%A7&pageSize=1&sort=age-asc" });
    const reused = await app.inject({
      method: "GET",
      url: `/api/members?gender=%E7%94%B7%E6%80%A7&pageSize=1&sort=age-asc&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
    });

    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ error: { code: "INVALID_CURSOR" } });
  });
});
