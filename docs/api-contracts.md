# 当前 API 契约

> 更新时间：2026-08-14
>
> 事实来源：`apps/api/src/server.ts`、`apps/web/src/api/client.ts`、`apps/api/src/matching/` 与 `packages/shared/src/`。
>
> 本文记录当前运行时接口，不是未来目标设计。若文档与代码冲突，以 `apps/api/src/server.ts` 为准。

## 1. 通用约定

- 本地 API：`http://127.0.0.1:4184`，基础路径 `/api`。
- JSON 请求使用 `Content-Type: application/json`，前端使用 `credentials: "include"`。
- 登录态通过 `refresh_token` HttpOnly Cookie 携带；当前无 Bearer Token 和刷新接口。
- Cookie 与服务端会话均为 30 天，生产环境增加 `Secure`。
- 时间字段主要使用 ISO 8601；内容、SSE 和运维子系统部分字段使用 Unix 毫秒。
- 大部分成功响应为 `{ "data": ... }`；失败为 `{ "error": { "code", "message" } }`。
- 创建通常返回 `201`，删除/退出通常返回 `204`。
- CORS 只允许 `CORS_ALLOWED_ORIGINS` 中的来源。

认证层分为：

- **活动账号**：绝大多数业务端点通过 `currentUser()`，要求 `status === "active"`。
- **账号态会话**：`GET /api/me`、登录设备和申诉等端点通过 `currentAccountUser()`，允许活动账号和管理员停用账号，拒绝已注销账号。
- **管理员**：要求活动账号且角色为 `admin` 或 `moderator`。

常见状态码：`400` 参数错误、`401` 未登录/账号不允许访问当前业务、`403` 来源或权限错误、`404` 不存在/不可见、`409` 状态门槛、`410` 导出过期、`413` 草稿过大、`429` 限流、`502` 外部 Provider 失败。

## 2. 健康与内容

### `GET /api/health`

无需登录，返回：

```json
{
  "status": "healthy",
  "checkedAt": 1786702671473,
  "components": [
    { "name": "api", "status": "healthy" },
    { "name": "database", "status": "healthy" },
    { "name": "object-storage", "status": "healthy" },
    { "name": "realtime", "status": "healthy" }
  ],
  "service": "ai-marriage-api"
}
```

组件会按当前配置检查 API、实时通道、PostgreSQL（或内存 Store）和对象存储。关键组件为 `unhealthy` 时返回 `503`；该接口不发送短信或调用模型，不能替代完整业务验收。

### 公开内容

| 方法与路径 | 权限 | 行为 |
| --- | --- | --- |
| `GET /api/content` | 公开 | 查询已发布内容；支持 `type`、`tag`、`query`、`upcomingOnly`、`page`、`pageSize` |
| `GET /api/content/:contentId` | 公开 | 获取单条已发布内容 |
| `POST /api/content/:contentId/like` | 活动账号 | 点赞，幂等返回当前计数 |
| `DELETE /api/content/:contentId/like` | 活动账号 | 取消点赞 |
| `POST /api/content/:contentId/register` | 活动账号 | 报名未开始且有名额的活动 |
| `DELETE /api/content/:contentId/register` | 活动账号 | 取消报名 |
| `GET /api/me/event-registrations` | 活动账号 | 返回当前账号仍有效的活动报名，用于跨刷新恢复“我的活动” |
| `POST /api/me/moments` | 活动账号 | 提交文字和最多 9 张图片的生活动态，初始状态为待审核草稿 |
| `GET /api/me/content` | 活动账号 | 查看当前账号发布的全部动态及审核状态 |
| `DELETE /api/me/content/:contentId` | 活动账号 | 删除自己发布的内容 |
| `GET /api/content-images/:imageToken` | 按内容状态 | 读取动态图片；已发布动态可公开读取，草稿仅作者或后台可读 |

`POST /api/me/moments` 请求体为 `{ body, images }`。`images` 最多 9 项，每项包含 `filename`、`mimeType`、`sizeBytes` 和 `dataUrl`；仅支持 JPG、PNG、WebP，单张不超过 4 MB、单次总计不超过 32 MB。服务端完整校验后先以不可发布状态持久化预留对象键，再写入独立 `moments/` 对象命名空间，全部上传成功后才转为待审核草稿；任一上传失败都会进入不可公开的两阶段清理流程，即使对象删除暂时失败也保留可重试索引。动态图片不进入资料照片表或资料照片审核。

