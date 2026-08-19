# AI 婚恋网站真实系统落地方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有前端业务路径的基础上，把当前演示版升级为一个可以真实注册、保存资料、上传照片、调用 AI 分身、完成匹配、发起聊天申请并部署运行的最小真实系统。

**Architecture:** 采用模块化单体架构，不拆微服务。继续使用现有 React + Vite + Fastify monorepo，新增 PostgreSQL 作为主数据库，S3 兼容对象存储保存照片，Redis 作为可选的限流和实时消息基础设施，AI 调用集中在 API 服务中。先做一个真实闭环，再逐步增加身份审核、推荐优化、通知和运营能力。

**Tech Stack:** React 19、TypeScript、Vite、Fastify、PostgreSQL、Prisma、Zod、JWT + HttpOnly Cookie、S3 兼容对象存储、WebSocket、Redis（第二阶段）、Vitest、Testing Library、Playwright。

---

## 1. 先说结论

当前列出的功能很多，不适合在 15 天内全部做到生产级。建议把目标拆成两个版本：

### 1.1 15 天真实联络 Demo

15 天内可以真实跑通以下闭环：

1. 用户手机号注册和登录。
2. 用户资料保存到数据库。
3. 建档进度保存和恢复。
4. 图片上传到对象存储。
5. 照片进入待审核状态，由管理员手动通过或拒绝。
6. 真实调用一个大模型生成 AI 分身回复。
7. AI 问答记录保存到数据库。
8. 基于年龄、城市、性别、交往目标和结构化偏好的匹配。
9. 用户发起“感兴趣”和真人聊天申请。
10. 对方在消息中心接受或拒绝申请。
11. 接受后开启一对一真人聊天。
12. 消息保存到数据库，刷新页面后仍然存在。
13. 站内通知显示申请、接受和审核结果。
14. 一个最小管理员页面处理照片和举报。
15. 部署到一台可访问的服务器并配置 HTTPS、数据库备份和错误日志。

### 1.2 暂不放进 15 天核心范围

以下功能应该明确延后，不要为了“看起来完整”而牺牲核心闭环：

- 银行级别的真人身份认证和公安联网核验。
- 自动化视频面审。
- 复杂向量检索和长期记忆。
- 多模型路由和模型自动评测平台。
- 大规模推荐系统和实时特征平台。
- 原生 App 推送。
- 多机房、多地域和自动弹性扩容。
- 完整的客服、财务、会员、付费和运营系统。
- 大规模图片内容审核和人工审核团队协作。
- 完整的企业级权限、审计和数据治理平台。

这里的原则是：15 天交付“真实数据能流转的闭环”，不是交付一个已经具备成熟商业化能力的大型婚恋平台。

## 2. 当前项目与目标系统的差距

当前项目已经完成前端流程，但真实数据边界仍然在浏览器和演示代码中：

| 能力 | 当前状态 | 目标状态 |
| --- | --- | --- |
| 用户注册 | 页面入口 | API + OTP + 用户表 + 会话 |
| 建档 | 前端五步表单 | 草稿和最终资料持久化 |
| 照片 | 演示按钮 | 签名上传 + 对象存储 + 审核状态 |
| 人物资料 | `members.ts` 静态数组 | PostgreSQL 查询和权限过滤 |
| AI 回复 | 前端规则函数 | 后端模型调用 + 资料边界 + 记录 |
| AI 分身 | 页面概念 | 用户授权的结构化 AI 档案 |
| 匹配 | 前端筛选 | 后端候选集和匹配服务 |
| 感兴趣 | 页面跳转 | 数据库关系记录和幂等接口 |
| 聊天申请 | React state | 状态机和双方同意记录 |
| 真人聊天 | 入口和空页面 | 持久消息 + WebSocket |
| 消息通知 | 页面演示 | 站内通知表和未读计数 |
| 身份审核 | 文案说明 | 最小人工审核队列 |
| 后台管理 | 未实现 | 管理员登录、审核、举报处理 |
| 部署 | 本地端口 | Docker/云服务/HTTPS/备份 |

## 3. 推荐系统架构

### 3.1 总体架构

```mermaid
flowchart TB
    U[Web 用户端] --> W[Fastify API]
    A[管理员页面] --> W
    W --> AUTH[认证与权限模块]
    W --> PROFILE[资料与建档模块]
    W --> MEDIA[照片与审核模块]
    W --> MATCH[匹配模块]
    W --> AI[AI 分身模块]
    W --> CHAT[申请与实时聊天模块]
    W --> NOTICE[通知模块]
    W --> DB[(PostgreSQL)]
    W --> OBJ[(S3 对象存储)]
    W --> LLM[大模型 API]
    W -.可选.-> REDIS[(Redis)]
    ADMIN[运营人员] --> A
```

### 3.2 为什么先用模块化单体

目前只有两个人开发，而且目标是 15 天完成真实联络 Demo。模块化单体有三个好处：

- 一个 API 服务即可部署，排查问题简单。
- 认证、资料、AI 和聊天可以共享事务和类型。
- 后续规模变大时，再把 AI、聊天或通知拆成独立服务。

15 天内不建议使用微服务、Kubernetes、消息总线集群或复杂服务网格。它们会增加部署和调试工作，但不会直接提高 Demo 的核心完成度。

### 3.3 推荐的目录结构

