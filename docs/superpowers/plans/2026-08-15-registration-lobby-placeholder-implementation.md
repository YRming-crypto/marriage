# 注册即进入寻找缘分大厅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OTP 首次注册成功后，普通活跃账号立即以不泄露资料的占位卡进入 `/find`，并在资料状态变化时升级或下架，同时保持正式匹配和聊天门槛不变。

**Architecture:** 保留现有 `Member` 作为正式会员契约，新增大厅专用的 `LobbyMember` 判别联合类型。API 在读取大厅时把持久化 `User/Profile` 转换为临时受限投影，再与现有正式会员投影合并；占位投影不写入 `store.members`，因此不会进入推荐算法。前端用独立 `LobbyMemberCard` 根据 `lobbyStatus` 渲染完整卡或占位卡。

**Tech Stack:** TypeScript、Fastify、React、React Router、Vitest、Testing Library、Prisma/PostgreSQL、Docker Compose、Cloudflare Tunnel

---

## 文件结构

- Create: `apps/api/src/matching/lobby-members.ts`：生成、筛选和解析受限大厅投影。
- Create: `apps/api/src/registration-lobby-members.test.ts`：注册、隐私、状态升级、下架和联系门槛 API 回归。
- Modify: `packages/shared/src/index.ts`：定义 `LobbyMember` 判别联合类型。
- Modify: `packages/shared/src/contracts.ts`：大厅列表响应改为 `LobbyMember[]`，查询增加明确的占位展示开关。
- Modify: `apps/api/src/matching/public-search.ts`：只对具有真实字段的投影执行资料筛选。
- Modify: `apps/api/src/matching/public-search.test.ts`：覆盖占位投影与主动筛选的关系。
- Modify: `apps/api/src/server.ts`：大厅合并、占位操作拒绝和状态转换接线。
- Modify: `apps/web/src/api/client.ts`：大厅请求与返回类型接入 `LobbyMember`。
- Modify: `apps/web/src/api/useMembers.ts`：默认大厅请求占位会员，主动筛选时关闭占位会员。
- Modify: `apps/web/src/api/useMembers.test.tsx`：验证请求参数和分页去重。
- Create: `apps/web/src/components/LobbyMemberCard.tsx`：正式会员和占位会员的单一大厅入口组件。
- Create: `apps/web/src/components/LobbyMemberCard.test.tsx`：占位隐私和禁用交互测试。
- Modify: `apps/web/src/pages/FindPage.tsx`：改用大厅卡片并更新说明文案。
- Modify: `apps/web/src/pages/FindPage.test.tsx`：覆盖新加入、审核中和完整会员混合展示。
- Modify: `apps/web/src/styles/global.css`：稳定占位卡尺寸与状态样式。
- Modify: `deploy/scripts/persistence-smoke.local.ps1`：增加注册占位跨 API 重启断言。
- Modify: `docs/api-contracts.md`、`docs/current-implementation-summary.md`、`docs/project-status-summary.md`：记录新契约和验证结果。

---

### Task 1: 定义大厅判别联合契约

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/contracts.ts`
- Test: `apps/api/src/registration-lobby-members.test.ts`

- [ ] **Step 1: 写出会失败的 API 契约测试**

在 `apps/api/src/registration-lobby-members.test.ts` 创建首个测试：

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("注册会员大厅占位投影", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    const token = response.cookies.find((cookie) => cookie.name === "refresh_token")?.value;
    expect(response.statusCode).toBe(200);
    expect(token).toBeTruthy();
    return {
      cookie: `refresh_token=${token}`,
      userId: response.json().data.user.id as string,
    };
  }

  it("OTP 首次注册后立即返回不含人口属性的安全占位卡", async () => {
    const app = buildServer({ otpCode: "123456", encryptionKey: "lobby-test-secret" });
    apps.push(app);
    const registered = await login(app, "13800138111");

    const response = await app.inject({ method: "GET", url: "/api/members?includeIncomplete=true" });
    expect(response.statusCode).toBe(200);
    const item = response.json().data.items.find((member: { lobbyStatus: string }) => member.lobbyStatus === "new");
    expect(item).toMatchObject({ nickname: "新加入会员", lobbyStatus: "new", verified: false });
    expect(item.id).not.toContain(registered.userId);
    expect(JSON.stringify(item)).not.toContain("13800138111");
    expect(item).not.toHaveProperty("age");
    expect(item).not.toHaveProperty("gender");
    expect(item).not.toHaveProperty("city");
  });
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npm.cmd run test --workspace @ai-marriage/api -- --run src/registration-lobby-members.test.ts
```