内容类型为 `article` 或 `event`，状态为 `draft`、`published` 或 `offline`。内容可包含 `imageUrls` 多图数组；会员动态固定带 `动态` 标签，后台发布后才进入公开列表。本人删除、后台删除和账号到期注销都会先持久化为不可公开状态，再删除图片对象，最后移除内容记录；中途失败时保留对象键供安全重试。

账号到期注销会在删除资料照片对象前先把资料设为私密、照片设为不可公开并持久化；后续对象或数据库步骤失败时，残留索引也不会继续公开破图。

## 3. OTP 与账号态

### `POST /api/auth/otp/request`

请求：`{ "phone": "13800138000" }`。手机号必须是 11 位大陆手机号。

本地开发成功响应可包含 `devCode: "123456"`；生产 HTTP Provider 不回显验证码。

限制：

- 同手机号 60 秒冷却。
- 同 IP 滚动 10 分钟最多 20 次。
- 超限返回 `429 RATE_LIMITED` 和 `Retry-After`。

手机号/IP 窗口只在当前 API 进程内，非分布式风控。

### `POST /api/auth/otp/verify`

请求：

```json
{ "phone": "13800138000", "code": "123456" }
```

- 单验证码最多错误 5 次。
- 未注册手机号验证后自动创建账号。
- 用户主动暂停的账号会恢复为 `active`。
- 管理员停用的账号保持 `suspended`，响应仍设置受限会话，前端应进入 `/me/security` 申诉。
- 注销到期时先执行逻辑注销，然后返回 `403 ACCOUNT_DELETED`。
- 已注销账号不能通过 OTP 直接恢复。

成功响应包含 `user` 和已有 `profile`。`user` 包含脱敏手机号、角色、状态和注销计划时间。

### 账号和会话接口

| 方法与路径 | 权限 | 行为 |
| --- | --- | --- |
| `POST /api/auth/logout` | 有无会话均可 | 撤销当前会话并清 Cookie |
| `GET /api/me` | 账号态会话 | 当前用户和完整个人资料；管理员停用账号可访问 |
| `GET /api/me/sessions` | 账号态会话 | 登录设备列表和当前设备标记 |
| `DELETE /api/me/sessions/:sessionId` | 活动账号 | 撤销指定会话 |
| `DELETE /api/me/sessions` | 活动账号 | 撤销除当前设备外的所有会话 |
| `POST /api/me/account/suspend` | 活动账号 | 用户主动暂停并撤销全部会话 |

## 4. 建档、可见性与照片

### 服务端草稿

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/me/onboarding-draft` | 活动账号 | 返回当前服务端草稿或 `null` |
| `PUT /api/me/onboarding-draft` | 活动账号 | 合并保存 `{ currentStep, data }` |

`currentStep` 为 1 至 15，合并后的 JSON 最大 64 KB，超过返回 `413 ONBOARDING_DRAFT_TOO_LARGE`。

### `PATCH /api/me/profile`

活动账号。一次性提交完整资料：昵称、性别、出生年份、城市、地区、工作、婚姻状态、交往目标、简介、吸烟情况、子女情况、偏好和问答。

- 出生年份为 1940 至当前年份减 18。
- 偏好最多 10 项；共享契约中的 15 道关系问答必须全部为非空字符串，旧题目键会被忽略。
- `smokingStatus` 支持 `不吸烟|偶尔吸烟|吸烟`，`childrenStatus` 支持 `无子女|有子女|子女已成年`；它们保存到资料偏好并投影到审核通过的公开会员。
- 状态改为 `pending_review`。
- 完成草稿标记为 `submitted`。
- 已公开会员立即下架；已启用 AI 分身在同一持久化流程中变为 `paused`。

### `PATCH /api/me/visibility`

请求 `{ "visibility": "private|approved_only|public" }`。

- `private`：不进入会员投影。
- `approved_only`：不进入游客公开大厅，可进入符合双向硬条件的推荐和授权详情。
- `public`：满足其他投影条件后可公开展示。

### 照片

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/me/photos` | 上传 Base64 JPEG/PNG/WebP；单张 8 MB、每人 6 张，校验扩展名/MIME/文件头/大小 |
| `GET /api/me/photos` | 查看自己的照片和审核状态 |
| `GET /api/photos/:photoId/content` | 审核通过可公开读取，待审/退回仅本人 |
| `POST /api/me/photos/:photoId/primary` | 设为主照片 |
| `DELETE /api/me/photos/:photoId` | 删除对象和记录，必要时重选主图 |

