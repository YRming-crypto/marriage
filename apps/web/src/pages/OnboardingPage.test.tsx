import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingPage } from "./OnboardingPage";

const AUTH_KEY = "ai-marriage-auth-user";
const DRAFT_KEY = "ai-marriage-onboarding-draft-v1";
const DRAFT_SESSION_KEY = "ai-marriage-onboarding-sensitive-draft-v1";
const LEGACY_STEP_KEY = "ai-marriage-onboarding-step";
const PROFILE_SESSION_KEY = "ai-marriage-auth-profile";

const completeProfile = {
  nickname: "林清",
  gender: "女性",
  birthYear: "1978",
  city: "上海",
  district: "静安",
  job: "教育",
  maritalStatus: "未婚",
  goal: "认真交往",
  introduction: "喜欢阅读和散步，希望认真认识彼此。",
};

const emptyPreferences = {
  preferredGender: "男性",
  relationshipGoal: "认真交往",
  minAge: "40",
  maxAge: "50",
  region: "同城优先",
  valuedQualities: "",
  dealBreakers: "",
};

const uploadedPhoto = { id: "photo-1", userId: "user-1", filename: "本人照片.jpg", url: "https://example.com/me.jpg", objectKey: "local/me", mimeType: "image/jpeg", sizeBytes: 1024, isPrimary: true, reviewStatus: "pending", reviewReason: null, createdAt: "2026-08-14T08:00:00Z", updatedAt: "2026-08-14T08:00:00Z" };

const relationshipQuestions = [
  "出现分歧时，你通常怎样处理？",
  "你平时更习惯怎样表达关心？",
  "当你需要独处时，会怎样告诉对方？",
  "你理想中的周末是什么样的？",
  "你的日常作息和生活节奏是怎样的？",
  "你希望两个人怎样分担家务？",
  "未来几年是否愿意为关系调整城市？",
  "你期待三到五年后的生活是什么样的？",
  "你希望两个人怎样商量储蓄和日常开支？",
  "你希望怎样与双方父母相处？",
  "你对是否要孩子或与子女相处有什么想法？",
  "节假日和重要家庭安排，你希望怎样协商？",
  "哪些行为是你明确不能接受的？",
  "你希望彼此保留哪些个人空间？",
  "你最希望对方先了解你的哪一面？",
] as const;

const completeAnswers = Object.fromEntries(
  relationshipQuestions.map((question, index) => [question, `完整回答 ${index + 1}`]),
);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setAuthUser() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ id: "user-1", phoneMasked: "138****8000" }));
}

function renderPage(entry = "/onboarding", props: Partial<ComponentProps<typeof OnboardingPage>> = {}) {
  return render(<MemoryRouter initialEntries={[entry]}><OnboardingPage {...props} /></MemoryRouter>);
}