Expected: FAIL，因为 `/api/members` 尚未生成 `lobbyStatus=new` 的占位投影。

- [ ] **Step 3: 增加共享判别联合类型**

在 `packages/shared/src/index.ts` 保留现有 `Member`，新增：

```ts
export type LobbyMemberStatus = "new" | "reviewing" | "verified";

export interface IncompleteLobbyMember {
  id: string;
  lobbyStatus: "new" | "reviewing";
  nickname: string;
  activeLabel: string;
  joinedAt?: ISODateString;
  verified: false;
  gender?: Gender;
  age?: number;
  city?: string;
  district?: string;
  job?: string;
  maritalStatus?: MaritalStatus;
  goal?: RelationshipGoal;
}

export type LobbyMember = (Member & { lobbyStatus: "verified" }) | IncompleteLobbyMember;
```

在 `packages/shared/src/contracts.ts`：

```ts
export interface MembersQuery {
  city?: string;
  minAge?: number;
  maxAge?: number;
  gender?: Gender;
  maritalStatus?: MaritalStatus;
  goal?: RelationshipGoal;
  cursor?: string;
  pageSize?: number;
  smokingStatus?: string;
  childrenStatus?: string;
  onlyWithPhoto?: boolean;
  sort?: "default" | "recent-active" | "newest" | "age-asc" | "age-desc";
  includeIncomplete?: boolean;
}

export interface ListMembersResponse {
  items: LobbyMember[];
  total: number;
  pageSize: number;
  nextCursor: string | null;
  hasMore: boolean;
}
```

- [ ] **Step 4: 构建共享包确认类型定义有效**

Run: `npm.cmd run build --workspace @ai-marriage/shared`

Expected: PASS。

- [ ] **Step 5: 提交契约和失败测试**

```powershell
git add packages/shared/src/index.ts packages/shared/src/contracts.ts apps/api/src/registration-lobby-members.test.ts
git commit -m "test: define registration lobby contract"
```

---

### Task 2: 生成安全且可恢复的占位投影

**Files:**
- Create: `apps/api/src/matching/lobby-members.ts`
- Modify: `apps/api/src/matching/public-search.ts`
- Modify: `apps/api/src/matching/public-search.test.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/registration-lobby-members.test.ts`

- [ ] **Step 1: 扩展失败测试覆盖本人排除、角色排除和重启恢复**

增加断言：

```ts
it("本人、管理员和非活跃账号不会作为占位会员返回", async () => {
  const store = createMemoryStore([]);
  const app = buildServer({ store, otpCode: "123456", encryptionKey: "lobby-test-secret", adminPhones: ["13900139999"] });
  apps.push(app);
  const member = await login(app, "13800138112");
  await login(app, "13900139999");
  const ownView = await app.inject({ method: "GET", url: "/api/members?includeIncomplete=true", headers: { cookie: member.cookie } });
  expect(ownView.json().data.items).toHaveLength(0);
  const visitorView = await app.inject({ method: "GET", url: "/api/members?includeIncomplete=true" });
  expect(visitorView.json().data.items).toHaveLength(1);
  store.users.get(member.userId)!.status = "suspended";
  const suspendedView = await app.inject({ method: "GET", url: "/api/members?includeIncomplete=true" });
  expect(suspendedView.json().data.items).toHaveLength(0);
});

it("持久化账号在 API 重新构建后仍能恢复占位投影", async () => {
  const store = createMemoryStore([]);
  const first = buildServer({ store, otpCode: "123456", encryptionKey: "lobby-test-secret" });
  await login(first, "13800138113");
  await first.close();
  const second = buildServer({ store, otpCode: "123456", encryptionKey: "lobby-test-secret" });
  apps.push(second);
  const restored = await second.inject({ method: "GET", url: "/api/members?includeIncomplete=true" });
  expect(restored.json().data.items).toEqual([
    expect.objectContaining({ lobbyStatus: "new", nickname: "新加入会员" }),
  ]);
});
```