正式会员投影要求账号活动、资料审核通过、至少一张照片通过、可见性非私密且 AI 分身启用。

## 5. AI 分身授权、知识和版本

### 基础分身

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/me/avatar-profile/generate` | 从已保存资料和非空问答生成授权摘要，状态 `pending` |
| `GET /api/me/avatar-profile` | 获取自己的分身摘要 |
| `POST /api/me/avatar-profile/enable` | 启用分身并尝试进入会员投影 |
| `POST /api/me/avatar-profile/pause` | 暂停并从会员投影下架 |
| `POST /api/me/avatar-profile/revoke` | 撤销授权并下架 |

### 知识和版本

| 方法与路径 | 行为 |
| --- | --- |
| `GET/POST /api/me/avatar-knowledge` | 列表或创建知识条目 |
| `PATCH/DELETE /api/me/avatar-knowledge/:itemId` | 更新或删除条目 |
| `POST /api/me/avatar-knowledge/:itemId/governance` | 标记 `allowed`、`sensitive`、`prohibited` 及原因 |
| `GET/POST /api/me/avatar-versions` | 列出版本/调用记录或创建草稿版本 |
| `POST /api/me/avatar-versions/:versionId/activate` | 激活版本 |
| `POST /api/me/avatar-versions/:versionId/rollback` | 回滚到指定版本 |

禁止知识不能进入授权版本。相关写操作先持久化，失败时恢复原内存状态。

## 6. 会员、双向推荐与心仪

### `GET /api/members`

公开接口，支持 `gender`、`minAge`、`maxAge`、`city`、`maritalStatus`、`goal`、`smokingStatus`、`childrenStatus`、`onlyWithPhoto`、`sort`、`pageSize` 和 `cursor`。`sort` 可为 `default|recent-active|newest|age-asc|age-desc`。

筛选、排序和分页均在服务端完成。响应包含 `items`、`total`、`pageSize`、`nextCursor` 和 `hasMore`；v3 游标把 30 分钟冻结结果集压缩后使用应用加密密钥签名，因此不依赖进程内快照，并可在配置密钥不变时跨 API 重启继续。翻页期间排序字段变化或新增会员不会造成重复、遗漏或插队，已删除会员会跳过；跨筛选或排序复用会被拒绝。无效范围返回 `400 INVALID_MEMBER_SEARCH`，无效或过期游标返回 `400 INVALID_CURSOR`，网页会自动刷新当前筛选首屏。游客只看到 `public` 正式用户和演示会员；`approved_only` 不返回。登录用户不看到自己和任一方向屏蔽的对象。

### `GET /api/members/:memberId`

- `public` 可公开访问。
- `approved_only` 仅允许已登录且通过双向硬条件的用户访问。
- 自己、不可见、被屏蔽或不存在统一返回 `404 MEMBER_NOT_FOUND`。

### `GET /api/recommendations`

活动账号，要求资料存在且自己的 AI 分身为 `enabled`。支持：

```text
gender, minAge, maxAge, city, maritalStatus, goal,
sort=default|match|score-desc|age-asc|age-desc,
pageSize, cursor
```

算法版本 `bidirectional-rules-v1.0.0`：

- 双向硬条件检查性别、年龄、地点/异地、婚姻状态和关系目标。
- 通过后按年龄、地点、目标、婚姻经历、看重品质和资料可信度评分。
- 返回 `member`、`score`、`reasons`、`factors`、`algorithmVersion`。
- 每次推荐为结果保存匹配快照。
- 推荐使用绑定当前用户、筛选和排序的 v3 无状态压缩签名游标分页，响应同时返回 `total`、`pageSize`、`nextCursor` 和 `hasMore`。

### 心仪、跳过和筛选方案

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/members/:memberId/interest` | 设置或恢复心仪 |
| `POST /api/me/pending-interest` | 建档或审核未完成时保存待恢复的心仪目标 |
| `DELETE /api/members/:memberId/interest` | 取消心仪 |
| `GET /api/me/interests` | 返回 `sent`、`received`、`mutual` |
| `POST /api/members/:memberId/skip` | 跳过候选人 |
| `DELETE /api/members/:memberId/skip` | 恢复已跳过候选人 |
| `GET/POST /api/me/match-filters` | 获取或保存筛选方案，最多 10 个 |
| `DELETE /api/me/match-filters/:filterId` | 删除自己的筛选方案 |

