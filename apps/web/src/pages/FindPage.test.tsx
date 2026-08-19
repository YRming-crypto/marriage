import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindPage } from "./FindPage";

const members = [
  { id: "member-1", userId: "user-1", nickname: "林婉清", gender: "女性", age: 45, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: ["阅读"], introduction: "愿意认真了解。", photoUrl: "/images/member-lin-v2.jpg", activeLabel: "今天活跃", verified: true, smokingStatus: "不吸烟", childrenStatus: "无子女", lastActiveAt: "2026-08-10T10:00:00Z", joinedAt: "2026-01-10T10:00:00Z" },
  { id: "member-2", userId: "user-2", nickname: "苏敏", gender: "女性", age: 41, city: "杭州", district: "西湖", job: "财务", maritalStatus: "未婚", goal: "以结婚为目标", tags: ["散步"], introduction: "期待稳定关系。", photoUrl: "/images/member-su.jpg", activeLabel: "昨天活跃", verified: true, smokingStatus: "偶尔吸烟", childrenStatus: "有子女", lastActiveAt: "2026-08-12T10:00:00Z", joinedAt: "2026-08-14T10:00:00Z" },
  { id: "member-3", userId: "user-3", nickname: "许宁", gender: "女性", age: 52, city: "南京", district: "鼓楼", job: "医疗", maritalStatus: "丧偶", goal: "先认识了解", tags: ["园艺"], introduction: "希望慢慢了解。", photoUrl: "/images/member-xu.jpg", activeLabel: "刚刚在线", verified: true, smokingStatus: "不吸烟", childrenStatus: "有子女", lastActiveAt: "2026-08-14T10:00:00Z", joinedAt: "2026-06-10T10:00:00Z" },
];

