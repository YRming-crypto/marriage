import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarProfilePage } from "./AvatarProfilePage";

const headers = { "Content-Type": "application/json" };
const avatarProfile = {
  userId: "user-1",
  version: 1,
  approvedFacts: [{ topic: "周末", fact: "喜欢阅读和散步。" }],
  relationshipExpectations: ["认真交往", "以结婚为目标"],
  boundaries: ["不公开手机号和详细地址"],
  unknownResponse: "这个问题没有得到本人明确授权。",
  status: "pending",
  generatedAt: "2026-08-13T10:00:00.000Z",
  enabledAt: null,
};

type GovernanceStatus = "allowed" | "sensitive" | "prohibited";

interface KnowledgeFixture {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  topic: string;
  keywords: string[];
  status: GovernanceStatus;
  moderationReason: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

interface VersionFixture {
  id: string;
  ownerId: string;
  versionNumber: number;
  status: "draft" | "active" | "stale" | "archived";
  note: string | null;
  items: Array<{
    id: string;
    title: string;
    content: string;
    topic: string;
    keywords: string[];
    governanceStatus: "allowed" | "sensitive";
    authorized: boolean;
    sourceRevision: number;
  }>;
  createdAt: number;
  activatedAt: number | null;
}

const allowedItem: KnowledgeFixture = {
  id: "knowledge-1",
  ownerId: "user-1",
  title: "周末安排",
  content: "周末喜欢散步和阅读。",
  topic: "生活习惯",
  keywords: ["周末", "阅读"],
  status: "allowed",
  moderationReason: null,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};

const sensitiveItem: KnowledgeFixture = {
  ...allowedItem,
  id: "knowledge-2",
  title: "家庭情况",
  content: "愿意在熟悉后介绍家庭情况。",
  topic: "家庭",
  keywords: ["家庭"],
  status: "sensitive",
  moderationReason: "属于个人生活细节",
};

const prohibitedItem: KnowledgeFixture = {
  ...allowedItem,
  id: "knowledge-3",
  title: "联系方式",
  content: "不允许 AI 提供联系方式。",
  topic: "隐私",
  keywords: ["手机"],
  status: "prohibited",
  moderationReason: "禁止公开联系方式",
};

const archivedVersion: VersionFixture = {
  id: "version-1",
  ownerId: "user-1",
  versionNumber: 1,
  status: "archived",
  note: "最初版本",
  items: [{
    id: allowedItem.id,
    title: allowedItem.title,
    content: allowedItem.content,
    topic: allowedItem.topic,
    keywords: allowedItem.keywords,
    governanceStatus: "allowed",
    authorized: true,
    sourceRevision: 1,
  }],
  createdAt: 1,
  activatedAt: 2,
};

const staleVersion: VersionFixture = {
  ...archivedVersion,
  id: "version-2",
  versionNumber: 2,
  status: "stale",
  note: "当前对外版本",
  createdAt: 3,
  activatedAt: 4,
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers });
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