联系正式会员时，请求者必须达到资料、照片审核条件；屏蔽关系会阻止心仪。

## 7. AI 会话和适合度分析

### `POST /api/avatar-sessions`

请求 `{ "memberId": "member-id" }`。

- 不能与自己的分身聊天。
- 正式会员要求请求者通过联系审核并保持心仪，否则分别返回 `ACCOUNT_REVIEW_REQUIRED` 或 `INTEREST_REQUIRED`。
- 对方 AI 分身必须 `enabled`。
- 任一方向屏蔽返回 `CHAT_BLOCKED`。
- 同一用户和对象已有活动会话时返回原会话。

### 会话接口

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/avatar-sessions` | 当前用户的 AI 会话列表，按最近更新时间倒序 |
| `GET /api/avatar-sessions/:sessionId` | 会话和主题进度 |
| `GET /api/avatar-sessions/:sessionId/messages` | AI 消息历史 |
| `POST /api/avatar-sessions/:sessionId/messages` | 发送最多 500 字的问题 |
| `POST /api/avatar-sessions/:sessionId/end` | 结束本次了解并暂停该会话；再次进入对象时创建新会话 |
| `GET /api/avatar-sessions/:sessionId/analysis` | 获取统一算法分析和真人准入 |

AI 问答限流为每用户滚动 10 分钟 20 条，超过返回 `429 AVATAR_MESSAGE_RATE_LIMITED`。窗口是进程内状态。模型首次调用失败时，用户问题和脱敏失败任务会持久化并返回 `502`；普通重复请求返回同一任务的 `202`，不会重复调用模型。用户明确点击“重新发送”时，网页在同一请求体增加 `{ "retry": true }`，服务端复用原问题和 `clientMessageId` 真正重试，成功后原子化写入 AI 回答并解决失败任务。

分析响应包括：

```text
readiness, canRequestChat, score, algorithmVersion, factors,
completedTopics, commonPoints, discussionTopics, summary
```

`canRequestChat` 只有生活、关系、沟通三个主题全部完成，双向硬条件通过且分数至少 `70` 时为真。

## 8. 真人聊天和 SSE

### 申请

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/chat-requests` | 请求体含 `avatarSessionId`；再次检查心仪、审核、分身、屏蔽、三个主题和分数门槛 |
| `GET /api/chat-requests` | 当前用户发出或收到的申请 |
| `POST /api/chat-requests/:requestId/accept` | 接收方接受并创建/复用唯一真人会话 |
| `POST /api/chat-requests/:requestId/reject` | 接收方拒绝待处理申请 |

待处理申请创建时写入 `expiresAt`，有效期为 7 天。列表、接受、拒绝和再次申请都会执行到期检查；到期状态为 `expired`，不能再接受或拒绝，但发起方满足当前门槛时可以重新申请。接受时还会重新检查双方账号均为 `active`。

双方反向申请被接受时复用同一会话。PostgreSQL 在事务中接受申请并创建/恢复会话。