```text
ai-marriage-platform-design/
├─ apps/
│  ├─ web/
│  │  └─ src/
│  │     ├─ app/                  路由、API Client、登录态
│  │     ├─ components/           公共页面组件
│  │     ├─ features/
│  │     │  ├─ auth/              登录注册
│  │     │  ├─ onboarding/        建档流程
│  │     │  ├─ members/           匹配大厅和人物详情
│  │     │  ├─ avatar-chat/       AI 分身聊天
│  │     │  ├─ conversations/     真人聊天
│  │     │  └─ admin/             最小后台
│  │     ├─ pages/                现有路由页面
│  │     └─ styles/
│  ├─ api/
│  │  └─ src/
│  │     ├─ app.ts                Fastify 实例和插件注册
│  │     ├─ server.ts             兼容现有测试的服务构建入口
│  │     ├─ start.ts              生产启动入口
│  │     ├─ config/               环境变量解析
│  │     ├─ db/                   Prisma Client、迁移和 seed
│  │     ├─ plugins/              auth、cors、websocket、error handler
│  │     ├─ modules/
│  │     │  ├─ auth/
│  │     │  ├─ users/
│  │     │  ├─ profiles/
│  │     │  ├─ media/
│  │     │  ├─ moderation/
│  │     │  ├─ matching/
│  │     │  ├─ avatar/
│  │     │  ├─ chat/
│  │     │  ├─ notifications/
│  │     │  └─ admin/
│  │     └─ shared/                分页、错误、鉴权工具
│  └─ admin/                       第二阶段可拆出的后台前端
├─ packages/
│  └─ shared/
│     ├─ src/contracts/             API 请求和响应类型
│     └─ src/domain/                领域枚举和状态类型
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
└─ infra/
   ├─ docker-compose.yml
   ├─ Dockerfile.api
   ├─ Dockerfile.web
   └─ nginx.conf
```

现有 `pages` 不需要第一天全部重构。第一阶段只增加 API Client、登录态和真实数据适配，保留已经通过验收的页面布局。

## 4. 数据库设计

### 4.1 设计原则

- 用户身份、公开资料、私密问答、AI 摘要分开存储。
- 原始问答不直接暴露给其他用户。
- 公开资料必须经过审核和隐私过滤。
- 所有关键状态使用枚举和状态转换，不用前端自行猜测。
- 所有重要写操作支持幂等，防止重复点击产生重复记录。
- 删除用户时保留必要的审计记录，但删除或匿名化可识别内容。

### 4.2 核心数据表

#### `users`

存储账户身份，不存储公开个人介绍。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 用户主键 |
| `phone_hash` | string unique | 规范化手机号的不可逆哈希，用于登录查询 |
| `phone_encrypted` | string | 加密手机号，仅用于必要通知 |
| `status` | enum | `active`、`suspended`、`deleted` |
| `role` | enum | `user`、`moderator`、`admin` |
| `created_at` | datetime | 创建时间 |
| `last_login_at` | datetime | 最后登录时间 |

手机号不要以明文出现在日志、错误信息或普通查询结果中。

#### `otp_requests`

存储短信验证码请求记录，不存储明文验证码。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 请求主键 |
| `phone_hash` | string | 规范化手机号哈希 |
| `code_hash` | string | 验证码哈希 |
| `purpose` | enum | `login`、`register` |
| `attempts` | int | 已尝试次数 |
| `expires_at` | datetime | 过期时间 |
| `used_at` | datetime nullable | 使用时间 |
| `ip_hash` | string nullable | 限流用的 IP 哈希 |

#### `sessions`

建议使用短期 Access Token + 长期 Refresh Token，Refresh Token 只放 HttpOnly、Secure、SameSite Cookie。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 会话主键 |
| `user_id` | UUID | 所属用户 |
| `refresh_token_hash` | string | 只保存哈希 |
| `user_agent` | string nullable | 风险识别，不展示给其他用户 |
| `expires_at` | datetime | 过期时间 |
| `revoked_at` | datetime nullable | 注销时间 |

#### `profiles`

存储用户公开资料。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | UUID unique | 与用户一对一 |
| `nickname` | string | 昵称 |
| `gender` | enum | 性别 |
| `birth_year` | int | 出生年份，接口通常转换为年龄 |
| `city` | string | 城市 |
| `district` | string nullable | 区域，可选择不公开 |
| `job_category` | string nullable | 职业大类 |
| `marital_status` | enum | 婚姻状态 |
| `goal` | enum | 交往目标 |
| `introduction` | text nullable | 公开介绍 |
| `profile_status` | enum | `draft`、`pending_review`、`approved`、`rejected` |
| `visibility` | enum | `private`、`approved_only`、`public` |
| `updated_at` | datetime | 更新时间 |

#### `onboarding_answers`

存储原始问答，必须限制访问。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 所属用户 |
| `question_id` | string | 固定问题标识 |
| `answer_ciphertext` | text | 应用层加密后的回答 |
| `version` | int | 问题版本 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

不要把原始回答直接传给匹配大厅、其他用户或管理员普通列表。

#### `photos`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 所属用户 |
| `object_key` | string unique | 对象存储 Key |
| `mime_type` | string | 允许的图片类型 |
| `size_bytes` | int | 文件大小 |
| `width` / `height` | int | 图片尺寸 |
| `is_primary` | boolean | 是否主图 |
| `review_status` | enum | `pending`、`approved`、`rejected` |
| `review_reason` | string nullable | 审核原因 |
| `reviewed_by` | UUID nullable | 审核管理员 |
| `created_at` | datetime | 上传时间 |

只有 `approved` 的照片才能生成公开访问 URL。

#### `ai_profiles`