- [ ] **Step 2: 运行测试确认新场景失败**

Run: `npm.cmd run test --workspace @ai-marriage/api -- --run src/registration-lobby-members.test.ts`

Expected: FAIL，失败原因是占位生成函数尚不存在。

- [ ] **Step 3: 实现独立大厅投影模块**

在 `apps/api/src/matching/lobby-members.ts` 实现：

```ts
import { createHmac } from "node:crypto";
import type { IncompleteLobbyMember } from "@ai-marriage/shared";
import type { Store, StoredProfile, StoredUser } from "../store/types.js";

export function incompleteLobbyMemberId(userId: string, secret: string) {
  const digest = createHmac("sha256", secret).update(`lobby:${userId}`).digest("base64url").slice(0, 24);
  return `new-${digest}`;
}

export function incompleteLobbyMember(user: StoredUser, profile: StoredProfile | undefined, secret: string): IncompleteLobbyMember {
  const reviewing = profile !== undefined;
  return {
    id: incompleteLobbyMemberId(user.id, secret),
    lobbyStatus: reviewing ? "reviewing" : "new",
    nickname: reviewing && profile.nickname.trim() ? profile.nickname : "新加入会员",
    activeLabel: reviewing ? "资料审核中" : "资料待完善",
    joinedAt: user.createdAt,
    verified: false,
    ...(reviewing ? {
      gender: profile.gender as IncompleteLobbyMember["gender"],
      age: new Date().getFullYear() - profile.birthYear,
      city: profile.city,
      district: profile.district,
      job: profile.job,
      maritalStatus: profile.maritalStatus as IncompleteLobbyMember["maritalStatus"],
      goal: profile.goal as IncompleteLobbyMember["goal"],
    } : {}),
  };
}

export function listIncompleteLobbyMembers(store: Store, secret: string) {
  const completedOwners = new Set([...store.members.values()].flatMap((member) => member.ownerUserId ? [member.ownerUserId] : []));
  return [...store.users.values()]
    .filter((user) => user.role === "user" && user.status === "active" && !completedOwners.has(user.id))
    .filter((user) => store.profiles.get(user.id)?.visibility !== "private")
    .map((user) => incompleteLobbyMember(user, store.profiles.get(user.id), secret));
}
```

增加 `findIncompleteLobbyOwner`，通过扫描活跃普通用户并比较 HMAC ID 找回归属，只用于返回明确错误，不公开归属 ID。

- [ ] **Step 4: 接入 `GET /api/members`**

在 `apps/api/src/server.ts`：

```ts
const verifiedMembers = [...store.members.values()]
  .filter((member) => {
    const visibility = member.ownerUserId ? store.profiles.get(member.ownerUserId)?.visibility : undefined;
    const publiclyVisible = visibility ? visibility === "public" : member.demo === true;
    return publiclyVisible && member.ownerUserId !== viewer?.id && !hiddenUserIds.has(member.ownerUserId ?? "");
  })
  .map((member) => ({ ...publicMember(member), lobbyStatus: "verified" as const }));

const incompleteMembers = query.includeIncomplete
  ? listIncompleteLobbyMembers(store, config.encryptionKey)
      .filter((member) => member.id !== incompleteLobbyMemberId(viewer?.id ?? "", config.encryptionKey))
      .filter((member) => !hiddenUserIds.has(findIncompleteLobbyOwnerId(member, store, config.encryptionKey)))
  : [];
```

先解析查询，再根据是否存在主动资料筛选决定是否允许 `includeIncomplete`。服务端不能仅信任客户端布尔值；当性别、年龄、城市、婚姻、目标、吸烟、子女或仅看照片任一筛选生效时，不返回 `new` 占位卡。

- [ ] **Step 5: 更新搜索模块支持缺失字段**