### 消息和回执

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/conversations` | 当前用户真人会话 |
| `GET /api/conversations/:conversationId/messages` | 消息历史并写入送达时间 |
| `POST /api/conversations/:conversationId/messages` | 最多 1000 字；必须使用合法 `clientMessageId` 幂等 |
| `POST /api/conversations/:conversationId/read` | 将对方未读消息设为已读并发布事件 |
| `POST /api/conversations/:conversationId/typing` | 请求 `{ "typing": true|false }`，true 在 5 秒后自动失效 |
| `POST /api/conversations/:conversationId/archive` | 参与者结束当前真人会话，结束期间不能继续发送 |
| `POST /api/conversations/:conversationId/restore` | 双方没有屏蔽关系时恢复已结束会话 |
| `POST /api/conversations/:conversationId/messages/:messageId/recall` | 发送者撤回自己的近期消息，后续历史不再暴露原文 |

真人消息按用户执行每分钟 30 条的进程内限流，超限返回 `429 HUMAN_MESSAGE_RATE_LIMITED`。同一正文重试会复用 `clientMessageId` 并返回原消息，不重复计入额度；同一标识携带不同正文返回 `409 CLIENT_MESSAGE_ID_CONFLICT`。银行卡、转账、汇款、保证金、借钱、垫付、充值和提现等资金风险文本返回 `422 MESSAGE_FINANCIAL_RISK`；微信、电话等联系方式仅在网页提示安全风险。接收方账号停用、双方屏蔽或会话非活动状态时均拒绝发送。

### `GET /api/realtime/events`

活动账号使用的 SSE：

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
```

事件类型：`message.created`、`message.read`、`message.recalled`、`typing.changed`、`presence.changed`、`conversation.updated`、`notification.created`。支持 `Last-Event-ID`，必须为非负安全整数；默认每用户保留最近 100 个进程内事件。历史已丢弃时发送 `history-expired` 类型的 `resync`；API 重启导致事件流归零时发送 `stream-reset` 类型的 `resync`，客户端都应重新拉取状态。

SSE、在线、输入和事件历史只在单 API 进程内，不是跨实例消息总线。

## 9. 通知、举报与屏蔽

### 通知

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/notifications` | 通知列表和未读数 |
| `POST /api/notifications/:notificationId/read` | 单条已读 |
| `POST /api/notifications/read-all` | 全部已读 |

通知同时通过 SSE 发布，但没有站外推送。

### `POST /api/reports`

```json
{
  "targetUserId": "user-id",
  "reason": "疑似诈骗",
  "description": "对方要求通过陌生链接转账。",
  "avatarSessionId": "可选 AI 会话 ID",
  "conversationId": "可选真人会话 ID",
  "messageId": "可选具体消息 ID"
}
```

- `reason` 必填，`description` 最多 1000 字，不能举报自己。
- AI 证据要求会话属于举报人、目标分身属于被举报用户，消息属于该 AI 会话。
- 真人证据要求会话包含举报人与被举报人；具体消息必须属于该会话且由被举报人发送。
- 只有 `messageId` 而无所属 AI/真人会话时返回 `REPORT_EVIDENCE_INVALID`。
- 证据 ID 随举报持久化并返回后台。

### 屏蔽

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/users/:userId/block` | 屏蔽并把双方已有真人会话设为 `blocked` |
| `GET /api/me/blocks` | 自己创建的黑名单 |
| `DELETE /api/users/:userId/block` | 解除当前方向；双方无其他屏蔽后恢复会话 |

PostgreSQL 使用事务同步屏蔽关系和会话状态。任一方向屏蔽都会阻止匹配与联系关键入口。

## 10. 账号生命周期和数据导出

### 注销和申诉

| 方法与路径 | 权限 | 行为 |
| --- | --- | --- |
| `POST /api/me/account/deletion-request` | 活动账号 | 请求体 `{ "confirmation": "DELETE" }`，安排 7 天后注销 |
| `DELETE /api/me/account/deletion-request` | 活动账号 | 冷静期内取消注销 |
| `POST /api/me/appeals` | 账号态会话 | 5 至 1000 字原因，可附最多 10 条补充说明 |
| `GET /api/me/appeals` | 账号态会话 | 查看自己的申诉 |

管理员停用账号可访问申诉和账号状态，但不能使用普通业务接口。