function stubMembers(items: Array<Record<string, unknown>>) {
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.includes("/api/members")) {
      return new Response(JSON.stringify({ data: { sent: [], received: [], mutual: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const value = url.searchParams;
    const filtered = items.filter((item) => {
      const stringValue = (key: string) => typeof item[key] === "string" ? item[key] : "";
      const minAge = Number(value.get("minAge") ?? 0);
      const maxAge = Number(value.get("maxAge") ?? 120);
      if (value.get("gender") && stringValue("gender") !== value.get("gender")) return false;
      if (Number(item.age) < minAge || Number(item.age) > maxAge) return false;
      if (value.get("city") && stringValue("city") !== value.get("city")) return false;
      if (value.get("maritalStatus") && stringValue("maritalStatus") !== value.get("maritalStatus")) return false;
      if (value.get("goal") && stringValue("goal") !== value.get("goal")) return false;
      if (value.get("smokingStatus") && stringValue("smokingStatus") !== value.get("smokingStatus")) return false;
      if (value.get("childrenStatus") && stringValue("childrenStatus") !== value.get("childrenStatus")) return false;
      return value.get("onlyWithPhoto") !== "true" || Boolean(stringValue("photoUrl").trim());
    });
    const sort = value.get("sort");
    const sorted = [...filtered].sort((left, right) => {
      if (sort === "age-asc") return Number(left.age) - Number(right.age);
      if (sort === "age-desc") return Number(right.age) - Number(left.age);
      if (sort === "recent-active") return Date.parse(String(right.lastActiveAt ?? "")) - Date.parse(String(left.lastActiveAt ?? ""));
      if (sort === "newest") return Date.parse(String(right.joinedAt ?? "")) - Date.parse(String(left.joinedAt ?? ""));
      return 0;
    });
    const pageSize = Number(value.get("pageSize") ?? 12);
    const start = Number(value.get("cursor") ?? 0);
    const pageItems = sorted.slice(start, start + pageSize);
    const next = start + pageItems.length;
    const data = { items: pageItems, total: sorted.length, pageSize, hasMore: next < sorted.length, nextCursor: next < sorted.length ? String(next) : null };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  stubMembers(members);
});

describe("匹配大厅", () => {
  it("可以按城市筛选且明确显示已选条件数", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FindPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "匹配大厅" })).toBeVisible();
    await user.selectOptions(screen.getByLabelText("所在城市"), "上海");
    await user.click(screen.getByRole("button", { name: /应用筛选/ }));
    expect(screen.getByText(/已选 1 项/)).toBeVisible();
    const resultCount = (await screen.findAllByText((_, element) => element?.textContent?.match(/找到 \d+ 位会员/) !== null))
      .find((element) => element.tagName === "STRONG");
    expect(resultCount).toBeVisible();
  });

  it("接口失败时显示重试入口且不展示静态会员", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<MemoryRouter><FindPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("匹配大厅暂时无法加载");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeVisible();
    expect(screen.queryByText("林婉清")).not.toBeInTheDocument();
  });

  it("支持按年龄、最近活跃和最新加入切换稳定顺序", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FindPage /></MemoryRouter>);

    await screen.findByText("林婉清，45 岁");
    const sort = screen.getByLabelText("排序方式");
    expect(within(sort).getAllByRole("option").map((option) => option.textContent)).toEqual(["默认顺序", "最近活跃", "最新加入", "年龄从小到大", "年龄从大到小"]);

    const names = () => screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(names()).toEqual(["林婉清，45 岁", "苏敏，41 岁", "许宁，52 岁"]);

    await user.selectOptions(sort, "age-asc");
    expect(names()).toEqual(["苏敏，41 岁", "林婉清，45 岁", "许宁，52 岁"]);

    await user.selectOptions(sort, "age-desc");
    expect(names()).toEqual(["许宁，52 岁", "林婉清，45 岁", "苏敏，41 岁"]);

    await user.selectOptions(sort, "recent-active");
    expect(names()).toEqual(["许宁，52 岁", "苏敏，41 岁", "林婉清，45 岁"]);

    await user.selectOptions(sort, "newest");
    expect(names()).toEqual(["苏敏，41 岁", "许宁，52 岁", "林婉清，45 岁"]);
  });

  it("可以筛选仅看有照片、吸烟情况和子女情况", async () => {
    const user = userEvent.setup();
    stubMembers([
      ...members,
      { ...members[0], id: "member-4", userId: "user-4", nickname: "周岚", photoUrl: "  ", smokingStatus: "不吸烟", childrenStatus: "无子女" },
    ]);
    render(<MemoryRouter><FindPage /></MemoryRouter>);
    await screen.findByText("周岚，45 岁");

    await user.click(screen.getByRole("checkbox", { name: "仅看有照片" }));
    await user.selectOptions(screen.getByLabelText("吸烟情况"), "不吸烟");
    await user.selectOptions(screen.getByLabelText("子女情况"), "无子女");
    await user.click(screen.getByRole("button", { name: /应用筛选/ }));

    expect(screen.getByText("林婉清，45 岁")).toBeVisible();
    expect(screen.queryByText("苏敏，41 岁")).not.toBeInTheDocument();
    expect(screen.queryByText("许宁，52 岁")).not.toBeInTheDocument();
    expect(screen.queryByText("周岚，45 岁")).not.toBeInTheDocument();
    expect(screen.getByText(/已选 3 项/)).toBeVisible();
  });

  it("扩展字段缺失时不报错，筛选会排除未知资料且排序保持稳定", async () => {
    const user = userEvent.setup();
    const legacyMembers = members.map(({ smokingStatus: _smoking, childrenStatus: _children, lastActiveAt: _active, joinedAt: _joined, ...member }) => member);
    stubMembers(legacyMembers);
    render(<MemoryRouter><FindPage /></MemoryRouter>);
    await screen.findByText("林婉清，45 岁");

    await user.selectOptions(screen.getByLabelText("吸烟情况"), "不吸烟");
    await user.click(screen.getByRole("button", { name: /应用筛选/ }));
    expect(screen.getByRole("heading", { name: "暂时没有符合全部条件的人" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /重置/ }));

    await user.selectOptions(screen.getByLabelText("排序方式"), "newest");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["林婉清，45 岁", "苏敏，41 岁", "许宁，52 岁"]);

    await user.selectOptions(screen.getByLabelText("排序方式"), "recent-active");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["林婉清，45 岁", "苏敏，41 岁", "许宁，52 岁"]);
  });

  it("首屏显示六位会员并可继续加载剩余结果", async () => {
    const user = userEvent.setup();
    const manyMembers = Array.from({ length: 8 }, (_, index) => ({
      ...members[index % members.length],
      id: `many-${index + 1}`,
      userId: `many-user-${index + 1}`,
      nickname: `会员${index + 1}`,
    }));
    stubMembers(manyMembers);
    render(<MemoryRouter><FindPage /></MemoryRouter>);

    expect(await screen.findAllByRole("article", { name: /会员 会员/ })).toHaveLength(6);
    expect(screen.getByText("已显示 6 / 8 位")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更多（还剩 2 位）" }));
    expect(screen.getAllByRole("article", { name: /会员 会员/ })).toHaveLength(8);
    expect(screen.getByText("已显示全部 8 位会员")).toBeVisible();
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument();
    const requestedUrls = vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input))).filter((url) => url.pathname === "/api/members");
    expect(requestedUrls[0]?.searchParams.get("pageSize")).toBe("6");
    expect(requestedUrls[1]?.searchParams.get("cursor")).toBe("6");
  });
});