存储经用户授权、整理和过滤后的 AI 分身资料，不等同于原始问答。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | UUID unique | 所属用户 |
| `version` | int | 当前版本 |
| `summary_json` | JSONB | 允许 AI 使用的结构化资料 |
| `forbidden_topics_json` | JSONB | 不允许回答的主题 |
| `consent_status` | enum | `pending`、`enabled`、`paused`、`revoked` |
| `generated_at` | datetime | 生成时间 |
| `approved_at` | datetime nullable | 用户确认时间 |

AI 只读取 `consent_status = enabled` 且版本已确认的内容。

#### `ai_sessions`、`ai_messages`、`ai_topics`

用于保存 AI 分身聊天和了解进度。

- `ai_sessions`：用户与某个 AI 分身的会话。
- `ai_messages`：用户问题、AI 回复、模型版本、耗时和安全拦截结果。
- `ai_topics`：`life_style`、`relationship_goal`、`communication` 等了解主题的完成情况。

AI 消息必须记录：

- `sender`：`user` 或 `avatar`。
- `content`：内容正文或加密内容。
- `model_name`：模型名称。
- `prompt_version`：后端 Prompt 版本，不返回给用户。
- `moderation_status`：是否通过安全检查。
- `created_at`：创建时间。

#### `interests`、`matches`

- `interests`：记录用户对某人的感兴趣操作，唯一键为 `(from_user_id, to_user_id)`。
- `matches`：记录系统生成的推荐关系和推荐原因，唯一键为有序用户对。

`matches` 可以保存内部计算信息，但公开接口只返回普通语言的共同点，不返回内部权重和总分。

#### `chat_requests`

| 状态 | 含义 |
| --- | --- |
| `ai_learning` | 正在通过 AI 分身了解 |
| `ready` | 已满足申请条件 |
| `pending` | 已发起真人聊天申请 |
| `accepted` | 对方同意 |
| `rejected` | 对方拒绝 |
| `expired` | 超时未处理 |
| `blocked` | 任一方拉黑或风控终止 |

唯一键建议为 `(requester_id, target_id)`，重复点击使用 `upsert` 或返回已有申请。

#### `conversations`、`conversation_members`、`messages`

- `conversations`：一对一会话及状态。
- `conversation_members`：会话参与者。
- `messages`：消息正文、发送者、客户端消息 ID、发送时间和撤回时间。

客户端发送消息时必须携带 `client_message_id`，服务端以 `(conversation_id, sender_id, client_message_id)` 做幂等约束，避免网络重试产生重复消息。

#### `notifications`、`reports`、`blocks`、`audit_logs`

- `notifications`：站内通知、已读状态和通知类型。
- `reports`：举报对象、原因、描述、状态和处理人。
- `blocks`：用户互相屏蔽关系。
- `audit_logs`：审核、封禁、删除、权限变化和敏感操作记录。

## 5. 认证与权限

### 5.1 登录流程

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant API as API
    participant SMS as 短信服务
    participant DB as 数据库

    B->>API: POST /auth/otp/request
    API->>API: 规范化手机号、限流、生成验证码哈希
    API->>SMS: 发送验证码
    API->>DB: 保存 otp_requests
    B->>API: POST /auth/otp/verify
    API->>DB: 校验未过期验证码
    API->>DB: 创建或读取用户
    API->>DB: 创建会话
    API-->>B: 用户资料 + HttpOnly Refresh Cookie
```

### 5.2 必须提供的认证接口

```text
POST /api/auth/otp/request
POST /api/auth/otp/verify
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/me
```

开发环境可以提供固定测试验证码，但必须通过 `NODE_ENV !== production` 限制，生产环境禁止返回验证码或写入日志。

### 5.3 权限角色

| 角色 | 能力 |
| --- | --- |
| `user` | 修改自己的资料、管理自己的 AI 分身、浏览公开资料、聊天 |
| `moderator` | 审核照片、处理举报、查看必要的公开资料 |
| `admin` | 管理用户状态、管理员、系统配置和审计记录 |

管理员权限必须后端校验，不能只依赖前端隐藏菜单。

### 5.4 认证安全要求

- Access Token 短期有效，Refresh Token 轮换并只保存哈希。
- Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax` 或更严格策略。
- 写操作校验 CSRF，或采用严格的 Bearer Token 架构并不使用 Cookie 写操作。
- OTP 请求按手机号、IP、设备和时间窗口限流。
- 登录错误不要暴露“手机号是否注册”。
- 管理员必须使用更强的二次验证或至少独立密码登录。
- 所有敏感操作写审计日志。

## 6. 照片上传与真人审核

### 6.1 上传流程

不建议把图片通过 API 服务中转，推荐签名直传：

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant API as API
    participant S3 as 对象存储
    participant MOD as 审核服务

    B->>API: POST /me/photos/upload-url
    API->>API: 校验用户、类型、大小和数量
    API->>S3: 生成短期上传签名
    API-->>B: upload_url + object_key
    B->>S3: PUT 图片文件
    B->>API: POST /me/photos/complete
    API->>S3: 检查对象存在、大小和 MIME
    API->>MOD: 发起内容审核或进入人工队列
    API-->>B: photo.status = pending
