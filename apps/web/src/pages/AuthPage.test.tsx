import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPage } from "./ContentPages";

const AUTH_KEY = "ai-marriage-auth-user";
const completeProfile = {
  nickname: "林清",
  gender: "女性",
  city: "上海",
  district: "静安",
  job: "教育",
  maritalStatus: "未婚",
  goal: "认真交往",
  introduction: "喜欢阅读和散步，希望认真认识彼此。",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function OnboardingLocation() {
  const location = useLocation();
  return <><h1>建立婚恋档案</h1><output aria-label="建档返回地址">{location.pathname}{location.search}</output></>;
}

function renderAuthPage(entry = "/auth") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/onboarding" element={<OnboardingLocation />} />
        <Route path="/messages" element={<h1>联系申请与真人消息</h1>} />
        <Route path="/me/security" element={<h1>账号与安全</h1>} />
        <Route path="/admin/review" element={<h1>审核与安全后台</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("手机号登录注册", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("未同意协议时不发送验证码", async () => {
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(screen.getByRole("status")).toHaveTextContent("请先阅读并同意用户协议和隐私政策。");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒绝格式不正确的手机号", async () => {
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "12345");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(screen.getByRole("status")).toHaveTextContent("请输入正确的11位手机号。");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("展示本地验证码并进入重发倒计时", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: { sent: true, expiresIn: 300, devCode: "123456" },
    }));
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByText("本地演示验证码：123456，有效期 5 分钟。")).toBeVisible();
    expect(screen.getByRole("button", { name: "60 秒后重发" })).toBeDisabled();
  });

  it("验证成功后保存脱敏账号并进入建档页", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        user: { id: "user-1", phoneMasked: "138****8000" },
        profile: null,
      },
    }));
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByRole("heading", { name: "建立婚恋档案" })).toBeVisible();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null")).toEqual({
      id: "user-1",
      phoneMasked: "138****8000",
    }));
  });

  it("新账号登录后原样恢复心仪对象的完整建档意图", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        user: { id: "user-1", phoneMasked: "138****8000" },
        profile: null,
      },
    }));
    const user = userEvent.setup();
    const onboardingTarget = "/onboarding?next=%2Fmember%2Fmember-lin&source=%2Ffind&intent=favorite&member=member-lin";
    renderAuthPage(`/auth?next=${encodeURIComponent(onboardingTarget)}`);

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByLabelText("建档返回地址")).toHaveTextContent(onboardingTarget);
  });

  it("管理员停用账号验证成功后进入账号安全页申诉", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        user: { id: "user-1", phoneMasked: "138****8000", status: "suspended" },
        profile: null,
      },
    }));
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByRole("heading", { name: "账号与安全" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "建立婚恋档案" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null")).toEqual({
      id: "user-1",
      phoneMasked: "138****8000",
      status: "suspended",
    });
  });

  it("已有服务端资料时直接返回登录前页面且不混入账号摘要", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        user: { id: "user-1", phoneMasked: "138****8000" },
        profile: { ...completeProfile, birthYear: 1978 },
      },
    }));
    const user = userEvent.setup();
    renderAuthPage("/auth?next=%2Fmessages");

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByRole("heading", { name: "联系申请与真人消息" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "建立婚恋档案" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null")).toEqual({
      id: "user-1",
      phoneMasked: "138****8000",
    });
    expect(sessionStorage.getItem("ai-marriage-auth-profile")).toBeNull();
  });

  it("管理员首次登录时无需建立婚恋档案即可进入后台", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        user: { id: "admin-1", phoneMasked: "139****9999", role: "admin", status: "active" },
        profile: null,
      },
    }));
    const user = userEvent.setup();
    renderAuthPage("/auth?next=%2Fadmin%2Freview");

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13900139999");
    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByRole("heading", { name: "审核与安全后台" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "建立婚恋档案" })).not.toBeInTheDocument();
  });
});