将 `PublicSearchMember` 的人口属性改为可选，并在 `searchPublicMembers` 中保持严格语义：存在筛选值时，缺少对应真实字段的投影不匹配。增加测试：无筛选时占位卡保留，性别或年龄筛选时占位卡排除。

- [ ] **Step 6: 运行 API 定向测试**

```powershell
npm.cmd run test --workspace @ai-marriage/api -- --run src/registration-lobby-members.test.ts src/matching/public-search.test.ts src/public-member-search-route.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交服务端投影**

```powershell
git add apps/api/src/matching/lobby-members.ts apps/api/src/matching/public-search.ts apps/api/src/matching/public-search.test.ts apps/api/src/server.ts apps/api/src/registration-lobby-members.test.ts
git commit -m "feat: show new registrations in public lobby"
```

---

### Task 3: 阻止占位会员绕过联系门槛

**Files:**
- Modify: `apps/api/src/registration-lobby-members.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: 写出占位操作失败测试**

```ts
it("占位会员不能被心仪、跳过或创建 AI 会话", async () => {
  const app = buildServer({ otpCode: "123456", encryptionKey: "lobby-test-secret" });
  apps.push(app);
  await login(app, "13800138114");
  const lobby = await app.inject({ method: "GET", url: "/api/members?includeIncomplete=true" });
  const placeholderId = lobby.json().data.items.find((member: { lobbyStatus: string }) => member.lobbyStatus === "new").id as string;
  const { cookie: memberCookie } = await login(app, "13800138115");
  const requests = await Promise.all([
    app.inject({ method: "POST", url: `/api/members/${placeholderId}/interest`, headers: { cookie: memberCookie } }),
    app.inject({ method: "POST", url: `/api/members/${placeholderId}/skip`, headers: { cookie: memberCookie } }),
    app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: memberCookie }, payload: { memberId: placeholderId } }),
  ]);
  for (const response of requests) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "MEMBER_PROFILE_INCOMPLETE" } });
  }
});
```

- [ ] **Step 2: 运行测试确认当前返回 404**

Run: `npm.cmd run test --workspace @ai-marriage/api -- --run src/registration-lobby-members.test.ts`

Expected: FAIL，实际错误为 `MEMBER_NOT_FOUND`。

- [ ] **Step 3: 在所有成员入口统一识别占位 ID**

在 `server.ts` 增加局部守卫：

```ts
function rejectIncompleteLobbyMember(memberId: string, reply: FastifyReply) {
  if (!findIncompleteLobbyOwner(store, memberId, config.encryptionKey)) return false;
  reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
  return true;
}
```

在心仪、待恢复心仪、跳过、恢复跳过和创建 AI 会话查找正式会员前调用。聊天申请依赖已存在的正式 AI 会话，无占位入口，保留现有会话归属校验。

- [ ] **Step 4: 运行联系门槛回归**