```

### 6.2 15 天内的最小实现

- 限制 JPG、PNG、WebP。
- 单张大小不超过 8 MB。
- 限制每个用户最多 6 张照片。
- 服务端重新读取文件头验证真实类型，不能只信任扩展名。
- 生成缩略图和公开展示图。
- 去除 EXIF 位置信息。
- 所有新照片默认 `pending`。
- 管理员在后台点击“通过”或“拒绝”。
- 只有通过照片才能出现在匹配大厅。
- 拒绝时必须给用户可理解的原因。

### 6.3 后续增强

- 接入图片内容安全审核。
- 人脸数量和清晰度检测。
- 头像与本人身份材料的一致性核验。
- 风险图片隔离桶。
- 违规图片自动下架和审计。

真实身份审核涉及身份证、活体、人脸和隐私数据，不能为了 Demo 随意自建。需要选择合规的第三方实名服务，并单独评估个人信息保护、数据留存和跨境传输问题。

## 7. 建档与 AI 分身知识库

### 7.1 建档数据流

```mermaid
flowchart LR
    A[用户填写基本资料] --> B[保存 onboarding draft]
    B --> C[上传照片并等待审核]
    C --> D[回答关系问题]
    D --> E[敏感信息检测]
    E --> F[生成结构化 AI 档案]
    F --> G[用户查看允许使用的摘要]
    G --> H[用户确认 AI 分身已启用]
```

### 7.2 AI 分身不直接等于“复制用户”

AI 分身的合理定义是：

> 依据用户主动提供、明确授权、经过过滤的资料，回答关于生活习惯、交往期待和沟通方式的有限问题。

它不是：

- 用户本人。
- 用户实时在线。
- 用户的全量记忆。
- 可以代表用户承诺或做决定的代理人。
- 可以提供联系方式或诱导线下转账的工具。

### 7.3 推荐的 AI 档案格式

```json
{
  "profileVersion": 3,
  "approvedFacts": [
    { "topic": "life_style", "fact": "周末喜欢散步、阅读和做家常菜" },
    { "topic": "communication", "fact": "更习惯直接、平和地讨论分歧" }
  ],
  "relationshipExpectations": [
    "希望从认真了解开始",
    "重视彼此尊重和稳定沟通"
  ],
  "boundaries": [
    "不公开联系方式",
    "不回答未授权的隐私问题"
  ],
  "unknownResponse": "这个问题我没有得到 TA 的明确授权，建议等你们本人聊天时再确认。"
}
```

### 7.4 AI 生成流程

1. 读取用户已确认的问答。
2. 做手机号、地址、身份证、单位详细信息等敏感信息检测。
3. 把原始回答整理成结构化事实。
4. 生成一版用户可查看的 AI 分身摘要。
5. 用户确认摘要和授权范围。
6. 保存 `ai_profile` 版本。
7. AI 聊天只读取当前启用版本。
8. 用户修改资料时生成新版本，旧版本保留审计但不再用于回答。

15 天内不需要向量数据库。先使用结构化 JSON 和少量经过审核的摘要事实，只有出现大量长文本资料后才考虑 PostgreSQL `pgvector`。

### 7.5 AI 提示词边界

后端 Prompt 至少要包含：

- 明确身份：你是某用户授权的 AI 分身，不是本人。
- 只能依据 `approvedFacts` 回答。
- 不知道就明确说不知道，不编造事实。
- 不提供手机号、微信、住址和第三方隐私。
- 不代表用户做出婚姻、财务、医疗或法律承诺。
- 不引导转账、投资、借款或危险线下行为。
- 不评价或推断用户的疾病、收入、性取向、政治立场等敏感属性。
- 回复简短、温和、易读，适合 35-60 岁用户。

### 7.6 AI 请求接口

```text
POST /api/avatar-sessions
GET  /api/avatar-sessions/:sessionId
GET  /api/avatar-sessions/:sessionId/messages
POST /api/avatar-sessions/:sessionId/messages
POST /api/avatar-sessions/:sessionId/report
POST /api/me/ai-profile/enable
POST /api/me/ai-profile/pause
GET  /api/me/ai-profile/preview
```

后端 `POST messages` 的处理顺序：

1. 校验登录态和会话权限。
2. 校验对方 AI 分身仍是 `enabled`。
3. 校验输入长度、频率和敏感内容。
4. 识别问题所属主题。
5. 读取允许使用的 AI 档案。
6. 调用模型。
7. 对输出做安全过滤和联系方式检查。
8. 保存用户消息和 AI 回复。
9. 更新主题进度。
10. 返回消息和当前进度。

## 8. 匹配算法的第一版做法

### 8.1 不要第一天做复杂 AI 推荐

第一版匹配需要稳定、可解释和容易调试。推荐顺序：

1. 硬过滤：性别、年龄、城市、婚姻状态、交往目标、资料审核、是否屏蔽。
2. 互相条件检查：对方的年龄和城市要求也必须接受当前用户。
3. 结构化偏好得分：生活方式、沟通方式、关系目标、距离等。
4. 活跃度和资料完整度作为轻量排序因素。
5. 生成 1-2 条普通语言的推荐理由。

### 8.2 内部评分示例

以下权重只作为后端内部实现示例，不能展示给用户，也不应在页面中写死：

```text
relationship_goal   30
communication_style 25
life_style          20
city_distance       15
profile_completeness 10
```

实际权重需要用测试数据和人工评审校准。不要把匹配分数直接当作“你们适合结婚”的结论，前端只展示“共同点”和“建议进一步了解”。

### 8.3 匹配接口

```text
GET  /api/members?city=上海&minAge=40&maxAge=55&goal=认真交往
GET  /api/members/:memberId
POST /api/members/:memberId/interest
DELETE /api/members/:memberId/interest
GET  /api/matches
GET  /api/matches/:matchId
```

公开接口必须过滤掉：手机号、详细住址、原始问答、内部得分、Prompt、管理员备注和风险标签。

### 8.4 后续算法升级

在有足够的真实交互数据后，再考虑：

- 推荐点击和深入了解率。
- 双方回复率和聊天持续时间。
- 用户主动反馈的“不合适”原因。
- 推荐结果的多样性和公平性。
- 人工抽样评估，而不是只追求点击率。

禁止使用未经同意的敏感属性推断用户价值或婚配资格。

## 9. AI 了解与真人聊天状态机

### 9.1 用户关系状态

```mermaid
stateDiagram-v2
    [*] --> Viewed
    Viewed --> Interested: 用户点击感兴趣
    Interested --> AiLearning: 开始 AI 分身聊天
    AiLearning --> Ready: 完成规定主题
    Ready --> Requested: 发起真人聊天申请
    Requested --> Accepted: 对方同意
    Requested --> Rejected: 对方拒绝
    Requested --> Expired: 超时未处理
    Accepted --> Chatting: 创建会话
    Chatting --> Blocked: 任一方拉黑
    Interested --> Blocked: 任一方拉黑