describe("统一婚恋建档入口", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("未确认账号时列出完整建档流程但锁定后续步骤", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole("heading", { name: "建立婚恋档案" })).toBeVisible();
    expect(screen.getByText("当前步骤：账号确认")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "建档进度" })).toHaveAttribute("aria-valuemax", "6");
    expect(screen.getByRole("button", { name: /第 2 步：基本资料/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /第 5 步：关系问答/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /确认账号并继续/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /第 2 步：基本资料/ }));
    expect(screen.getByText("当前步骤：账号确认")).toBeVisible();
  });

  it("本地账号摘要失效时以服务端会话为准并返回账号确认", async () => {
    setAuthUser();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: { code: "AUTH_REQUIRED", message: "当前会话不可用。" } }, 401));

    renderPage();

    expect(await screen.findByText("当前步骤：账号确认")).toBeVisible();
    expect(screen.getByRole("button", { name: /第 2 步：基本资料/ })).toBeDisabled();
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("使用本地验证码确认账号，保存脱敏用户并解锁资料步骤", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "123456" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: { id: "user-1", phoneMasked: "138****8000" },
          profile: null,
        },
      }));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13800138000");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByText("本地演示验证码：123456，有效期 5 分钟。")).toBeVisible();
    expect(screen.getByRole("button", { name: "60 秒后重发" })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("button", { name: /确认账号并继续/ }));

    expect(await screen.findByRole("heading", { name: "介绍一下自己" })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null")).toEqual({
      id: "user-1",
      phoneMasked: "138****8000",
    });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null")).toMatchObject({
      version: 2,
      drafts: { "user-1": { currentStep: 1 } },
    });
    expect(screen.getByRole("button", { name: /第 2 步：基本资料/ })).not.toBeDisabled();
  });

  it("旧草稿缺少完整资料时安全回到基本资料", async () => {
    setAuthUser();
    localStorage.setItem(LEGACY_STEP_KEY, "3");

    renderPage();

    const restoreStatus = await screen.findByRole("status", { name: "草稿恢复状态" });
    expect(restoreStatus).toHaveTextContent("已恢复上次保存的进度：第 2 步“基本资料”");
    expect(screen.getByText("当前步骤：基本资料")).toBeVisible();
    expect(screen.getByRole("button", { name: /第 2 步：基本资料/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /第 4 步：交往期待/ })).toBeDisabled();
  });

  it("不会恢复其他账号保存的建档草稿", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      userId: "another-user",
      currentStep: 4,
      profileDraft: completeProfile,
    }));

    renderPage();

    expect(await screen.findByText("当前步骤：基本资料")).toBeVisible();
    expect(screen.queryByDisplayValue(completeProfile.nickname)).not.toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("已登录且没有草稿时直接进入基本资料", async () => {
    setAuthUser();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null },
    }));

    renderPage();

    expect(await screen.findByText("当前步骤：基本资料")).toBeVisible();
    expect(screen.getByRole("heading", { name: "介绍一下自己" })).toBeVisible();
  });

  it("每个账号可以分别恢复自己的草稿", async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 2,
      drafts: {
        "user-1": { currentStep: 1, profileDraft: completeProfile },
        "user-2": { currentStep: 1, profileDraft: { ...completeProfile, nickname: "周先生" } },
      },
    }));
    localStorage.setItem(AUTH_KEY, JSON.stringify({ id: "user-2", phoneMasked: "139****0000" }));

    renderPage();

    expect(await screen.findByRole("textbox", { name: "昵称" })).toHaveValue("周先生");
    expect(localStorage.getItem(DRAFT_KEY)).toContain(completeProfile.nickname);
  });

  it("重新登录已有账号时回填服务端资料", async () => {
    setAuthUser();
    sessionStorage.setItem(PROFILE_SESSION_KEY, JSON.stringify({
      userId: "user-1",
      profile: { ...completeProfile, birthYear: 1978 },
    }));

    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /第 2 步：基本资料/ }));

    expect(screen.getByRole("textbox", { name: "昵称" })).toHaveValue(completeProfile.nickname);
    expect(screen.getByRole("combobox", { name: "出生年份" })).toHaveValue("1978");
    expect(screen.getByRole("textbox", { name: "简单介绍自己" })).toHaveValue(completeProfile.introduction);
  });

  it("切换城市时会清空不再适用的区域选项，避免无效资料", async () => {
    setAuthUser();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /第 2 步：基本资料/ }));

    await user.selectOptions(screen.getByRole("combobox", { name: "所在区域" }), "徐汇");
    await user.selectOptions(screen.getByRole("combobox", { name: "所在城市" }), "杭州");

    expect(screen.getByRole("combobox", { name: "所在区域" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "所在区域" })).toHaveDisplayValue("请选择");
  });

  it("从服务端资料恢复非默认吸烟和子女情况", async () => {
    setAuthUser();
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/api/me")
      ? jsonResponse({
        data: {
          user: { id: "user-1", phoneMasked: "138****8000" },
          profile: {
            ...completeProfile,
            birthYear: 1978,
            preference: {
              ...emptyPreferences,
              selfSmokingStatus: "吸烟",
              selfChildrenStatus: "有子女",
            },
            answers: {},
          },
        },
      })
      : jsonResponse({ data: { items: [] } }));

    renderPage("/onboarding", {
      draftApi: { loadDraft: vi.fn().mockResolvedValue({ draft: null }), saveDraft: vi.fn() },
    });

    expect(await screen.findByRole("combobox", { name: "吸烟情况" })).toHaveValue("吸烟");
    expect(screen.getByRole("combobox", { name: "子女情况" })).toHaveValue("有子女");
  });

  it("在建档页登录已有账号时不会用空草稿覆盖服务端资料", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ data: { sent: true, expiresIn: 300, devCode: "123456" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: { id: "user-existing", phoneMasked: "139****8213" },
          profile: {
            ...completeProfile,
            birthYear: 1978,
            preference: { ...emptyPreferences, valuedQualities: "真诚" },
            answers: { "出现分歧时，你通常怎样处理？": "先冷静，再沟通。" },
          },
        },
      }));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole("textbox", { name: "手机号码" }), "13900008213");
    await user.click(screen.getByRole("checkbox", { name: /用户协议/ }));
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    await user.type(screen.getByRole("textbox", { name: "验证码" }), "123456");
    await user.click(screen.getByRole("button", { name: /确认账号并继续/ }));

    expect(await screen.findByRole("textbox", { name: "昵称" })).toHaveValue(completeProfile.nickname);
    const storedDrafts = localStorage.getItem(DRAFT_KEY) ?? "";
    expect(storedDrafts).toContain(completeProfile.nickname);
    expect(storedDrafts).not.toContain("出现分歧时，你通常怎样处理？");
  });

  it("保存并恢复版本化资料草稿且不保存手机号和验证码", async () => {
    setAuthUser();
    const user = userEvent.setup();
    const firstRender = renderPage();

    await user.type(screen.getByRole("textbox", { name: "昵称" }), completeProfile.nickname);
    await user.selectOptions(screen.getByRole("combobox", { name: "出生年份" }), completeProfile.birthYear);
    await user.selectOptions(screen.getByRole("combobox", { name: "所在区域" }), completeProfile.district);
    await user.type(screen.getByRole("textbox", { name: "职业大类" }), completeProfile.job);
    await user.type(screen.getByRole("textbox", { name: "简单介绍自己" }), completeProfile.introduction);
    await user.click(screen.getByRole("button", { name: "保存并稍后继续" }));

    const rawDraft = localStorage.getItem(DRAFT_KEY);
    expect(rawDraft).not.toBeNull();
    expect(JSON.parse(rawDraft ?? "{}")).toMatchObject({
      version: 2,
      drafts: {
        "user-1": {
          currentStep: 1,
          profileDraft: completeProfile,
        },
      },
    });
    expect(rawDraft).not.toMatch(/1[3-9]\d{9}/);
    expect(rawDraft).not.toContain("123456");

    firstRender.unmount();
    renderPage();

    expect(await screen.findByRole("status", { name: "草稿恢复状态" })).toHaveTextContent("第 2 步“基本资料”");
    expect(screen.getByRole("textbox", { name: "昵称" })).toHaveValue(completeProfile.nickname);
    expect(screen.getByRole("textbox", { name: "简单介绍自己" })).toHaveValue(completeProfile.introduction);
  });

  it("敏感交往条件与关系问答只保留在当前浏览器会话", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      userId: "user-1",
      currentStep: 4,
      profileDraft: completeProfile,
      preferencesDraft: { ...emptyPreferences, dealBreakers: "欺骗和长期冷处理" },
      answersDraft: { "出现分歧时，你通常怎样处理？": "先冷静，再沟通。" },
    }));

    renderPage();

    const durableDraft = localStorage.getItem(DRAFT_KEY) ?? "";
    const sensitiveDraft = sessionStorage.getItem(DRAFT_SESSION_KEY) ?? "";
    expect(durableDraft).not.toContain("欺骗和长期冷处理");
    expect(durableDraft).not.toContain("先冷静，再沟通。");
    expect(sensitiveDraft).toContain("欺骗和长期冷处理");
    expect(sensitiveDraft).toContain("先冷静，再沟通。");
  });

  it("版本化草稿损坏时安全回到账号确认页", () => {
    localStorage.setItem(DRAFT_KEY, "{not-valid-json");

    expect(() => renderPage()).not.toThrow();
    expect(screen.getByText("当前步骤：账号确认")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "手机号码" })).toHaveValue("");
  });

  it("基本资料缺失或出生年份非法时不能继续", async () => {
    setAuthUser();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /第 2 步：基本资料/ }));

    await user.click(screen.getByRole("button", { name: "保存并继续" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请完整填写昵称、出生年份、所在区域、职业大类和自我介绍。");
    expect(screen.getByText("当前步骤：基本资料")).toBeVisible();

    await user.type(screen.getByRole("textbox", { name: "昵称" }), completeProfile.nickname);
    await user.selectOptions(screen.getByRole("combobox", { name: "出生年份" }), "2020");
    await user.selectOptions(screen.getByRole("combobox", { name: "所在区域" }), completeProfile.district);
    await user.type(screen.getByRole("textbox", { name: "职业大类" }), completeProfile.job);
    await user.type(screen.getByRole("textbox", { name: "简单介绍自己" }), completeProfile.introduction);
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请输入合法的出生年份，用户需年满 18 周岁。");
    await user.selectOptions(screen.getByRole("combobox", { name: "出生年份" }), completeProfile.birthYear);
    await user.click(screen.getByRole("button", { name: "保存并继续" }));
    expect(screen.getByRole("heading", { name: "上传真实、清晰的照片" })).toBeVisible();
  });

  it("已有账号但资料未完成时不能通过步骤导航跳过资料", async () => {
    setAuthUser();
    renderPage();

    expect(screen.getByRole("button", { name: /第 2 步：基本资料/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /第 3 步：上传照片/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /第 5 步：关系问答/ })).toBeDisabled();
  });

  it("出生年份必须与后端保持一致且不能早于 1940 年", async () => {
    setAuthUser();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /第 2 步：基本资料/ }));

    await user.type(screen.getByRole("textbox", { name: "昵称" }), completeProfile.nickname);
    await user.selectOptions(screen.getByRole("combobox", { name: "出生年份" }), "1939");
    await user.selectOptions(screen.getByRole("combobox", { name: "所在区域" }), completeProfile.district);
    await user.type(screen.getByRole("textbox", { name: "职业大类" }), completeProfile.job);
    await user.type(screen.getByRole("textbox", { name: "简单介绍自己" }), completeProfile.introduction);
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请输入合法的出生年份，用户需年满 18 周岁。");
    expect(screen.getByText("当前步骤：基本资料")).toBeVisible();
  });

  it("完成建档后保存资料并清理草稿", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      userId: "user-1",
      currentStep: 4,
      profileDraft: completeProfile,
      answersDraft: completeAnswers,
    }));
    localStorage.setItem(LEGACY_STEP_KEY, "4");
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me") && method === "GET") return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } });
      if (url.endsWith("/api/me/photos") && method === "GET") return jsonResponse({ data: { items: [uploadedPhoto] } });
      if (url.endsWith("/api/me/profile") && method === "PATCH") return jsonResponse({ data: { profile: completeProfile } });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "保存并预览" }));
    await user.click(await screen.findByRole("button", { name: "确认提交档案" }));

    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(screen.getByRole("heading", { name: "婚恋档案已建立，可以开始寻找缘分" })).toBeVisible();
    expect(screen.getByRole("link", { name: "生成并启用 AI 分身" })).toHaveAttribute("href", "/me/avatar");
    expect(screen.getByRole("link", { name: "进入匹配大厅" })).toHaveAttribute("href", "/find");
    expect(localStorage.getItem(LEGACY_STEP_KEY)).toBeNull();
    expect(localStorage.getItem("ai-marriage-profile-saved")).toBe("true");
  });

  it("没有上传照片时不能进入最终确认", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: {
          profileDraft: completeProfile,
          preferencesDraft: emptyPreferences,
          answersDraft: completeAnswers,
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me/photos")) return jsonResponse({ data: { items: [] } });
      return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } });
    });
    const user = userEvent.setup();

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });
    await user.click(await screen.findByRole("button", { name: "保存并预览" }));

    expect(await screen.findByRole("heading", { name: "上传真实、清晰的照片" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("请至少上传 1 张照片，再进入最终确认。");
    expect(screen.queryByRole("heading", { name: "提交前确认" })).not.toBeInTheDocument();
  });

  it("有照片和问答时先预览完整档案再确认提交", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: {
          profileDraft: completeProfile,
          preferencesDraft: { ...emptyPreferences, valuedQualities: "真诚、有责任心" },
          answersDraft: completeAnswers,
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me/photos")) return jsonResponse({ data: { items: [{ id: "photo-1", filename: "本人照片.jpg", url: "https://example.com/me.jpg", isPrimary: true, reviewStatus: "pending" }] } });
      if (url.endsWith("/api/me/profile") && method === "PATCH") return jsonResponse({ data: { profile: completeProfile } });
      return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } });
    });
    const user = userEvent.setup();

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });
    await user.click(await screen.findByRole("button", { name: "保存并预览" }));

    expect(await screen.findByRole("heading", { name: "提交前确认" })).toBeVisible();
    expect(screen.getByText("林清")).toBeVisible();
    expect(screen.getByText("真诚、有责任心")).toBeVisible();
    expect(screen.getByText("已回答 15 道关系问答")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认提交档案" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me/profile"))).toBe(true));
    expect(screen.getByRole("heading", { name: "婚恋档案已建立，可以开始寻找缘分" })).toBeVisible();
  });

  it("登录页返回参数指向建档时仍将完成目标设为 AI 分身页", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: { profileDraft: completeProfile, preferencesDraft: emptyPreferences, answersDraft: completeAnswers },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/api/me/photos")
      ? jsonResponse({ data: { items: [uploadedPhoto] } })
      : jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } }));
    const user = userEvent.setup();

    renderPage("/onboarding?next=%2Fonboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    await user.click(await screen.findByRole("button", { name: "保存并预览" }));
    await user.click(await screen.findByRole("button", { name: "确认提交档案" }));
    expect(await screen.findByRole("link", { name: "生成并启用 AI 分身" })).toHaveAttribute("href", "/me/avatar");
  });

  it("从心仪对象进入时保存资料并把审核后的心仪操作交给服务端恢复", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      userId: "user-1",
      currentStep: 4,
      profileDraft: completeProfile,
      answersDraft: completeAnswers,
    }));
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me") && method === "GET") return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } });
      if (url.endsWith("/api/me/photos") && method === "GET") return jsonResponse({ data: { items: [uploadedPhoto] } });
      if (url.endsWith("/api/me/profile") && method === "PATCH") return jsonResponse({ data: { profile: completeProfile } });
      if (url.endsWith("/api/me/pending-interest") && method === "POST") return jsonResponse({ data: { intent: { memberId: "lin-wanqing", status: "pending" } } }, 202);
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const user = userEvent.setup();
    renderPage("/onboarding?intent=favorite&member=lin-wanqing&next=%2Fmember%2Flin-wanqing");
    expect(screen.getByText(/保留你的“感兴趣”选择/)).toBeVisible();

    await user.click(await screen.findByRole("button", { name: "保存并预览" }));
    await user.click(await screen.findByRole("button", { name: "确认提交档案" }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me/pending-interest"))).toBe(true));
    const pendingRequest = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/api/me/pending-interest"))?.[1];
    expect(JSON.parse(String(pendingRequest?.body))).toEqual({ memberId: "lin-wanqing" });
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/members/lin-wanqing/interest"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me/profile"))).toBe(true);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.getByRole("heading", { name: "婚恋档案已建立，可以开始寻找缘分" })).toBeVisible();
    expect(screen.getByRole("link", { name: "生成并启用 AI 分身" })).toHaveAttribute(
      "href",
      "/me/avatar?pendingInterest=lin-wanqing&next=%2Fmember%2Flin-wanqing",
    );
    expect(screen.getByRole("link", { name: "进入匹配大厅" })).toHaveAttribute("href", "/find");
  });

  it("完成建档时提交交往期待和关系问答而不是静默丢弃", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      userId: "user-1",
      currentStep: 3,
      profileDraft: completeProfile,
      preferencesDraft: {
        preferredGender: "男性",
        relationshipGoal: "认真交往",
        minAge: "40",
        maxAge: "50",
        region: "同城优先",
        valuedQualities: "真诚、有责任心",
        dealBreakers: "欺骗",
      },
      answersDraft: Object.fromEntries(relationshipQuestions.slice(1).map((question, index) => [question, `完整回答 ${index + 2}`])),
    }));
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me") && method === "GET") return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } });
      if (url.endsWith("/api/me/photos") && method === "GET") return jsonResponse({ data: { items: [uploadedPhoto] } });
      if (url.endsWith("/api/me/profile") && method === "PATCH") return jsonResponse({ data: { profile: completeProfile } });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "保存并继续" }));
    await user.type(screen.getByRole("textbox", { name: "出现分歧时，你通常怎样处理？" }), "先冷静，再把事情说清楚。 ");
    await user.click(screen.getByRole("button", { name: "保存并预览" }));
    await user.click(await screen.findByRole("button", { name: "确认提交档案" }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me/profile"))).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/api/me/profile"))?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ smokingStatus: "不吸烟", childrenStatus: "无子女" });
    expect(body.preference).toMatchObject({ valuedQualities: "真诚、有责任心", dealBreakers: "欺骗" });
    expect(body.answers).toMatchObject({ "出现分歧时，你通常怎样处理？": "先冷静，再把事情说清楚。 " });
  });

  it("关系问答按沟通、生活、未来、家庭、边界五组展示完整 15 题", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: { profileDraft: completeProfile, preferencesDraft: emptyPreferences, answersDraft: {} },
      },
    });

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    expect(await screen.findByRole("heading", { name: "关系与生活问答" })).toBeVisible();
    expect(screen.getByText("5 个主题，共 15 个问题。可以分组完成，真实回答没有标准答案。")).toBeVisible();
    for (const group of ["沟通", "生活", "未来", "家庭", "边界"]) {
      expect(screen.getByRole("group", { name: new RegExp(group) })).toBeVisible();
    }
    expect(screen.getAllByRole("textbox")).toHaveLength(15);
  });

  it("关系问答明确显示全部必填要求和实时回答进度", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: { profileDraft: completeProfile, preferencesDraft: emptyPreferences, answersDraft: {} },
      },
    });
    const user = userEvent.setup();

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    expect(await screen.findByText("全部 15 题（提交档案前必填）")).toBeVisible();
    const progress = screen.getByRole("progressbar", { name: "AI 问答进度" });
    expect(progress).toHaveAttribute("aria-valuemax", "15");
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("已回答 0/15 题")).toBeVisible();

    await user.type(screen.getByRole("textbox", { name: "出现分歧时，你通常怎样处理？" }), "先听完对方的想法。");
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("已回答 1/15 题")).toBeVisible();
  });

  it("旧版或未知问题的答案不能绕过当前问答必填校验", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: {
          profileDraft: completeProfile,
          preferencesDraft: emptyPreferences,
          answersDraft: { "旧版问题：你喜欢什么颜色？": "蓝色" },
        },
      },
    });
    const user = userEvent.setup();

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    const progress = await screen.findByRole("progressbar", { name: "AI 问答进度" });
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("已回答 0/15 题")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存并预览" }));
    expect(screen.getByRole("alert")).toHaveTextContent("关系问答还差 15 题，请完成全部 15 题后再提交档案。");
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me/profile"))).toBe(false);
  });

  it("未知问题键不会让当前 15 题的进度超过上限", async () => {
    setAuthUser();
    const unknownAnswers = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`legacy-question-${index}`, "旧答案"]),
    );
    const currentAnswers = Object.fromEntries([
      "出现分歧时，你通常怎样处理？",
      "你平时更习惯怎样表达关心？",
      "当你需要独处时，会怎样告诉对方？",
      "你理想中的周末是什么样的？",
      "你的日常作息和生活节奏是怎样的？",
      "你希望两个人怎样分担家务？",
      "未来几年是否愿意为关系调整城市？",
      "你期待三到五年后的生活是什么样的？",
      "你希望两个人怎样商量储蓄和日常开支？",
      "你希望怎样与双方父母相处？",
      "你对是否要孩子或与子女相处有什么想法？",
      "节假日和重要家庭安排，你希望怎样协商？",
      "哪些行为是你明确不能接受的？",
      "你希望彼此保留哪些个人空间？",
      "你最希望对方先了解你的哪一面？",
    ].map((question, index) => [question, `当前答案 ${index + 1}`]));
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: {
          profileDraft: completeProfile,
          preferencesDraft: emptyPreferences,
          answersDraft: { ...unknownAnswers, ...currentAnswers },
        },
      },
    });

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    const progress = await screen.findByRole("progressbar", { name: "AI 问答进度" });
    expect(progress).toHaveAttribute("aria-valuenow", "15");
    expect(screen.getByText("已回答 15/15 题")).toBeVisible();
  });

  it("关系问答未完成时明确剩余题数并定位到问答步骤，同时仍可保存草稿", async () => {
    setAuthUser();
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 4,
        status: "in_progress",
        data: {
          profileDraft: completeProfile,
          preferencesDraft: emptyPreferences,
          answersDraft: { "出现分歧时，你通常怎样处理？": "先冷静沟通。" },
        },
      },
    });
    const user = userEvent.setup();
    const saveDraft = vi.fn().mockResolvedValue(undefined);

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft } });
    await screen.findByRole("heading", { name: "关系与生活问答" });
    await user.click(screen.getByRole("button", { name: "保存并稍后继续" }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ currentStep: 4 })));
    await user.click(await screen.findByRole("button", { name: "保存并预览" }));

    expect(screen.getByRole("alert")).toHaveTextContent("关系问答还差 14 题，请完成全部 15 题后再提交档案。");
    expect(screen.getByText("当前步骤：关系问答")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me/profile"))).toBe(false);
  });

  it("补充问答入口在资料完整时直接打开关系问答", async () => {
    setAuthUser();
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/api/me/photos")
      ? jsonResponse({ data: { items: [uploadedPhoto] } })
      : jsonResponse({ data: {
        user: { id: "user-1", phoneMasked: "138****8000" },
        profile: { ...completeProfile, birthYear: 1978, preference: emptyPreferences, answers: completeAnswers },
      } }));
    const loadDraft = vi.fn().mockResolvedValue({ draft: null });

    renderPage("/onboarding?step=questions&next=%2Fme%2Favatar", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    expect(await screen.findByRole("heading", { name: "关系与生活问答" })).toBeVisible();
    expect(screen.getByText("当前步骤：关系问答")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "保存并预览" }));
    expect(await screen.findByRole("button", { name: "确认提交档案" })).toBeVisible();
  });

  it("审核恢复入口在资料完整时直接打开照片审核步骤", async () => {
    setAuthUser();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me/photos")) return jsonResponse({ data: { items: [] } });
      return jsonResponse({
        data: {
          user: { id: "user-1", phoneMasked: "138****8000" },
          profile: { ...completeProfile, birthYear: 1978, preference: emptyPreferences, answers: {} },
        },
      });
    });
    const loadDraft = vi.fn().mockResolvedValue({ draft: null });

    renderPage("/onboarding?step=photos&next=%2Fmatchmaking", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    expect(await screen.findByRole("heading", { name: "上传真实、清晰的照片" })).toBeVisible();
    expect(screen.getByText("当前步骤：上传照片")).toBeVisible();
  });

  it("优先恢复服务端草稿并覆盖当前账号的浏览器兜底", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 2,
      drafts: { "user-1": { currentStep: 1, profileDraft: { ...completeProfile, nickname: "浏览器昵称" } } },
    }));
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 1,
        status: "in_progress",
        data: {
          profileDraft: { ...completeProfile, nickname: "服务端昵称" },
          preferencesDraft: { ...emptyPreferences, valuedQualities: "坦诚" },
          answersDraft: { "出现分歧时，你通常怎样处理？": "先听完对方的想法。" },
        },
      },
    });

    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: vi.fn() } });

    expect(await screen.findByRole("textbox", { name: "昵称" })).toHaveValue("服务端昵称");
    expect(screen.getByRole("status", { name: "草稿同步状态" })).toHaveTextContent("已从云端恢复建档草稿");
    expect(localStorage.getItem(DRAFT_KEY)).toContain("服务端昵称");
    expect(loadDraft).toHaveBeenCalledTimes(1);
  });

  it("字段变更后节流保存到服务端并同步保留浏览器兜底", async () => {
    setAuthUser();
    const saveServerDraft = vi.fn().mockResolvedValue(undefined);
    const loadDraft = vi.fn().mockResolvedValue({
      draft: {
        currentStep: 1,
        status: "in_progress",
        data: { profileDraft: completeProfile, preferencesDraft: emptyPreferences, answersDraft: {} },
      },
    });
    renderPage("/onboarding", { draftApi: { loadDraft, saveDraft: saveServerDraft } });
    const nickname = await screen.findByRole("textbox", { name: "昵称" });

    fireEvent.change(nickname, { target: { value: "林清云端" } });
    expect(saveServerDraft).not.toHaveBeenCalled();

    await waitFor(() => expect(saveServerDraft).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(saveServerDraft).toHaveBeenCalledWith(expect.objectContaining({
      currentStep: 1,
      data: expect.objectContaining({ profileDraft: expect.objectContaining({ nickname: "林清云端" }) }),
    }));
    expect(localStorage.getItem(DRAFT_KEY)).toContain("林清云端");
  });

  it("云端草稿不可用时明确提示并继续使用浏览器草稿", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 2,
      drafts: { "user-1": { currentStep: 1, profileDraft: completeProfile } },
    }));
    const saveServerDraft = vi.fn().mockRejectedValue(new Error("网络中断"));
    renderPage("/onboarding", {
      draftApi: {
        loadDraft: vi.fn().mockRejectedValue(new Error("网络中断")),
        saveDraft: saveServerDraft,
      },
    });

    const nickname = await screen.findByRole("textbox", { name: "昵称" });
    expect(nickname).toHaveValue(completeProfile.nickname);
    expect(screen.getByRole("status", { name: "草稿同步状态" })).toHaveTextContent("云端草稿暂时不可用，已继续使用本浏览器草稿");

    fireEvent.change(nickname, { target: { value: "林清本地" } });
    await waitFor(() => expect(saveServerDraft).toHaveBeenCalled());
    expect(screen.getByRole("status", { name: "草稿同步状态" })).toHaveTextContent("云端保存失败，内容已安全保留在本浏览器");
    expect(localStorage.getItem(DRAFT_KEY)).toContain("林清本地");
  });

  it("选择照片后上传并显示待审核状态", async () => {
    setAuthUser();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      userId: "user-1",
      currentStep: 3,
      profileDraft: completeProfile,
    }));

    const portraitPhoto = { id: "photo-1", userId: "user-1", filename: "portrait.png", url: "data:image/png;base64,AAAA", objectKey: "local/photo", mimeType: "image/png", sizeBytes: 4, isPrimary: true, reviewStatus: "pending", reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" };
    let persistedPhotos: typeof portraitPhoto[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me") && method === "GET") return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: null } });
      if (url.endsWith("/api/me/photos") && method === "GET") return jsonResponse({ data: { items: persistedPhotos } });
      if (url.endsWith("/api/me/photos") && method === "POST") {
        persistedPhotos = [portraitPhoto];
        return jsonResponse({ data: { photo: portraitPhoto } }, 201);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /第 3 步：上传照片/ }));
    const file = new File([new Uint8Array([1, 2, 3, 4])], "portrait.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("选择照片"), file);
    expect(await screen.findByText("等待审核")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4184/api/me/photos", expect.objectContaining({ method: "POST" }));

    await user.click(screen.getByRole("button", { name: "保存并继续" }));
    expect(screen.getByRole("button", { name: /第 3 步：上传照片，已完成/ })).toBeVisible();
  });

  it("设置主照片时只锁定当前操作并阻止重复提交", async () => {
    setAuthUser();
    let resolvePrimary!: (response: Response) => void;
    const primaryResponse = new Promise<Response>((resolve) => { resolvePrimary = resolve; });
    let primaryRequests = 0;
    const photos = [
      { id: "photo-main", userId: "user-1", filename: "头像.png", url: "data:image/png;base64,AAAA", objectKey: "local/main", mimeType: "image/png", sizeBytes: 4, isPrimary: true, reviewStatus: "approved", reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
      { id: "photo-life", userId: "user-1", filename: "生活照.png", url: "data:image/png;base64,BBBB", objectKey: "local/life", mimeType: "image/png", sizeBytes: 4, isPrimary: false, reviewStatus: "approved", reviewReason: null, createdAt: "2026-08-13T10:01:00Z", updatedAt: "2026-08-13T10:01:00Z" },
    ];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me") && method === "GET") return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: { ...completeProfile, birthYear: 1978, preference: emptyPreferences, answers: {} } } });
      if (url.endsWith("/api/me/photos") && method === "GET") return jsonResponse({ data: { items: photos } });
      if (url.endsWith("/api/me/photos/photo-life/primary") && method === "POST") {
        primaryRequests += 1;
        return primaryResponse;
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const user = userEvent.setup();
    renderPage("/onboarding?step=photos", { draftApi: { loadDraft: vi.fn().mockResolvedValue({ draft: null }), saveDraft: vi.fn() } });

    const primaryButton = await screen.findByRole("button", { name: "设为主照片：生活照.png" });
    await user.dblClick(primaryButton);

    expect(primaryRequests).toBe(1);
    expect(primaryButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除照片：头像.png" })).toBeEnabled();

    resolvePrimary(jsonResponse({ data: { photo: { ...photos[1], isPrimary: true } } }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "设为主照片：生活照.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("已将生活照.png设为主照片");
  });

  it("删除照片需要确认，失败显示原因并可重试成功", async () => {
    setAuthUser();
    const confirmDelete = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    let deleteRequests = 0;
    const photos = [
      { id: "photo-main", userId: "user-1", filename: "头像.png", url: "data:image/png;base64,AAAA", objectKey: "local/main", mimeType: "image/png", sizeBytes: 4, isPrimary: true, reviewStatus: "approved", reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
      { id: "photo-life", userId: "user-1", filename: "生活照.png", url: "data:image/png;base64,BBBB", objectKey: "local/life", mimeType: "image/png", sizeBytes: 4, isPrimary: false, reviewStatus: "approved", reviewReason: null, createdAt: "2026-08-13T10:01:00Z", updatedAt: "2026-08-13T10:01:00Z" },
    ];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me") && method === "GET") return jsonResponse({ data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: { ...completeProfile, birthYear: 1978, preference: emptyPreferences, answers: {} } } });
      if (url.endsWith("/api/me/photos") && method === "GET") return jsonResponse({ data: { items: photos } });
      if (url.endsWith("/api/me/photos/photo-main") && method === "DELETE") {
        deleteRequests += 1;
        return deleteRequests === 1
          ? jsonResponse({ error: { code: "PHOTO_DELETE_FAILED", message: "照片存储暂时不可用，请稍后重试。" } }, 502)
          : new Response(null, { status: 204 });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const user = userEvent.setup();
    renderPage("/onboarding?step=photos", { draftApi: { loadDraft: vi.fn().mockResolvedValue({ draft: null }), saveDraft: vi.fn() } });

    const deleteButton = await screen.findByRole("button", { name: "删除照片：头像.png" });
    await user.click(deleteButton);
    expect(deleteRequests).toBe(0);

    await user.click(deleteButton);
    expect(await screen.findByRole("status")).toHaveTextContent("照片存储暂时不可用，请稍后重试。");
    expect(deleteButton).toBeEnabled();

    await user.click(deleteButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "删除照片：头像.png" })).not.toBeInTheDocument());
    expect(screen.getByText("主照片")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("已删除头像.png");
    expect(confirmDelete).toHaveBeenCalledTimes(3);
  });
});
