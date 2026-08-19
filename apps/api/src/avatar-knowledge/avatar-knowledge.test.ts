import { describe, expect, it } from "vitest";
import {
  AvatarKnowledgeError,
  InMemoryAvatarKnowledgeService,
  type AnswerModel,
  type AvatarKnowledgeClock,
} from "./index.js";

class ManualClock implements AvatarKnowledgeClock {
  private current = 1_800_000_000_000;

  now = (): number => this.current++;
}

function createService() {
  return new InMemoryAvatarKnowledgeService({
    clock: new ManualClock(),
    idFactory: (() => {
      let sequence = 0;
      return (prefix) => `${prefix}-${++sequence}`;
    })(),
  });
}

describe("知识条目 CRUD 与治理标记", () => {
  it("按用户隔离地创建、读取、更新、列出和删除知识条目", () => {
    const service = createService();
    const created = service.createKnowledgeItem("alice", {
      title: "周末安排",
      content: "我通常周六上午去公园散步，下午陪家人。",
      topic: "生活方式",
      keywords: ["周末", "散步", "家人"],
    });

    expect(service.getKnowledgeItem("alice", created.id)).toMatchObject({
      ownerId: "alice",
      title: "周末安排",
      status: "allowed",
    });
    expect(service.listKnowledgeItems("alice")).toHaveLength(1);
    expect(() => service.getKnowledgeItem("bob", created.id)).toThrow(AvatarKnowledgeError);

    const updated = service.updateKnowledgeItem("alice", created.id, {
      content: "我通常周六上午去公园散步，下午看望父母。",
      keywords: ["周末", "散步", "父母"],
    });
    expect(updated.revision).toBe(2);
    expect(updated.content).toContain("父母");

    service.deleteKnowledgeItem("alice", created.id);
    expect(service.listKnowledgeItems("alice")).toEqual([]);
    expect(() => service.getKnowledgeItem("alice", created.id)).toThrow(/KNOWLEDGE_NOT_FOUND/);
  });

  it("可标记敏感或禁止主题，并阻止禁止知识进入版本", () => {
    const service = createService();
    const sensitive = service.createKnowledgeItem("alice", {
      title: "健康边界",
      content: "健康细节只愿意在熟悉后本人沟通。",
      topic: "健康",
      keywords: ["健康"],
    });
    const prohibited = service.createKnowledgeItem("alice", {
      title: "银行密码",
      content: "不应由 AI 分身透露的财务秘密。",
      topic: "财务凭证",
      keywords: ["密码"],
    });

    expect(service.markKnowledgeItem("alice", sensitive.id, {
      status: "sensitive",
      reason: "需要谨慎表述",
    })).toMatchObject({ status: "sensitive", moderationReason: "需要谨慎表述" });
    expect(service.markKnowledgeItem("alice", prohibited.id, {
      status: "prohibited",
      reason: "禁止 AI 使用凭证类信息",
    })).toMatchObject({ status: "prohibited" });

    expect(() => service.createDraftVersion("alice", {
      knowledgeItemIds: [sensitive.id, prohibited.id],
      sensitiveItemIds: [sensitive.id],
    })).toThrow(/PROHIBITED_KNOWLEDGE/);
  });
});

describe("知识状态恢复", () => {
  it("恢复知识、当前版本和调用日志后仍可按授权内容回答", async () => {
    const original = createService();
    const item = original.createKnowledgeItem("alice", {
      title: "周末安排",
      content: "周末喜欢散步和阅读。",
      topic: "生活方式",
      keywords: ["周末", "阅读"],
    });
    const version = original.createDraftVersion("alice", { knowledgeItemIds: [item.id] });
    original.activateVersion("alice", version.id);
    await original.answer("alice", "周末一般怎么安排？");

    const restored = createService();
    restored.restoreState(original.exportState());

    expect(restored.getCurrentVersion("alice")).toMatchObject({ id: version.id, status: "active" });
    expect(restored.listCallLogs("alice")).toHaveLength(1);
    await expect(restored.answer("alice", "周末一般怎么安排？")).resolves.toMatchObject({
      kind: "knowledge",
      sourceItemIds: [item.id],
    });
  });
});