```

### 9.2 关键规则

- `Ready` 只代表达到产品定义的了解条件，不代表算法认定双方适合。
- 真人聊天必须由申请方发起、接收方明确同意。
- 接受后才创建可发送消息的会话。
- 拒绝、拉黑、举报后立即阻止新消息。
- 申请、接受、拒绝和拉黑都必须由后端判断权限。
- 前端按钮可以重复点击，但后端必须返回同一个最终状态。

### 9.3 申请接口

```text
POST /api/chat-requests
GET  /api/chat-requests
POST /api/chat-requests/:requestId/accept
POST /api/chat-requests/:requestId/reject
POST /api/users/:userId/block
DELETE /api/users/:userId/block
POST /api/reports
```

## 10. 真人实时聊天

### 10.1 第一版实现

推荐使用 Fastify WebSocket：

- HTTP API 负责创建会话、拉取历史消息和分页。
- WebSocket 负责在线消息和已读回执。
- PostgreSQL 保存所有已确认消息。
- 每条消息有服务端 ID 和客户端幂等 ID。
- 断线后通过历史消息接口补齐。
- 单机部署时不需要 Redis。

### 10.2 WebSocket 事件

```text
client -> server: auth
client -> server: message.send
client -> server: message.read
client -> server: typing.start
client -> server: typing.stop