describe("本人 AI 分身授权与知识管理", () => {
  let knowledgeItems: KnowledgeFixture[];
  let versions: VersionFixture[];
  let currentVersion: VersionFixture | null;

  beforeEach(() => {
    knowledgeItems = [allowedItem, sensitiveItem, prohibitedItem].map((item) => ({ ...item, keywords: [...item.keywords] }));
    versions = [staleVersion, archivedVersion].map((version) => ({ ...version, items: version.items.map((item) => ({ ...item })) }));
    currentVersion = versions[0];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/me/avatar-profile") && method === "GET") return response({ avatarProfile: null });
      if (url.endsWith("/api/me/avatar-profile/generate")) return response({ avatarProfile }, 201);
      if (url.endsWith("/api/me/avatar-profile/enable")) return response({ avatarProfile: { ...avatarProfile, status: "enabled", enabledAt: "2026-08-13T10:05:00.000Z" } });
      if (url.endsWith("/api/me/avatar-profile/pause")) return response({ avatarProfile: { ...avatarProfile, status: "paused" } });
      if (url.endsWith("/api/me/avatar-profile/revoke")) return response({ avatarProfile: { ...avatarProfile, status: "revoked" } });

      if (url.endsWith("/api/me/avatar-knowledge") && method === "GET") return response({ items: knowledgeItems });
      if (url.endsWith("/api/me/avatar-knowledge") && method === "POST") {
        const body = requestBody(init);
        const item: KnowledgeFixture = {
          ...allowedItem,
          id: "knowledge-4",
          title: String(body.title),
          content: String(body.content),
          topic: String(body.topic),
          keywords: body.keywords as string[],
          createdAt: 5,
          updatedAt: 5,
        };
        knowledgeItems = [...knowledgeItems, item];
        return response({ item }, 201);
      }

      const governanceMatch = url.match(/\/api\/me\/avatar-knowledge\/([^/]+)\/governance$/);
      if (governanceMatch && method === "POST") {
        const body = requestBody(init);
        const item = knowledgeItems.find((candidate) => candidate.id === governanceMatch[1])!;
        const updated = {
          ...item,
          status: body.status as GovernanceStatus,
          moderationReason: body.status === "allowed" ? null : String(body.reason),
          revision: item.revision + 1,
        };
        knowledgeItems = knowledgeItems.map((candidate) => candidate.id === updated.id ? updated : candidate);
        return response({ item: updated });
      }

      const itemMatch = url.match(/\/api\/me\/avatar-knowledge\/([^/]+)$/);
      if (itemMatch && method === "PATCH") {
        const body = requestBody(init);
        const item = knowledgeItems.find((candidate) => candidate.id === itemMatch[1])!;
        const updated = { ...item, ...body, revision: item.revision + 1 } as KnowledgeFixture;
        knowledgeItems = knowledgeItems.map((candidate) => candidate.id === updated.id ? updated : candidate);
        return response({ item: updated });
      }
      if (itemMatch && method === "DELETE") {
        knowledgeItems = knowledgeItems.filter((candidate) => candidate.id !== itemMatch[1]);
        return new Response(null, { status: 204 });
      }

      if (url.endsWith("/api/me/avatar-versions") && method === "GET") {
        return response({
          items: versions,
          current: currentVersion,
          calls: [
            { id: "call-2", ownerId: "user-1", versionId: "version-2", model: "private-model", status: "failed", latencyMs: 500, inputTokens: 0, outputTokens: 0, errorCode: "MODEL_CALL_FAILED", createdAt: 6 },
            { id: "call-1", ownerId: "user-1", versionId: "version-2", model: "private-model", status: "succeeded", latencyMs: 320, inputTokens: 20, outputTokens: 16, errorCode: null, createdAt: 5 },
          ],
        });
      }
      if (url.endsWith("/api/me/avatar-versions") && method === "POST") {
        const body = requestBody(init);
        const selectedItems = knowledgeItems.filter((item) => (body.knowledgeItemIds as string[]).includes(item.id));
        const version: VersionFixture = {
          id: "version-4",
          ownerId: "user-1",
          versionNumber: 4,
          status: "draft",
          note: String(body.note || "") || null,
          items: selectedItems.map((item) => ({
            id: item.id,
            title: item.title,
            content: item.content,
            topic: item.topic,
            keywords: item.keywords,
            governanceStatus: item.status as "allowed" | "sensitive",
            authorized: item.status === "allowed" || (body.sensitiveItemIds as string[]).includes(item.id),
            sourceRevision: item.revision,
          })),
          createdAt: 7,
          activatedAt: null,
        };
        versions = [version, ...versions];
        return response({ version }, 201);
      }

      const activateMatch = url.match(/\/api\/me\/avatar-versions\/([^/]+)\/activate$/);
      if (activateMatch && method === "POST") {
        versions = versions.map((version) => version.id === activateMatch[1]
          ? { ...version, status: "active", activatedAt: 8 }
          : version.status === "active" || version.status === "stale" ? { ...version, status: "archived" } : version);
        currentVersion = versions.find((version) => version.id === activateMatch[1]) ?? null;
        return response({ version: currentVersion });
      }

      const rollbackMatch = url.match(/\/api\/me\/avatar-versions\/([^/]+)\/rollback$/);
      if (rollbackMatch && method === "POST") {
        versions = versions.map((version) => version.id === rollbackMatch[1]
          ? { ...version, status: "active", activatedAt: 9 }
          : version.status === "active" || version.status === "stale" ? { ...version, status: "archived" } : version);
        currentVersion = versions.find((version) => version.id === rollbackMatch[1]) ?? null;
        return response({ version: currentVersion });
      }

      return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404, headers });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function CurrentLocation() {
    const location = useLocation();
    return <output aria-label="当前地址">{`${location.pathname}${location.search}`}</output>;
  }

  function renderPage(entry = "/me/avatar") {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/me/avatar" element={<AvatarProfilePage />} />
          <Route path="*" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("保留摘要生成、启用、暂停和撤销入口", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "生成 AI 分身摘要" }));
    expect(await screen.findByText("喜欢阅读和散步。")).toBeVisible();
    expect(screen.getByText("以结婚为目标")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认并启用 AI 分身" }));
    expect(await screen.findByRole("heading", { name: "AI 分身已启用" })).toBeVisible();
    expect(screen.getByRole("button", { name: "暂停 AI 分身" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "撤销授权" })).toBeEnabled();
  });

  it("启用 AI 分身后返回安全的原会员聊天目标", async () => {
    const user = userEvent.setup();
    renderPage("/me/avatar?next=%2Fmatchmaking%2Flin-wanqing%2Fchat%3Ffrom%3Dmember");

    await user.click(await screen.findByRole("button", { name: "生成 AI 分身摘要" }));
    await user.click(await screen.findByRole("button", { name: "确认并启用 AI 分身" }));

    expect(await screen.findByLabelText("当前地址")).toHaveTextContent("/matchmaking/lin-wanqing/chat?from=member");
  });

  it("拒绝站外 next，并在补充问答时保留安全返回目标", async () => {
    const user = userEvent.setup();
    renderPage("/me/avatar?next=%2F%2Fevil.example%2Fsteal");
    const generateButton = await screen.findByRole("button", { name: "生成 AI 分身摘要" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: "ANSWERS_REQUIRED", message: "请先完成问答" },
    }), { status: 409, headers }));

    await user.click(generateButton);

    expect(await screen.findByRole("link", { name: "返回补充 AI 问答" })).toHaveAttribute("href", "/onboarding?step=questions&next=%2Fme%2Favatar");
  });

  it("显示服务端保存的心仪待审核状态并提供照片审核入口", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me/avatar-profile")) return response({ avatarProfile: null });
      if (url.endsWith("/api/me/avatar-knowledge")) return response({ items: [] });
      if (url.endsWith("/api/me/avatar-versions")) return response({ items: [], current: null, calls: [] });
      if (url.endsWith("/api/me/onboarding-draft")) return response({
        draft: {
          currentStep: 5,
          status: "submitted",
          data: { pendingInterest: { memberId: "member-lin", requestedAt: "2026-08-14T06:00:00.000Z" } },
          updatedAt: "2026-08-14T06:00:00.000Z",
          completedAt: "2026-08-14T06:00:00.000Z",
        },
      });
      return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404, headers });
    });

    renderPage();

    expect(await screen.findByRole("status", { name: "心仪对象待审核" })).toHaveTextContent("心仪对象已经为你保留");
    expect(screen.getByRole("status", { name: "心仪对象待审核" })).toHaveTextContent("资料、照片和 AI 分身满足条件后会自动恢复");
    expect(screen.getByRole("link", { name: "查看照片审核" })).toHaveAttribute("href", "/onboarding?step=photos&next=%2Fme%2Favatar");
  });

  it("生成返回 ANSWERS_REQUIRED 时按错误 code 提供补充问答入口", async () => {
    const user = userEvent.setup();
    renderPage();
    const generateButton = await screen.findByRole("button", { name: "生成 AI 分身摘要" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: "ANSWERS_REQUIRED", message: "服务端提示文案可能变化" },
    }), { status: 409, headers }));

    await user.click(generateButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("生成 AI 分身前，需要先回答至少 1 道关系问答。");
    expect(screen.getByRole("link", { name: "返回补充 AI 问答" })).toHaveAttribute(
      "href",
      "/onboarding?step=questions&next=%2Fme%2Favatar",
    );
  });

  it("清楚展示知识范围、过期版本和模型调用摘要", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "知识与版本" })).toBeVisible();
    expect(screen.getByText("周末喜欢散步和阅读。")).toBeVisible();
    expect(screen.getByText("属于个人生活细节")).toBeVisible();
    expect(screen.getByText("禁止公开联系方式")).toBeVisible();
    expect(screen.getByRole("status", { name: "版本需要更新" })).toHaveTextContent("知识已变化");
    expect(screen.getByText("共 2 次")).toBeVisible();
    expect(screen.getByText("1 次成功")).toBeVisible();
    expect(screen.getByText("1 次失败")).toBeVisible();
    expect(screen.getByText("36 个令牌")).toBeVisible();
    expect(screen.getByText("平均 410 毫秒")).toBeVisible();
    expect(screen.queryByText("private-model")).not.toBeInTheDocument();
  });

  it("新增、编辑、治理并删除自己的知识", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "知识与版本" });

    await user.type(screen.getByLabelText("知识标题"), "我的运动习惯");
    await user.type(screen.getByLabelText("知识分类"), "生活习惯");
    await user.type(screen.getByLabelText("可用于回答的内容"), "每周会慢跑两次。" );
    await user.type(screen.getByLabelText("关键词（用逗号分隔）"), "运动, 慢跑");
    await user.click(screen.getByRole("button", { name: "添加知识" }));
    expect(await screen.findByText("每周会慢跑两次。")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "编辑“我的运动习惯”" }));
    await user.clear(screen.getByLabelText("知识标题"));
    await user.type(screen.getByLabelText("知识标题"), "我的锻炼习惯");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("heading", { name: "我的锻炼习惯" })).toBeVisible();

    const item = screen.getByRole("article", { name: "我的锻炼习惯" });
    await user.selectOptions(within(item).getByLabelText("使用范围"), "sensitive");
    await user.type(within(item).getByLabelText("设置原因"), "需要本人再次确认");
    await user.click(within(item).getByRole("button", { name: "保存使用范围" }));
    expect(await within(item).findByText("敏感：每次使用前确认")).toBeVisible();
    expect(within(item).getByText("需要本人再次确认")).toBeVisible();

    await user.click(within(item).getByRole("button", { name: "删除“我的锻炼习惯”" }));
    expect(screen.queryByRole("heading", { name: "我的锻炼习惯" })).not.toBeInTheDocument();
  });

  it("敏感知识经显式授权后生成并启用版本，也可回滚历史版本", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "知识与版本" });

    expect(screen.getByRole("checkbox", { name: "加入版本：联系方式" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "加入版本：周末安排" }));
    await user.click(screen.getByRole("checkbox", { name: "加入版本：家庭情况" }));
    const createButton = screen.getByRole("button", { name: "生成草稿版本" });
    expect(createButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "本人确认允许“家庭情况”用于 AI 回答" }));
    await user.type(screen.getByLabelText("版本说明（选填）"), "本人确认的新版知识");
    await user.click(createButton);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/me\/avatar-versions$/), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        knowledgeItemIds: ["knowledge-1", "knowledge-2"],
        sensitiveItemIds: ["knowledge-2"],
        note: "本人确认的新版知识",
      }),
    }));

    expect(await screen.findByRole("heading", { name: "版本 4" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "启用版本 4" }));
    expect(await screen.findByText("当前启用", { selector: "strong" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "回滚版本 1" }));
    expect(await screen.findByText("已回滚到版本 1")).toBeVisible();
  });
});