describe("版本快照、启用、过期与回滚", () => {
  it("创建不可变草稿快照，只有启用版本可供回答", async () => {
    const service = createService();
    const routine = service.createKnowledgeItem("alice", {
      title: "周末安排",
      content: "我周六喜欢去公园散步。",
      topic: "生活方式",
      keywords: ["周末", "公园", "散步"],
    });
    const draft = service.createDraftVersion("alice", {
      knowledgeItemIds: [routine.id],
      note: "第一版",
    });

    service.updateKnowledgeItem("alice", routine.id, {
      content: "我周六喜欢在家阅读。",
    });
    expect(service.getVersion("alice", draft.id).items[0]?.content).toBe("我周六喜欢去公园散步。");

    await expect(service.answer("alice", "你周末喜欢做什么？")).resolves.toMatchObject({
      kind: "fallback",
      versionId: null,
    });

    const active = service.activateVersion("alice", draft.id);
    expect(active.status).toBe("active");
    await expect(service.answer("alice", "你周末喜欢做什么？")).resolves.toMatchObject({
      kind: "knowledge",
      versionId: draft.id,
      answer: expect.stringContaining("公园散步"),
      sourceItemIds: [routine.id],
    });
  });

  it("知识变更或新增会令当前版本 stale，新版启用后旧版可回滚", () => {
    const service = createService();
    const firstItem = service.createKnowledgeItem("alice", {
      title: "阅读习惯",
      content: "我睡前会阅读半小时。",
      topic: "爱好",
      keywords: ["阅读", "睡前"],
    });
    const versionOne = service.createDraftVersion("alice", { knowledgeItemIds: [firstItem.id] });
    service.activateVersion("alice", versionOne.id);

    service.createKnowledgeItem("alice", {
      title: "运动习惯",
      content: "我每周游泳两次。",
      topic: "爱好",
      keywords: ["游泳", "运动"],
    });
    expect(service.getCurrentVersion("alice")).toMatchObject({ id: versionOne.id, status: "stale" });

    const allIds = service.listKnowledgeItems("alice").map((item) => item.id);
    const versionTwo = service.createDraftVersion("alice", { knowledgeItemIds: allIds });
    service.activateVersion("alice", versionTwo.id);
    expect(service.getVersion("alice", versionOne.id).status).toBe("archived");

    const restored = service.rollbackVersion("alice", versionOne.id);
    expect(restored).toMatchObject({ id: versionOne.id, status: "active" });
    expect(service.getVersion("alice", versionTwo.id).status).toBe("archived");
  });

  it("敏感知识必须在版本中显式授权，禁止知识永远不能授权", async () => {
    const service = createService();
    const sensitive = service.createKnowledgeItem("alice", {
      title: "家庭情况",
      content: "我和母亲同住，会优先照顾她。",
      topic: "家庭",
      keywords: ["母亲", "同住", "家庭"],
    });
    service.markKnowledgeItem("alice", sensitive.id, {
      status: "sensitive",
      reason: "家庭隐私",
    });

    const withoutConsent = service.createDraftVersion("alice", {
      knowledgeItemIds: [sensitive.id],
    });
    service.activateVersion("alice", withoutConsent.id);
    await expect(service.answer("alice", "你和谁同住？")).resolves.toMatchObject({ kind: "fallback" });

    const withConsent = service.createDraftVersion("alice", {
      knowledgeItemIds: [sensitive.id],
      sensitiveItemIds: [sensitive.id],
    });
    service.activateVersion("alice", withConsent.id);
    await expect(service.answer("alice", "你和谁同住？")).resolves.toMatchObject({
      kind: "knowledge",
      sourceItemIds: [sensitive.id],
    });
  });

  it("启用后新增的敏感或禁止标记会立即撤销旧快照的回答权限", async () => {
    const service = createService();
    const item = service.createKnowledgeItem("alice", {
      title: "家庭住址",
      content: "我住在梧桐路附近。",
      topic: "居住信息",
      keywords: ["住址", "住在哪里"],
    });
    const version = service.createDraftVersion("alice", { knowledgeItemIds: [item.id] });
    service.activateVersion("alice", version.id);
    await expect(service.answer("alice", "你住在哪里？")).resolves.toMatchObject({ kind: "knowledge" });

    service.markKnowledgeItem("alice", item.id, {
      status: "sensitive",
      reason: "住址信息需要重新明确授权",
    });
    await expect(service.answer("alice", "你住在哪里？")).resolves.toMatchObject({ kind: "fallback" });

    service.markKnowledgeItem("alice", item.id, {
      status: "prohibited",
      reason: "禁止分身透露具体住址",
    });
    await expect(service.answer("alice", "你住在哪里？")).resolves.toMatchObject({ kind: "fallback" });
  });
});

