import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAvatarKnowledgeService } from "./avatar-knowledge/index.js";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("AI 分身知识治理接口", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0; });

  async function setup() {
    const service = new InMemoryAvatarKnowledgeService();
    const app = buildServer({ store: createMemoryStore(), otpCode: "123456", avatarKnowledgeService: service });
    apps.push(app);
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const loggedIn = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    return { app, cookie: `refresh_token=${loggedIn.cookies.find((item) => item.name === "refresh_token")?.value}` };
  }

  it("管理知识条目、敏感授权并启用不可变版本", async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie }, payload: { title: "周末安排", topic: "生活习惯", content: "周末喜欢散步和阅读。", keywords: ["周末", "阅读"] } });
    expect(created.statusCode).toBe(201);
    const itemId = created.json().data.item.id as string;
    const marked = await app.inject({ method: "POST", url: `/api/me/avatar-knowledge/${itemId}/governance`, headers: { cookie }, payload: { status: "sensitive", reason: "属于个人生活细节" } });
    expect(marked.json().data.item.status).toBe("sensitive");

    const draft = await app.inject({ method: "POST", url: "/api/me/avatar-versions", headers: { cookie }, payload: { knowledgeItemIds: [itemId], sensitiveItemIds: [itemId], note: "本人确认版本" } });
    expect(draft.statusCode).toBe(201);
    const versionId = draft.json().data.version.id as string;
    const active = await app.inject({ method: "POST", url: `/api/me/avatar-versions/${versionId}/activate`, headers: { cookie } });
    expect(active.json().data.version.status).toBe("active");
    const listed = await app.inject({ method: "GET", url: "/api/me/avatar-versions", headers: { cookie } });
    expect(listed.json().data.items).toHaveLength(1);
  });

  it("禁止主题不能进入版本且其他用户不能访问", async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie }, payload: { title: "联系方式", topic: "隐私", content: "这里不应公开联系方式。" } });
    const itemId = created.json().data.item.id as string;
    await app.inject({ method: "POST", url: `/api/me/avatar-knowledge/${itemId}/governance`, headers: { cookie }, payload: { status: "prohibited", reason: "禁止公开联系方式" } });
    const version = await app.inject({ method: "POST", url: "/api/me/avatar-versions", headers: { cookie }, payload: { knowledgeItemIds: [itemId] } });
    expect(version.statusCode).toBe(409);
    expect(version.json().error.code).toBe("PROHIBITED_KNOWLEDGE");
    expect((await app.inject({ method: "GET", url: "/api/me/avatar-knowledge" })).statusCode).toBe(401);
  });

  it("AI 分身聊天优先使用对方启用版本中的授权知识，未知问题安全回退", async () => {
    const service = new InMemoryAvatarKnowledgeService();
    const app = buildServer({ store: createMemoryStore(), otpCode: "123456", avatarKnowledgeService: service });
    apps.push(app);
    const login = async (phone: string) => {
      await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
      return `refresh_token=${response.cookies.find((item) => item.name === "refresh_token")?.value}`;
    };
    const owner = await login("13900139000");
    const visitor = await login("13800138000");
    const created = await app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie: owner }, payload: { title: "周末安排", topic: "生活方式", content: "周六上午散步，下午陪家人。", keywords: ["周末", "散步"] } });
    const itemId = created.json().data.item.id as string;
    const draft = await app.inject({ method: "POST", url: "/api/me/avatar-versions", headers: { cookie: owner }, payload: { knowledgeItemIds: [itemId] } });
    const versionId = draft.json().data.version.id as string;
    await app.inject({ method: "POST", url: `/api/me/avatar-versions/${versionId}/activate`, headers: { cookie: owner } });
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: visitor }, payload: { memberId: "lin-wanqing" } });
    const sessionId = session.json().data.session.id as string;

    const relevant = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: visitor }, payload: { text: "周末一般怎么安排？" } });
    const unknown = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: visitor }, payload: { text: "银行卡号是多少？" } });

    expect(relevant.json().data.messages[1].text).toContain("周六上午散步");
    expect(unknown.json().data.messages[1].text).toContain("本人");
    expect(unknown.json().data.messages[1].text).not.toContain("教育行业");
  });

  it("启用知识版本后仍通过统一 AI Provider 生成并过滤回答", async () => {
    const reply = vi.fn(async () => "统一 Provider 已根据授权知识回答");
    const app = buildServer({
      store: createMemoryStore(),
      otpCode: "123456",
      providers: { avatarModel: { reply } },
    });
    apps.push(app);
    const login = async (phone: string) => {
      await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
      return `refresh_token=${response.cookies.find((item) => item.name === "refresh_token")?.value}`;
    };
    const owner = await login("13900139000");
    const visitor = await login("13800138000");
    const created = await app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie: owner }, payload: { title: "周末安排", topic: "生活方式", content: "周六上午散步，下午陪家人。", keywords: ["周末"] } });
    const itemId = created.json().data.item.id as string;
    const draft = await app.inject({ method: "POST", url: "/api/me/avatar-versions", headers: { cookie: owner }, payload: { knowledgeItemIds: [itemId] } });
    await app.inject({ method: "POST", url: `/api/me/avatar-versions/${draft.json().data.version.id}/activate`, headers: { cookie: owner } });
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: visitor }, payload: { memberId: "lin-wanqing" } });

    const response = await app.inject({ method: "POST", url: `/api/avatar-sessions/${session.json().data.session.id}/messages`, headers: { cookie: visitor }, payload: { text: "周末一般怎么安排？" } });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.messages[1].text).toBe("统一 Provider 已根据授权知识回答");
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      question: "周末一般怎么安排？",
      approvedFacts: [{ topic: "生活方式", fact: "周六上午散步，下午陪家人。" }],
    }));
  });
});