server -> client: auth.ok
server -> client: message.accepted
server -> client: message.created
server -> client: message.read
server -> client: error
server -> client: conversation.blocked
```

### 10.3 发送消息流程

1. WebSocket 建立后验证登录会话。
2. 校验用户是会话成员。
3. 校验会话状态为 `active`。
4. 校验消息长度和敏感内容。
5. 用客户端消息 ID 做幂等查询。
6. 写入数据库事务。
7. 返回 `message.accepted`。
8. 推送给在线的另一方。
9. 创建未读通知。

第一版不做复杂的语音、视频、文件和阅后即焚消息，避免隐私和存储风险扩大。

## 11. 消息推送策略

分三层实现：

### 第一层：站内通知，15 天内完成

- 审核通过或拒绝。
- 收到真人聊天申请。
- 对方接受申请。
- 收到新真人消息。
- 消息中心显示未读数量。

### 第二层：短信通知，按需接入

只用于验证码和极少数重要提醒，默认不发送聊天内容。短信服务需要配置模板、签名和频率限制。

### 第三层：原生推送，后续实现

需要 Web Push、iOS/Android 推送或小程序订阅消息，和当前 Web Demo 分开排期。

## 12. 最小管理后台

### 12.1 15 天内必须有的页面

1. 管理员登录。
2. 照片审核队列。
3. 举报列表。
4. 用户状态查看。
5. 禁用、解禁和拉黑操作。
6. 审核处理记录。

### 12.2 照片审核字段

- 用户昵称和用户 ID。
- 照片预览。
- 上传时间。
- 当前审核状态。
- 通过按钮。
- 拒绝按钮。
- 拒绝原因下拉选项。
- 管理员备注。

### 12.3 管理后台不能做的事

- 不允许普通管理员查看用户完整原始问答。
- 不允许把手机号批量导出。
- 不允许无审计地修改用户资料。
- 不允许通过 URL 绕过权限读取未审核图片。
- 不允许把 AI 内部 Prompt 显示在运营页面。

## 13. API 设计规范

### 13.1 统一响应格式

成功：

```json
{
  "data": {},
  "requestId": "req_01..."
}
```

失败：

```json
{
  "error": {
    "code": "PROFILE_NOT_READY",
    "message": "请先完成基本资料",
    "fields": {}
  },
  "requestId": "req_01..."
}
```

前端只依赖稳定的 `code`，展示文案可以由前端或服务端统一管理。

### 13.2 必须使用的规则

- 所有请求体用 Zod 或同类库验证。
- 所有列表接口支持 `limit`、`cursor` 和最大页大小。
- 所有写接口返回明确的状态和资源 ID。
- 关键写接口支持 `Idempotency-Key`。
- 不把数据库异常原文返回给浏览器。
- 每个请求记录 `requestId`，日志中不记录敏感正文。

## 14. 15 天开发排期

以下按两个人开发安排。A 负责后端、数据、AI 和部署；B 负责前端接入、后台页面、联调和验收。每天都要合并到同一分支或通过明确的接口契约联调。

### Day 1：冻结范围和环境

**A：**

- 建立 Prisma、PostgreSQL Docker Compose。
- 建立环境变量解析和数据库连接。
- 创建第一版 schema 和 migration。
- 写 seed：测试用户、公开资料、审核通过照片。

**B：**

- 建立 API Client、请求错误处理和登录态读取。
- 把现有静态成员类型整理为 API contract。
- 确认页面 loading、error、empty 三种状态。

**当天验收：** 新数据库可启动，`GET /api/health` 和 `GET /api/members` 从数据库返回数据。

### Day 2：手机号认证

**A：**

- 实现 OTP 请求、哈希、过期和限流。
- 实现 OTP 验证、用户创建和会话。
- 加入开发环境固定验证码开关。

**B：**

- 接通登录页。
- 增加登录成功、验证码错误、验证码过期、频率限制状态。
- 路由保护建档、AI 聊天和消息页面。

**当天验收：** 测试账号可以注册、刷新页面仍保持登录、退出后受保护页面不可访问。

### Day 3：真实用户资料和建档草稿

**A：**

- 实现 `profiles` 和 `onboarding_answers` CRUD。
- 增加字段级权限过滤。
- 保存草稿、完成建档和资料审核状态。

**B：**

- 将五步建档改为读取当前用户数据。
- 加入保存草稿 API。
- 处理刷新恢复、提交失败和字段错误。

**当天验收：** 用户填写一半后刷新，换浏览器重新登录仍能继续填写。

### Day 4：对象存储和照片上传

**A：**

- 配置 S3 兼容对象存储。
- 实现签名上传 URL、完成上传和照片列表接口。
- 校验文件类型、大小、数量和对象存在。

**B：**

- 接通文件选择、上传进度、失败重试和删除照片。
- 显示待审核状态。
- 处理主图选择和照片排序。

**当天验收：** 上传后的图片能在对象存储中看到，刷新页面仍然存在，但待审核图片不会出现在匹配大厅。

### Day 5：最小人工审核

**A：**

- 实现管理员角色和照片审核接口。
- 实现审核记录、拒绝原因和公开 URL 权限。

**B：**

- 创建最小管理员审核页面。
- 实现通过、拒绝、查看下一张。
- 用户端显示审核中、通过和拒绝状态。

**当天验收：** 管理员通过照片后，用户照片进入匹配大厅；拒绝后用户能看到原因。

### Day 6：匹配大厅真实数据

**A：**

- 将现有前端筛选改成 API 查询。
- 实现硬过滤、屏蔽过滤、资料审核过滤和分页。
- 加入公开字段 DTO。

**B：**

- 接通匹配大厅和人物详情。
- 加入加载骨架、错误重试和空状态。
- 保留已经验收的照片优先布局。

**当天验收：** 两个不同用户看到的候选人结果按权限变化，不能看到未审核资料。

### Day 7：感兴趣和推荐关系

**A：**

- 实现 interests 和 matches。
- 加入唯一约束和幂等。
- 实现第一版结构化匹配排序。

**B：**

- 接通感兴趣按钮。
- 将推荐原因改为 API 返回的普通语言描述。
- 加入重复点击和网络重试测试。

**当天验收：** 用户重复点击感兴趣不会生成重复记录，另一方看不到不应公开的内部评分。

### Day 8：AI 档案生成

**A：**

- 实现 AI profile 生成任务。
- 接入模型供应商 SDK 或 HTTP API。
- 增加敏感信息过滤、输出校验和用户授权状态。
- 保存模型版本和 Prompt 版本。

**B：**

- 增加 AI 分身授权预览页面。
- 让用户看到“AI 可以使用什么”和“不会回答什么”。
- 接通启用、暂停和重新生成操作。

**当天验收：** 用户没有确认 AI 档案时，对方不能开启 AI 分身聊天；暂停后旧会话不能继续回答。

### Day 9：AI 分身聊天持久化

**A：**

- 实现 AI session、message、topic 接口。
- 加入会话权限、频率限制、模型错误兜底和消息记录。
- 完成三个主题的状态更新。

**B：**

- 接通现有 AI 聊天页面。
- 增加历史消息加载和发送中状态。
- 将 `0/3` 进度改为后端返回。

**当天验收：** 刷新页面后历史消息仍在，AI 档案暂停后页面清楚提示不可用。

### Day 10：真人聊天申请状态机

**A：**

- 实现 chat request 状态机和数据库事务。
- 处理申请、接受、拒绝、过期、拉黑和幂等。
- 增加权限和状态转换测试。

**B：**

- 接通申请按钮和消息中心。
- 显示申请中、已接受、已拒绝和已结束状态。
- 处理重复提交、刷新和错误恢复。

**当天验收：** 只有满足条件并得到对方明确同意后，双方才看到“真人聊天已开启”。

### Day 11：真人聊天历史消息

**A：**

- 实现 conversations、members、messages 表和 HTTP 历史接口。
- 实现消息长度、频率、敏感信息和幂等校验。

**B：**

- 创建真人聊天页面。
- 接通历史消息、分页、发送、失败重试。
- 增加网络断开提示。

**当天验收：** 双方可以在同一会话中发送文字，刷新后历史消息不丢失。

### Day 12：WebSocket 实时消息

**A：**

- 接入 Fastify WebSocket。
- 实现连接鉴权、消息发送、广播、断线和已读回执。
- 保存消息成功后再推送给另一方。

**B：**

- 接入 WebSocket 客户端。
- 实现在线消息、发送中、已发送和失败状态。
- 在断线后重新拉取历史消息。

**当天验收：** 两个浏览器窗口可以实时收发消息，断开网络后恢复不会产生重复消息。

### Day 13：站内通知和安全处理

**A：**

- 实现 notifications、reports、blocks 接口。
- 加入敏感内容拦截、举报和拉黑后禁止通信。
- 增加安全日志和基础限流。

**B：**

- 接通通知列表和未读数。
- 接通举报、拉黑和结束聊天按钮。
- 增加诈骗和线下见面安全提示。

**当天验收：** 拉黑后消息发送失败，举报记录进入管理员队列，通知能显示申请和审核结果。

### Day 14：部署和端到端联调

**A：**

- 编写 Dockerfile 和生产环境配置。
- 部署 PostgreSQL、API、Web 和对象存储连接。
- 配置 HTTPS、域名、健康检查、错误日志和数据库备份。

**B：**

- 用两个真实测试账号执行完整流程。
- 补齐 loading、error、empty、权限拒绝和移动端状态。
- 记录所有阻塞问题和回归用例。

**当天验收：** 测试环境 URL 可以从注册走到真人聊天，核心 API 没有 5xx。

### Day 15：维护、修复和交付

**A：**

- 修复最高优先级问题。
- 检查备份恢复、日志脱敏、管理员权限和环境变量。
- 输出部署和回滚说明。

**B：**

- 完成桌面和手机浏览器验收。
- 补全用户操作说明和管理员操作说明。
- 输出已知问题、后续排期和演示账号说明。

**当天验收：** 测试报告、部署文档、接口文档、回滚方式和下一阶段清单齐全。

## 15. 两个人的具体分工

### A：后端、AI、数据和部署

负责以下目录和交付物：

- `apps/api/src/config`
- `apps/api/src/db`
- `apps/api/src/plugins`
- `apps/api/src/modules/auth`
- `apps/api/src/modules/profiles`
- `apps/api/src/modules/media`
- `apps/api/src/modules/matching`
- `apps/api/src/modules/avatar`
- `apps/api/src/modules/chat`
- `apps/api/src/modules/notifications`
- `apps/api/src/modules/admin`
- `prisma/`
- `infra/`

每日交付：

- 接口路径和请求响应示例。
- 数据库迁移。
- 错误码。
- 测试账号或 seed 数据。
- API 测试结果。

### B：前端、后台页面和 QA

负责以下目录和交付物：

- `apps/web/src/app`
- `apps/web/src/features/auth`
- `apps/web/src/features/onboarding`
- `apps/web/src/features/members`
- `apps/web/src/features/avatar-chat`
- `apps/web/src/features/conversations`
- `apps/web/src/features/admin`
- 现有 `apps/web/src/pages` 的真实 API 接入。

每日交付：

- 页面状态和接口接入。
- 手机和桌面验收。
- 页面测试。
- 接口异常的复现步骤。
- 每日联调记录。

### 两个人共同负责

- 每天固定一次接口联调。
- 任何接口改动必须同步更新 `packages/shared` contract。
- 每个状态转换至少有一个成功测试和一个拒绝测试。
- 不在聊天工具里只口头改变字段名，必须更新文档或代码。
- 每天结束前合并可运行版本。

## 16. 环境变量规划

```env
# Runtime
NODE_ENV=development
API_PORT=4184
WEB_ORIGIN=http://127.0.0.1:4183

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_marriage

