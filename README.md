# 缘来相伴 AI 婚恋平台

面向中年用户的 AI 婚恋联系 Demo。项目已经实现从注册建档到真人聊天、账号安全和后台维护的完整本地流程，但不等同于可直接大规模运营的生产婚恋平台。

## 当前流程

```text
手机号 OTP 注册/登录
  -> 完善资料、上传照片、完成 15 道关系问答
  -> 管理员审核资料和照片
  -> 生成、确认并启用自己的 AI 分身
  -> 进入匹配大厅，使用双向规则筛选候选人
  -> 选择心仪对象
  -> 与对方 AI 分身了解生活、关系、沟通三个主题
  -> 查看适合度分析
  -> 达到准入条件后申请真人聊天
  -> 对方接受或拒绝
  -> SSE 真人聊天、通知、已读、在线与输入状态
  -> 举报、屏蔽、申诉、数据导出和账号管理
```

## 已实现范围

- OTP 自动注册与登录、30 天 HttpOnly Cookie 会话、设备会话查看和撤销。
- 六步建档、服务端建档草稿、15 道关系问答、吸烟/子女资料、资料可见范围和资料/照片审核。
- JPEG、PNG、WebP 照片上传，支持本地 Data URL 或私有 S3/MinIO。
- AI 分身摘要、知识条目治理、版本生成、启用、回滚、暂停和撤销。
- 公开大厅照片浏览与年龄/城市/吸烟/子女筛选、正式匹配筛选、跳过、保存方案、心仪记录、双向硬条件和可解释评分快照。
- AI 分身聊天、历史了解轮次、三个了解主题、适合度分析和真人聊天准入。
- 7 天真人聊天申请、接受/拒绝/过期、唯一会话、消息幂等、SSE、在线状态、输入状态和已读回执。
- 站内通知、举报证据、屏蔽/解除屏蔽及聊天阻断。
- 账号主动暂停、管理员停用/恢复、停用账号申诉、7 天注销冷静期和个人数据导出。
- 动态、活动、案例、课堂内容读取，内容点赞、活动报名及管理员内容发布/下线。
- 网页审核后台；审核员处理资料、照片和举报，管理员另有账号、申诉、内容、审计和维护权限。
- Prisma/PostgreSQL 持久化、私有对象存储、本地跨重启冒烟、单机 Docker Compose、备份恢复脚本。

## 核心业务规则

### AI 分身前置

- 当前用户必须完成资料并启用自己的 AI 分身，才能调用正式智能推荐。
- 正式用户只有在账号为 `active`、资料审核通过、至少一张照片审核通过、资料不是 `private` 且 AI 分身为 `enabled` 时，才进入会员投影。
- 对方 AI 分身未启用、已暂停或已撤销时，不能新建或继续 AI 会话。
- 重新提交资料会让会员暂时下架，并把已启用的 AI 分身暂停；重审后不会自动重新启用。

### 心仪和真人聊天门槛

- 正式会员在创建 AI 会话前必须先保持“心仪”状态；申请真人聊天时服务端会再次检查，不能绕过。
- AI 会话需完成生活、关系、沟通三个主题。
- AI 分身纳入全部 15 道关系问答；回复失败后用户可在原消息上真正重试，也可主动结束本次 AI 了解。
- 双向匹配分数需达到服务端阈值 `70`，同时双方硬条件必须互相满足。
- 任一方向存在屏蔽时，会员展示、心仪、AI 会话、适合度分析、真人申请、接受申请和真人消息都会被阻止。

### 匹配算法

当前算法版本为 `bidirectional-rules-v1.0.0`。它不是训练模型，而是可复现的双向规则算法：

- 双向检查性别、年龄、城市/异地、婚姻状态和关系目标等硬条件。
- 对通过硬条件的候选人计算年龄、地点、关系目标、婚姻经历、看重品质和资料可信度等因素。
- 推荐列表和 AI 聊天分析使用同一算法，并保存分数、原因、因素和算法版本快照。