### 数据导出

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/me/data-exports` | 活动账号，生成 24 小时有效 JSON |
| `GET /api/me/data-exports` | 账号态会话，查看导出任务元数据 |
| `GET /api/me/data-exports/:exportId/download` | 活动账号，下载未过期导出 |

已有未过期的 ready 导出时返回 `DATA_EXPORT_ALREADY_READY`。过期返回 `410 DATA_EXPORT_EXPIRED`。

导出覆盖账号、资料、草稿、照片元数据、心仪、匹配快照、AI 摘要/知识/版本/调用/会话/消息、真人申请/会话/消息/回执、通知、举报、屏蔽、点赞、活动报名和申诉。

## 11. 管理员接口

### 后台二次验证

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/admin/access` | 查看当前登录会话是否已完成后台二次验证 |
| `POST /api/admin/access/verify` | 使用独立 `ADMIN_ACCESS_CODE` 提升当前会话；不得复用登录 OTP |

生产环境配置了管理员手机号时必须设置独立后台访问码。管理员和审核员的受保护操作只接受已提升的当前会话，退出登录后提升状态同时失效。

### 审核和举报

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/admin/moderation` | 待审资料最小投影和待审照片 |
| `POST /api/admin/profiles/:userId/approve|reject` | 通过或带原因退回资料 |
| `POST /api/admin/photos/:photoId/approve|reject` | 通过或带原因退回照片 |
| `GET /api/admin/reports` | 举报及证据列表 |
| `POST /api/admin/reports/:reportId/resolve` | 填写处理结果并通知举报人 |

### 账号、申诉、审计和维护

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/admin/accounts` | 用户状态、角色、资料完成、最近登录摘要 |
| `POST /api/admin/accounts/:userId/suspend` | 5 至 500 字原因，管理员停用并撤销会话 |
| `POST /api/admin/accounts/:userId/restore` | 仅恢复非管理员且未注销的用户，并清除停用来源；管理员账号返回 `409 ACCOUNT_OPERATION_NOT_ALLOWED` |
| `GET /api/admin/appeals` | 全部申诉 |
| `POST /api/admin/appeals/:appealId/review` | `approved|rejected` 及 2 至 1000 字说明 |
| `GET /api/admin/audit-logs` | 审计列表；API 不回传敏感 `reason` 原文 |
| `GET /api/admin/operations` | 健康、请求指标、最近错误和维护摘要 |
| `POST /api/admin/operations/cleanup` | 清理到期注销、OTP、会话和数据导出 |

维护执行按步骤记录状态和数量，持久化到 `maintenance_runs` 并写管理员审计。接口是手动触发，不是内置定时任务。

### 内容运营

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/admin/content` | 创建文章/活动草稿 |
| `GET /api/admin/content` | 查看所有状态内容 |
| `POST /api/admin/content/:contentId/publish` | 发布 |
| `POST /api/admin/content/:contentId/offline` | 下线 |
| `PATCH /api/admin/content/:contentId` | 编辑标题、摘要、正文、标签、图片或活动信息 |
| `DELETE /api/admin/content/:contentId` | 删除内容及关联点赞和报名 |

### AI 失败恢复

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/admin/avatar-reply-failures` | 分页查看 `pending|resolved` 失败任务；只返回任务编号和脱敏错误，不返回用户原始问题 |
| `POST /api/admin/avatar-reply-failures/:taskId/retry` | 重新调用模型，成功后把 AI 回复写回原会话并将任务标记为已恢复 |

## 12. Provider 和明确边界

| 能力 | 本地默认 | 可接入 | 当前不包含 |
| --- | --- | --- | --- |
| 短信 | Console 和固定开发 OTP | HTTP Webhook | 短信签名、模板和供应商审批 |
| 照片 | Data URL/MinIO | 私有 S3-compatible | 预签名直传、CDN、EXIF 清理和自动审核 |
| AI | Deterministic | OpenAI-compatible | 真实模型凭据、正式效果和合规评估 |
| 实时 | 单进程 SSE | 可继续外接消息总线 | 跨实例广播、Web Push 和多媒体 |
| 运维 | 手动清理和单机 Compose | 可外接调度/监控 | 高可用、自动扩缩容和生产级风控 |

明确排除实名认证、身份证、活体检测、正式备案、真实短信模板审批、生产级分布式风控和可直接大规模运营。当前 API 能完成要求范围内的本地闭环，不应被描述为生产合规平台。
