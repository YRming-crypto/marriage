import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarKnowledgeState } from "./avatar-knowledge/index.js";
import type { ContentActivityState } from "./content/index.js";
import { buildServer } from "./server.js";
import { createMemoryStore, type StorePersistence } from "./store/index.js";

function persistence(overrides: Partial<StorePersistence>) {
  const base: Partial<StorePersistence> = {
    hydrate: async () => undefined,
    close: async () => undefined,
    verifyOtp: async () => true,
    persistConversation: async (conversation) => conversation,
    ...overrides,
  };
  return new Proxy(base, {
    get(target, property) {
      return Reflect.get(target, property) ?? (async () => undefined);
    },
  }) as StorePersistence;
}

describe("内容与知识持久化接线", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0; });

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    return `refresh_token=${response.cookies.find((item) => item.name === "refresh_token")?.value}`;
  }

  it("服务启动时恢复内容和 AI 知识状态", async () => {
    const now = Date.parse("2026-08-14T00:00:00Z");
    const contentState: ContentActivityState = {
      content: [{ id: "00000000-0000-4000-8000-000000000101", type: "article", status: "published", title: "安全见面", summary: "公开场所见面", body: "第一次见面请选择公共场所。", tags: ["安全"], coverImageUrl: null, authorId: "00000000-0000-4000-8000-000000000099", likeCount: 0, registrationCount: 0, event: null, createdAt: now, updatedAt: now, publishedAt: now, offlineAt: null }],
      likes: [],
      registrations: [],
    };
    const avatarState: AvatarKnowledgeState = { items: [], versions: [], currentVersions: [], callLogs: [] };
    const store = createMemoryStore();
    store.persistence = persistence({
      loadContentActivityState: vi.fn().mockResolvedValue(contentState),
      loadAvatarKnowledgeState: vi.fn().mockResolvedValue(avatarState),
    });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/content" });

    expect(response.json().data.items).toEqual([expect.objectContaining({ title: "安全见面" })]);
  });

  it("内容和知识发生变化后立即保存领域快照", async () => {
    const saveContent = vi.fn().mockResolvedValue(undefined);
    const saveAvatar = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore();
    store.persistence = persistence({
      loadContentActivityState: vi.fn().mockResolvedValue({ content: [], likes: [], registrations: [] }),
      loadAvatarKnowledgeState: vi.fn().mockResolvedValue({ items: [], versions: [], currentVersions: [], callLogs: [] }),
      persistContentActivityState: saveContent,
      persistAvatarKnowledgeState: saveAvatar,
    });
    const app = buildServer({ store, otpCode: "123456", adminPhones: ["13900139999"] });
    apps.push(app);
    const admin = await login(app, "13900139999");
    const user = await login(app, "13800138000");

    const createdContent = await app.inject({ method: "POST", url: "/api/admin/content", headers: { cookie: admin }, payload: { type: "article", title: "关系课堂", summary: "学习认真沟通", body: "沟通时先听清对方的真实想法，再表达自己的感受。" } });
    const createdKnowledge = await app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie: user }, payload: { title: "周末安排", topic: "生活", content: "周末喜欢阅读。" } });

    expect(createdContent.statusCode).toBe(201);
    expect(createdKnowledge.statusCode).toBe(201);
    expect(saveContent).toHaveBeenCalledWith(expect.objectContaining({ content: [expect.objectContaining({ title: "关系课堂" })] }));
    expect(saveAvatar).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ title: "周末安排" })] }));
  });
});
