import "@testing-library/jest-dom/vitest";
import type { Member } from "@ai-marriage/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberCard } from "./MemberCard";
import { MemberInterestProvider } from "../features/interests/MemberInterestContext";

const member: Member = {
  id: "member-lin",
  userId: "user-lin",
  nickname: "林婉清",
  gender: "女性",
  age: 45,
  city: "上海",
  district: "徐汇",
  job: "教育",
  maritalStatus: "离异",
  goal: "认真交往",
  tags: ["阅读"],
  introduction: "愿意认真了解。",
  photoUrl: "/lin.jpg",
  activeLabel: "今天活跃",
  verified: true,
};

function LocationView() {
  return <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>;
}

function renderCard() {
  return render(<MemoryRouter initialEntries={["/find?city=上海"]}><MemberInterestProvider><MemberCard member={member} /></MemberInterestProvider><LocationView /></MemoryRouter>);
}

describe("会员卡片心仪操作", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("已登录会员直接调用真实心仪接口并显示成功状态", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/me/interests")) return new Response(JSON.stringify({ data: { sent: [], received: [], mutual: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ data: { interest: { id: "interest-1", memberId: member.id } } }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "对林婉清感兴趣" }));

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4184/api/members/member-lin/interest",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(await screen.findByRole("button", { name: "取消对林婉清感兴趣" })).toHaveAttribute("aria-pressed", "true");
  });

  it("未登录或未建档时保留心仪意图并进入统一建档流程", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({
      error: { code: "AUTH_REQUIRED", message: "请先登录。" },
    }), { status: 401, headers: { "Content-Type": "application/json" } }));
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "对林婉清感兴趣" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/onboarding?"));
    expect(screen.getByTestId("location")).toHaveTextContent("intent=favorite");
    expect(screen.getByTestId("location")).toHaveTextContent("member=member-lin");
  });

  it("接口异常时留在当前页面并给出可重试提示", async () => {
    let postCount = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/me/interests")) return new Response(JSON.stringify({ data: { sent: [], received: [], mutual: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      postCount += 1;
      if (postCount === 1) return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "服务暂时繁忙" } }), { status: 500, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ data: { interest: { id: "interest-1", memberId: member.id } } }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "对林婉清感兴趣" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂时繁忙");
    expect(screen.getByTestId("location")).toHaveTextContent("/find?city=上海");
    expect(screen.getByRole("button", { name: "对林婉清感兴趣" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "对林婉清感兴趣" }));
    expect(await screen.findByRole("button", { name: "取消对林婉清感兴趣" })).toHaveAttribute("aria-pressed", "true");
  });

  it("从服务端恢复已保存的心仪状态", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      data: { sent: [{ id: "interest-1", userId: "user-me", memberId: member.id, status: "active", member }], received: [], mutual: [] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    renderCard();

    expect(await screen.findByRole("button", { name: "取消对林婉清感兴趣" })).toHaveAttribute("aria-pressed", "true");
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4184/api/me/interests",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("同一会员的多张卡片共享状态并支持取消心仪", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me/interests")) return new Response(JSON.stringify({ data: { sent: [], received: [], mutual: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (method === "POST") return new Response(JSON.stringify({ data: { interest: { id: "interest-1", memberId: member.id } } }), { status: 201, headers: { "Content-Type": "application/json" } });
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><MemberInterestProvider><MemberCard member={member} /><MemberCard member={member} /></MemberInterestProvider></MemoryRouter>);

    const addButtons = screen.getAllByRole("button", { name: "对林婉清感兴趣" });
    await user.click(addButtons[0]);
    expect(await screen.findAllByRole("button", { name: "取消对林婉清感兴趣" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "取消对林婉清感兴趣" })[1]);
    expect(await screen.findAllByRole("button", { name: "对林婉清感兴趣" })).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("会员 ID 在资料路径和建档参数中按路径段安全编码", () => {
    const specialMember = { ...member, id: "member/lin ?#" };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { sent: [], received: [], mutual: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }));

    render(<MemoryRouter><MemberInterestProvider><MemberCard member={specialMember} /></MemberInterestProvider></MemoryRouter>);

    expect(screen.getByRole("link", { name: "查看 林婉清 的资料" })).toHaveAttribute("href", "/member/member%2Flin%20%3F%23");
    expect(screen.getByRole("link", { name: "查看资料" })).toHaveAttribute("href", "/member/member%2Flin%20%3F%23");
  });

  it("离开卡片后迟到的认证错误不会覆盖用户的新位置", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/find"]}>
        <Routes>
          <Route path="/find" element={<MemberInterestProvider><MemberCard member={member} /><Link to="/member/member-lin">立即查看资料</Link></MemberInterestProvider>} />
          <Route path="/member/:memberId" element={<LocationView />} />
          <Route path="/onboarding" element={<LocationView />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "对林婉清感兴趣" }));
    await user.click(screen.getByRole("link", { name: "立即查看资料" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/member/member-lin");

    resolveRequest?.(new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "请先登录。" } }), { status: 401, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/member/member-lin"));
  });
});