# Auth
ACCESS_TOKEN_SECRET=change-me
REFRESH_TOKEN_SECRET=change-me
OTP_PROVIDER=mock
OTP_SIGN_NAME=
OTP_TEMPLATE_ID=
OTP_ACCESS_KEY=
OTP_ACCESS_SECRET=

# Object storage
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=ai-marriage-photos
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_PUBLIC_BASE_URL=

# AI
LLM_PROVIDER=mock
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=

# Optional Redis
REDIS_URL=redis://localhost:6379

# Operations
LOG_LEVEL=info
ADMIN_SEED_PHONE=
```

要求：

- `.env` 不提交 Git。
- 生产密钥只放部署平台的 Secret 管理器。
- `LLM_API_KEY`、对象存储密钥和短信密钥绝不能发送到浏览器。
- `OTP_PROVIDER=mock` 只能在开发和测试环境使用。

## 17. 安全、隐私和维护底线

### 17.1 数据安全

- 数据库使用最小权限账号。
- 生产数据库强制 TLS。
- 原始问答、手机号和管理员备注按敏感数据处理。
- 日志禁止记录 OTP、Token、手机号、身份证、详细地址和完整聊天正文。
- 图片使用短期签名 URL，不公开对象存储桶。
- 数据库每天备份，至少保留一份异地备份。
- 删除账号时执行资料下架、照片删除和数据匿名化策略。

### 17.2 AI 安全

- AI 分身必须显示“不是本人实时回复”。
- 用户可以暂停、重新授权和删除 AI 分身。
- AI 不提供联系方式、借款、转账、医疗、法律或投资承诺。
- 对用户输入和模型输出分别做安全检查。
- 模型超时或失败时返回可理解的重试提示，不泄露供应商错误。
- 记录模型版本和 Prompt 版本，方便回溯问题。

### 17.3 婚恋平台特有风险

- 不把匹配分数表述成婚姻结果保证。
- 不使用未经同意的敏感特征推断用户。
- 不向未授权用户展示手机号、微信、住址和原始问答。
- 不允许用户绕过双方同意直接开启真人聊天。
- 提供举报、拉黑、结束了解和安全提示。
- 首次线下见面提示公共场所和告知亲友。
- 真正上线前必须进行法律、隐私和内容安全评估，不能仅凭 Demo 逻辑上线。

## 18. 测试方案

### 18.1 API 单元测试

至少覆盖：

- OTP 过期、错误次数和频率限制。
- 未登录访问保护接口返回 `401`。
- 非本人访问资料编辑返回 `403`。
- 未审核照片不会进入公开查询。
- AI 分身暂停后无法创建新回答。
- 申请重复提交不会产生两条记录。
- 拒绝后不能发送真人消息。
- 拉黑后不能继续聊天。
- 消息使用相同客户端 ID 时不会重复保存。

### 18.2 前端组件测试

- 登录成功、失败和退出。
- 建档保存、恢复和提交。
- 上传进度、失败重试和审核状态。
- 匹配筛选和分页。
- AI 历史消息和 `3/3` 状态。
- 申请接受、拒绝和错误提示。
- WebSocket 断线和恢复。
- 管理员审核通过和拒绝。

### 18.3 端到端测试

使用两个测试用户：

```text
用户 A：发起感兴趣、AI 了解和真人聊天申请
用户 B：查看申请、接受申请、发送真人消息
管理员：审核 A/B 的照片、处理举报
```

完整场景：

1. A 注册并完成建档。
2. A 上传照片，管理员审核通过。
3. A 在匹配大厅看到 B。
4. A 查看 B 的公开资料并点击感兴趣。
5. A 与 B 的 AI 分身完成三个主题。
6. A 发起真人聊天申请。
7. B 在消息中心接受申请。
8. A 和 B 在两个浏览器窗口实时聊天。
9. A 拉黑 B，B 后续发送消息失败。
10. 管理员查看审计记录和举报记录。

## 19. 部署方案

### 19.1 本地开发

```text
Web:       127.0.0.1:4183
API:       127.0.0.1:4184
Postgres:  127.0.0.1:5432
MinIO:     127.0.0.1:9000
Redis:     127.0.0.1:6379，可选
```

使用 Docker Compose 启动 PostgreSQL 和 MinIO，API 和 Web 仍可用本地热更新启动。

### 19.2 测试环境

- 一个 API 实例。
- 一个 Web 静态站点。
- 托管 PostgreSQL。
- S3 兼容对象存储。
- HTTPS 域名。
- 单独的测试短信配置或测试验证码。
- 独立数据库和存储桶，不能与生产混用。

### 19.3 生产环境最低要求

- HTTPS。
- 数据库自动备份。
- API 健康检查。
- 统一错误日志。
- 进程崩溃自动重启。
- 管理员二次验证或独立安全入口。
- 对象存储权限隔离。
- 速率限制和基础 WAF。
- 回滚到上一版本的方式。

15 天内可以部署单实例，但必须把数据库和对象存储放在可靠的托管服务上，不要把用户照片和数据库只放在开发电脑里。

## 20. 15 天结束时的交付清单

### 代码

- [ ] API 模块和路由。
- [ ] Prisma schema 和迁移。
- [ ] 数据库 seed。
- [ ] Web API Client。
- [ ] 登录态管理。
- [ ] 真实建档。
- [ ] 照片上传。
- [ ] AI 分身接口。
- [ ] 匹配接口。
- [ ] 聊天申请。
- [ ] 真人聊天。
- [ ] 站内通知。
- [ ] 最小管理员页面。

### 文档

- [ ] `.env.example`。
- [ ] 本地启动文档。
- [ ] 数据库迁移文档。
- [ ] API 接口文档。
- [ ] 管理员操作文档。
- [ ] 部署文档。
- [ ] 回滚文档。
- [ ] 已知问题清单。
- [ ] 15 天后的扩展排期。

### 验收

- [ ] 两个测试用户能完整完成主流程。
- [ ] 管理员能审核照片。
- [ ] 未审核资料不会公开。
- [ ] AI 对话刷新后仍存在。
- [ ] 真人聊天需要双方同意。
- [ ] 实时聊天刷新后消息不丢失。
- [ ] 拉黑和举报有效。
- [ ] 生产密钥未进入 Git。
- [ ] 数据库可备份和恢复。
- [ ] 手机端和桌面端无阻塞问题。

## 21. 哪些决定现在就要定下来

为了不让两个人在开发中反复返工，建议现在固定以下决定：

1. 数据库使用 PostgreSQL。
2. ORM 使用 Prisma。
3. 图片使用 S3 兼容对象存储，不存 API 服务器本地磁盘。
4. 登录使用手机号 OTP，开发环境使用 Mock Provider。
5. 登录态使用 HttpOnly Refresh Cookie。
6. AI 先使用结构化资料，不在 15 天内引入向量数据库。
7. 匹配第一版使用结构化条件和内部评分，不把分数展示给用户。
8. 真人聊天使用 WebSocket + PostgreSQL。
9. 通知第一版只做站内通知，短信只用于验证码。
10. 身份审核第一版采用人工照片和资料审核，不在 Demo 内收集身份证和活体信息。
11. 部署先单实例，等真实用户量出现后再引入 Redis 和多实例扩展。

## 22. 最终判断

当前项目的前端流程已经足够作为真实系统的入口，下一步不应该继续堆叠静态页面，而应该围绕一个最小真实闭环推进：

```text
注册
  -> 建档
  -> 上传照片
  -> 管理员审核
  -> 看到公开用户
  -> AI 分身聊天
  -> 发起真人聊天申请
  -> 对方接受
  -> 真人聊天
```

只要这条链路使用真实数据库、真实图片存储、真实 AI 服务和真实聊天消息保存，项目就从“前端演示”进入了“可联络 Demo”。之后再逐步增强身份审核、推荐质量、推送、后台和生产级安全，而不是一开始同时建设所有大型系统。