describe("回答边界与调用日志", () => {
  it("只把已启用版本内已授权且与问题相关的知识发送给模型", async () => {
    const calls: Parameters<AnswerModel>[0][] = [];
    const model: AnswerModel = async (request) => {
      calls.push(request);
      return {
        text: `根据授权知识：${request.knowledge.map((item) => item.content).join("；")}`,
        usage: { inputTokens: 18, outputTokens: 12 },
      };
    };
    const service = new InMemoryAvatarKnowledgeService({
      clock: new ManualClock(),
      idFactory: (() => {
        let sequence = 0;
        return (prefix) => `${prefix}-${++sequence}`;
      })(),
      model,
      modelName: "local-answer-model",
    });
    const travel = service.createKnowledgeItem("alice", {
      title: "旅行偏好",
      content: "我喜欢慢节奏的山水旅行。",
      topic: "旅行",
      keywords: ["旅行", "山水"],
    });
    const finance = service.createKnowledgeItem("alice", {
      title: "财务细节",
      content: "这条敏感财务知识没有授权。",
      topic: "财务",
      keywords: ["财务"],
    });
    service.markKnowledgeItem("alice", finance.id, { status: "sensitive", reason: "财务隐私" });
    const version = service.createDraftVersion("alice", {
      knowledgeItemIds: [travel.id, finance.id],
    });
    service.activateVersion("alice", version.id);

    const result = await service.answer("alice", "你喜欢怎样的旅行？");

    expect(result).toMatchObject({ kind: "knowledge", sourceItemIds: [travel.id] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      ownerId: "alice",
      versionId: version.id,
      question: "你喜欢怎样的旅行？",
      knowledge: [{ id: travel.id, content: "我喜欢慢节奏的山水旅行。" }],
    });
    expect(JSON.stringify(calls[0])).not.toContain("这条敏感财务知识没有授权");
  });

  it("未知问题直接安全回退且不调用模型", async () => {
    let modelCallCount = 0;
    const service = new InMemoryAvatarKnowledgeService({
      model: async () => {
        modelCallCount += 1;
        return { text: "不应被调用", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    });
    const item = service.createKnowledgeItem("alice", {
      title: "烹饪",
      content: "我会做清蒸鱼。",
      topic: "生活技能",
      keywords: ["做饭", "清蒸鱼"],
    });
    service.activateVersion("alice", service.createDraftVersion("alice", {
      knowledgeItemIds: [item.id],
    }).id);

    const result = await service.answer("alice", "你的银行卡号是多少？");

    expect(result).toMatchObject({
      kind: "fallback",
      answer: expect.stringContaining("本人"),
      sourceItemIds: [],
    });
    expect(modelCallCount).toBe(0);
  });

  it("记录模型、耗时、token 和成功/失败状态，但不保存密钥或完整问答", async () => {
    const secrets = "sk-live-secret-never-store";
    const successService = createService();
    const item = successService.createKnowledgeItem("alice", {
      title: "宠物",
      content: "我喜欢猫。",
      topic: "爱好",
      keywords: ["宠物", "猫"],
    });
    successService.activateVersion("alice", successService.createDraftVersion("alice", {
      knowledgeItemIds: [item.id],
    }).id);
    await successService.answer("alice", "你喜欢什么宠物？");

    expect(successService.listCallLogs("alice")[0]).toMatchObject({
      ownerId: "alice",
      model: "memory-grounded-answer-v1",
      status: "succeeded",
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      latencyMs: expect.any(Number),
    });

    const failedService = new InMemoryAvatarKnowledgeService({
      modelName: "failing-model",
      model: async () => {
        throw new Error(`provider rejected ${secrets}`);
      },
    });
    const failedItem = failedService.createKnowledgeItem("alice", {
      title: "音乐",
      content: "我喜欢古典音乐。",
      topic: "爱好",
      keywords: ["音乐", "古典"],
    });
    failedService.activateVersion("alice", failedService.createDraftVersion("alice", {
      knowledgeItemIds: [failedItem.id],
    }).id);

    await expect(failedService.answer("alice", "你喜欢什么音乐？"))
      .rejects.toThrow("MODEL_CALL_FAILED");

    const [failedLog] = failedService.listCallLogs("alice");
    expect(failedLog).toMatchObject({ model: "failing-model", status: "failed" });
    expect(JSON.stringify(failedLog)).not.toContain(secrets);
    expect(JSON.stringify(failedService.listCallLogs("alice"))).not.toContain("你喜欢什么音乐");
    expect(Object.keys(failedLog)).not.toContain("apiKey");
    expect(Object.keys(failedService)).not.toContain("apiKey");
  });
});