```powershell
npm.cmd run test --workspace @ai-marriage/api -- --run src/registration-lobby-members.test.ts src/relationship-matching.test.ts src/chat-flow.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交门槛保护**

```powershell
git add apps/api/src/server.ts apps/api/src/registration-lobby-members.test.ts
git commit -m "fix: keep incomplete lobby members out of contact flows"
```

---

### Task 4: 实现占位大厅卡片

**Files:**
- Create: `apps/web/src/components/LobbyMemberCard.tsx`
- Create: `apps/web/src/components/LobbyMemberCard.test.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/useMembers.ts`
- Modify: `apps/web/src/api/useMembers.test.tsx`
- Modify: `apps/web/src/pages/FindPage.tsx`
- Modify: `apps/web/src/pages/FindPage.test.tsx`
- Modify: `apps/web/src/styles/global.css`

- [ ] **Step 1: 写占位卡失败测试**

```tsx
it("新注册占位卡不显示虚构资料和联系按钮", () => {
  render(<MemoryRouter><LobbyMemberCard member={{
    id: "new-opaque",
    lobbyStatus: "new",
    nickname: "新加入会员",
    activeLabel: "资料待完善",
    verified: false,
  }} /></MemoryRouter>);
  expect(screen.getByText("新加入会员")).toBeInTheDocument();
  expect(screen.getByText("资料待完善")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "资料完善中" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /心仪|感兴趣/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/岁|城市|职业/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认组件不存在**

Run: `npm.cmd run test --workspace @ai-marriage/web -- --run src/components/LobbyMemberCard.test.tsx`

Expected: FAIL，无法导入 `LobbyMemberCard`。

- [ ] **Step 3: 实现判别渲染组件**

```tsx
export function LobbyMemberCard({ member }: { member: LobbyMember }) {
  if (member.lobbyStatus === "verified") return <MemberCard member={member} />;
  return (
    <article className={`member-card lobby-placeholder lobby-placeholder--${member.lobbyStatus}`}>
      <div className="member-card__media lobby-placeholder__media" aria-hidden="true"><UserRound /></div>
      <div className="member-card__body">
        <div className="member-card__title"><h3>{member.nickname}</h3></div>
        <p className="lobby-placeholder__status">{member.activeLabel}</p>
        {member.lobbyStatus === "reviewing" && member.city ? <p className="member-card__location"><MapPin />{member.city}{member.job ? ` · ${member.job}` : ""}</p> : null}
        <div className="member-card__actions"><button className="button button--soft button--block" type="button" disabled>资料完善中</button></div>
      </div>
    </article>
  );
}
```

保持与 `MemberCard` 相同的媒体宽高比、正文最小高度和操作区高度，移动端不得产生横向溢出。

- [ ] **Step 4: 接入大厅请求语义**

`useMembers` 增加 `includeIncomplete`，`FindPage` 仅在 `activeFilterCount === 0` 时传入 `true`。查询序列化为 `includeIncomplete=true`；任何主动资料筛选后省略该参数。响应和 Hook 状态改为 `LobbyMember[]`。

- [ ] **Step 5: 更新 FindPage 和文案测试**

把 `MemberCard` 替换为 `LobbyMemberCard`，说明文案改为：

```text
新加入会员会先以安全占位卡展示，完成审核后开放完整资料与联系功能。
```

增加混合列表测试，断言 `new`、`reviewing`、`verified` 三种状态都使用正确组件行为。

- [ ] **Step 6: 运行网页定向测试**

```powershell
npm.cmd run test --workspace @ai-marriage/web -- --run src/components/LobbyMemberCard.test.tsx src/api/useMembers.test.tsx src/pages/FindPage.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交网页实现**

```powershell
git add apps/web/src/components/LobbyMemberCard.tsx apps/web/src/components/LobbyMemberCard.test.tsx apps/web/src/api/client.ts apps/web/src/api/useMembers.ts apps/web/src/api/useMembers.test.tsx apps/web/src/pages/FindPage.tsx apps/web/src/pages/FindPage.test.tsx apps/web/src/styles/global.css
git commit -m "feat: render safe new-member lobby cards"
```

---

### Task 5: 覆盖状态升级和跨重启持久化

**Files:**
- Modify: `apps/api/src/registration-lobby-members.test.ts`
- Modify: `deploy/scripts/persistence-smoke.local.ps1`

- [ ] **Step 1: 写状态转换失败测试**

覆盖以下真实序列：

```text
注册 -> new
提交资料 -> reviewing
审核资料和照片 + 启用 AI -> verified，且列表中只有一张卡
重新提交资料 -> reviewing
主动暂停或管理员停用 -> hidden
账号恢复 -> 按当前资料状态恢复
注销到期 -> hidden
```

每一步都重新请求 `GET /api/members?includeIncomplete=true`，不得直接断言内部 Map 代替公开行为。

- [ ] **Step 2: 运行测试确认转换不完整**

Run: `npm.cmd run test --workspace @ai-marriage/api -- --run src/registration-lobby-members.test.ts`

Expected: FAIL，指出尚未接线的恢复或转换场景。

- [ ] **Step 3: 补齐 API 状态转换接线**

占位投影是读时生成，绝大多数转换不写额外状态。修正所有会留下旧正式 `store.members` 投影的入口，确保资料重提、AI 暂停、账号暂停、管理员停用和注销先删除正式投影，再由大厅读取按真实账号状态决定是否生成占位。

- [ ] **Step 4: 扩展 PostgreSQL/MinIO 冒烟脚本**

在 `persistence-smoke.local.ps1` 中新增独立手机号：注册后读取占位 ID，重启 API 后再次读取并断言相同 `new-...` ID 存在；提交资料后断言状态变为 `reviewing`。不得把手机号或数据库用户 ID写入公开响应断言。

- [ ] **Step 5: 运行集成验证**

Run: `npm.cmd run verify:integration`

Expected: PASS，8 个迁移无待执行项，输出包含新的 `registration-lobby-restored` 步骤。

- [ ] **Step 6: 提交持久化回归**

```powershell
git add apps/api/src/registration-lobby-members.test.ts apps/api/src/server.ts deploy/scripts/persistence-smoke.local.ps1
git commit -m "test: cover lobby placeholders across account lifecycle"
```

---

### Task 6: 文档、完整验证和公网演示

**Files:**
- Modify: `docs/api-contracts.md`
- Modify: `docs/current-implementation-summary.md`
- Modify: `docs/project-status-summary.md`

- [ ] **Step 1: 更新接口和状态文档**

文档必须说明：

```text
GET /api/members 可返回 lobbyStatus=new|reviewing|verified。
new/reviewing 不代表审核通过，不进入推荐或联系流程。
includeIncomplete=true 只在没有主动资料筛选时生效。
占位操作返回 409 MEMBER_PROFILE_INCOMPLETE。
手机号、原始问答和未审核照片不公开。
```

- [ ] **Step 2: 运行完整验证**

Run: `npm.cmd run verify`

Expected: API、Web、基础设施契约、Shared/Web/API 构建和 Prisma 校验全部通过；仅允许已有 Vite chunk 大小提示。

- [ ] **Step 3: 浏览器验收桌面和移动端**

在 `1440x900` 和 `390x844` 检查：注册新账号、游客大厅出现占位卡、登录本人看不到自己、应用筛选后占位卡消失、占位按钮禁用、网格无溢出且控制台无错误。

- [ ] **Step 4: 提交文档和最终验证记录**

```powershell
git add docs/api-contracts.md docs/current-implementation-summary.md docs/project-status-summary.md
git commit -m "docs: document registration lobby states"
```

- [ ] **Step 5: 推送功能提交**

获得明确 GitHub 外发授权后：

```powershell
git push origin codex/design-optimization
```

Expected: 远端分支哈希与本地 `HEAD` 相同。

- [ ] **Step 6: 启动隔离演示栈**

使用独立端口，避免覆盖当前本地数据：

```powershell
$env:DEMO_HTTP_PORT="18080"
$env:DEMO_POSTGRES_PORT="55432"
$env:DEMO_MINIO_API_PORT="19000"
$env:DEMO_MINIO_CONSOLE_PORT="19001"
docker compose -f compose.demo.yml --env-file deploy/demo.env up -d --build
```

确认 `http://127.0.0.1:18080/healthz` 和 `/api/health` 返回成功，数据库和 MinIO 仍只绑定 `127.0.0.1`。

- [ ] **Step 7: 创建 Tunnel 并配置来源白名单**

启动：

```powershell
cloudflared tunnel --url http://127.0.0.1:18080 --no-autoupdate
```

从日志读取唯一的 `https://*.trycloudflare.com` 地址，把该精确 Origin 加入演示 API 的 `CORS_ALLOWED_ORIGINS`，仅重建/重启演示 API 和网关。不得使用 `*`。

- [ ] **Step 8: 验证公网流程并交付关闭方式**

从公网 URL 验证首页、`/api/health`、OTP 请求和验证码 `123456` 登录。交付临时 URL，并说明：

```powershell
Stop-Process -Name cloudflared
$env:DEMO_HTTP_PORT="18080"
$env:DEMO_POSTGRES_PORT="55432"
$env:DEMO_MINIO_API_PORT="19000"
$env:DEMO_MINIO_CONSOLE_PORT="19001"
docker compose -f compose.demo.yml --env-file deploy/demo.env down
```

关闭 Tunnel 后公网地址必须失效。