### 限流与数据安全

- OTP：同手机号 60 秒冷却、同 IP 10 分钟最多 20 次、单验证码最多错误 5 次。
- AI 分身提问：每个用户滚动 10 分钟最多 20 条，超过返回 `429 AVATAR_MESSAGE_RATE_LIMITED`。
- 真人消息：必须携带合法 `clientMessageId`，每个用户每分钟最多 30 条；资金转账、银行卡、保证金等高风险内容由网页提示并由 API 拒绝。
- 上述手机号/IP/AI/真人消息窗口是单 API 进程内限制，不是生产级分布式风控。
- 举报可携带 AI 会话、真人会话和消息证据；服务端校验证据归属及被举报对象，防止伪造其他会话的消息 ID。

## 明确排除

本项目按需求明确不实现以下内容：

- 实名认证、身份证采集、人脸识别和活体检测。
- 真实短信供应商的签名、模板报备和供应商账号审批。
- 正式备案、生产法律合规落地和面向真实运营的数据治理审批。
- 生产级分布式风控、WAF、自动内容安全体系、高可用、多地域、海量并发和可直接大规模运营能力。

仓库提供短信 HTTP、S3-compatible 和 OpenAI-compatible 适配器，但真实 Provider 是否可用取决于部署方凭据和联调结果。本地默认验证码和确定性 AI 仅用于开发。

## 本地运行

要求 Node.js 22.12+、Docker Desktop 和 Docker Compose v2；仓库通过 `.nvmrc` 固定 Node 22 LTS 主版本。

```powershell
npm.cmd install
Copy-Item .env.example .env
docker compose up -d postgres minio minio-init
docker compose wait minio-init
npm.cmd run db:validate
npm.cmd run db:generate
npx.cmd prisma migrate deploy --schema prisma/schema.prisma
npm.cmd run db:seed
npm.cmd run dev
```

打开：

- Web：`http://127.0.0.1:4183/`
- API：`http://127.0.0.1:4184/api/health`
- MinIO Console：`http://127.0.0.1:9001/`
- 本地开发验证码：`123456`
- 初始化管理员：`13900139999`，使用本地开发验证码登录。
- 初始化会员：`13900139000` 至 `13900139007`，用于双账号完整流程验收。

`npm.cmd run db:seed` 是幂等命令：它只补充缺失的初始化账号、公开资料、审核通过照片和已启用 AI 分身；不会更新已有资料，也不会把演示资料附加到占用了相同手机号的其他账号。

必须从项目根目录启动 `npm.cmd run dev`，否则只启动 Web 时无法使用登录、上传、匹配和聊天接口。完整 PostgreSQL/MinIO 初始化见 `docs/local-infrastructure.md`。

只需临时体验网页而不启动 Docker 时，可在 PowerShell 中使用一次性内存模式：

```powershell
$env:USE_IN_MEMORY_STORE="true"
$env:OBJECT_STORAGE_PROVIDER="data-url"
npm.cmd run dev
```

内存模式不会修改 `.env`，但 API 重启后注册账号、聊天、活动和上传照片都会清空。要验证真实保存和跨重启恢复，仍应使用上面的 PostgreSQL + MinIO 流程。

体验结束后，在同一个 PowerShell 窗口清除一次性覆盖，避免后续误以为正在使用数据库：

```powershell
Remove-Item Env:USE_IN_MEMORY_STORE -ErrorAction SilentlyContinue
Remove-Item Env:OBJECT_STORAGE_PROVIDER -ErrorAction SilentlyContinue
```

重新启动后，`/api/health` 的组件名称应包含 `database`，而不是 `store`。

也可以使用自包含容器版 Demo，一条命令启动网页、API、PostgreSQL、MinIO、迁移和种子数据：

```powershell
npm.cmd run demo:up
# 打开 http://127.0.0.1:8080/
npm.cmd run demo:down
```

