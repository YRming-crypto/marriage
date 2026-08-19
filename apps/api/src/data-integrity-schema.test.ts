import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("数据库完整性约束", () => {
  const schema = readFileSync(resolve(process.cwd(), "../../prisma/schema.prisma"), "utf8");

  it("真人消息幂等键包含发送者，双方可使用相同客户端消息 ID", () => {
    expect(schema).toContain("@@unique([conversationId, senderId, clientMessageId])");
    expect(schema).not.toContain("@@unique([conversationId, clientMessageId])");
  });

  it("内容与 AI 知识具备完整的重启恢复字段", () => {
    const normalized = schema.replace(/\s+/g, " ");
    for (const field of [
      "tags String[]",
      "eventEndsAt DateTime?",
      "offlineAt DateTime?",
      "title String",
      "keywords String[]",
      "governanceStatus KnowledgeGovernanceStatus",
      "moderationReason String?",
      "revision Int",
      "status AvatarProfileVersionStatus",
      "note String?",
      "activatedAt DateTime?",
    ]) expect(normalized).toContain(field);
  });

  it("账号停用来源会持久化，管理员停用不会被普通登录恢复", () => {
    const normalized = schema.replace(/\s+/g, " ");
    expect(normalized).toContain("enum SuspensionSource");
    expect(normalized).toContain("suspensionSource SuspensionSource?");
  });

  it("allows multiple avatar conversation rounds for one user pair and keeps a lookup index", () => {
    const avatarConversation = schema
      .split("model AvatarConversation {")[1]
      ?.split("model AvatarMessage {")[0] ?? "";

    expect(avatarConversation).not.toContain("@@unique([userId, targetUserId])");
    expect(avatarConversation).toContain("@@index([userId, targetUserId, createdAt])");
  });
});