该 Demo 使用固定开发验证码和后台访问码，网页入口与 MinIO Console 默认仅绑定 `127.0.0.1`，不要作为公网或局域网共享部署方案。

Demo 的 PostgreSQL 与 MinIO 可创建同一个完整恢复集。先安装 AWS CLI v2，再执行：

```powershell
npm.cmd run demo:backup
npm.cmd run demo:restore -- -RecoverySetDirectory ..\ai-marriage-backups\ai-marriage-<UTC时间>
```

恢复会清空 Demo 当前数据库 schema 和照片桶，只能对明确确认的本机 Demo 使用。详细门禁、独立校验和限制见 `docs/operations/backup-restore.md`。

## 数据与维护

- 未配置 `DATABASE_URL` 时使用内存 Store，API 重启后业务数据清空。
- 配置 PostgreSQL 后，账号、资料、AI 知识、匹配快照、聊天、通知、举报、内容和运维状态可跨重启恢复。
- 照片二进制保存在 Data URL Provider 或 S3/MinIO；PostgreSQL 保存对象 Key、归属和审核状态。
- 注销申请有 7 天冷静期。到期后，OTP 登录会懒执行注销；管理员也可调用维护清理任务统一处理。
- 注销当前是逻辑注销：账号设为 `deleted`、会话撤销、会员投影下架，不宣称立即物理擦除全部关联记录。
- 个人数据导出生成 JSON，有效期 24 小时；到期维护会清除导出正文。

手动执行过期资源维护需要管理员登录态：

```text
GET  /api/admin/operations
POST /api/admin/operations/cleanup
```

清理任务处理到期注销、过期 OTP、过期登录会话和过期数据导出。仓库没有内置定时调度，需由运维计划任务或人工触发。

## 迁移

当前迁移顺序：

```text
20260813000100_initial_schema
20260814030000_message_sender_idempotency
20260814031000_platform_capabilities
20260814040000_persistent_domain_state
20260814050000_complete_local_workflow
20260814170000_avatar_reply_failure_recovery
20260814190000_avatar_conversation_rounds
20260814210000_member_moment_images
```

最后一个迁移增加内容多图字段并持久化会员动态图片；`20260814190000_avatar_conversation_rounds` 移除“同一用户与同一对象只能有一轮 AI 会话”的唯一约束。部署使用 `prisma migrate deploy`；不要用 `prisma db push` 替代可审计迁移。

## 验证

```powershell
npm.cmd test
npm.cmd run verify
npm.cmd run build
npm.cmd run db:validate
npx.cmd prisma migrate status --schema prisma/schema.prisma
node --test deploy/scripts/backup-restore.contract.test.mjs
```

2026-08-14 最近一次完整验收结果：API `435/435`、Web `301/301`、部署与备份契约 `36/36`；Shared、Web、API 构建和 8 个数据库迁移均通过。PostgreSQL + MinIO 跨 API 重启冒烟覆盖资料照片、会员动态图片、AI 分身、真人会话和屏蔽状态，动态删除后再次重启不会复活。前端构建仅有约 `583 kB` 单包的后续拆包优化提示。

本地跨重启验证：

```powershell
npm.cmd run build
./deploy/scripts/persistence-smoke.local.ps1
Get-Content persistence-smoke-result.json
```

## 文档

- `docs/current-implementation-summary.md`：当前实现细节与边界。
- `docs/project-status-summary.md`：项目状态和完成度。
- `docs/api-contracts.md`：当前 HTTP/SSE 接口契约。
- `docs/local-infrastructure.md`：本地 PostgreSQL、MinIO、迁移和冒烟流程。
- `docs/operations/deployment.md`：单实例部署和迁移。
- `docs/operations/maintenance.md`：维护、注销清理和故障处理。
- `docs/operations/backup-restore.md`：数据库与照片恢复集。
