# 本地持久化环境

本文用于在 Windows/PowerShell 上运行完整本地流程。默认使用宿主机 Node.js 启动 Web/API，Docker 提供 PostgreSQL 16 和私有 MinIO。

## 1. 端口和数据归属

| 服务 | 地址 | 数据 | 持久位置 |
| --- | --- | --- | --- |
| Web | `127.0.0.1:4183` | 页面和浏览器草稿 | 浏览器存储 |
| API | `127.0.0.1:4184` | 业务入口、SSE、进程内限流/在线状态 | API 内存 + PostgreSQL |
| PostgreSQL 16 | `127.0.0.1:5432` | 账号、资料、匹配、AI、聊天、安全、内容、维护 | 命名卷 `ai-marriage-postgres-data` |
| MinIO | `127.0.0.1:9000` | 私有照片对象 | 命名卷 `ai-marriage-minio-data` |
| MinIO Console | `127.0.0.1:9001` | 管理界面 | 不单独存储 |

API 进程内状态包括手机号/IP/AI 提问限流窗口、在线状态、输入状态和最近 SSE 事件。这些状态在 API 重启后清空，不属于 PostgreSQL 恢复范围。

## 2. 前置条件

- Node.js 22.12+ 和 npm；推荐使用仓库 `.nvmrc` 指定的 Node 22 LTS。
- Docker Desktop，支持 Docker Compose v2。
- PowerShell 5.1+。
- 端口 `4183`、`4184`、`5432`、`9000`、`9001` 可用。

确认：

```powershell
node --version
npm.cmd --version
docker version
docker compose version
```

## 3. 初始化配置

在项目根目录：

```powershell
npm.cmd install
Copy-Item .env.example .env
```

本地建议至少保持：

```text
DATABASE_URL=postgresql://ai_marriage:ai_marriage_dev_password@127.0.0.1:5432/ai_marriage
OBJECT_STORAGE_PROVIDER=s3
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin_dev_password
S3_BUCKET=ai-marriage-local
S3_PUBLIC_BASE_URL=http://127.0.0.1:9000/ai-marriage-local
S3_FORCE_PATH_STYLE=true
SMS_PROVIDER=console
AVATAR_MODEL_PROVIDER=deterministic
NODE_ENV=development
DEV_OTP_CODE=123456
OTP_TTL_SECONDS=300
COOKIE_SECURE=false
TRUST_PROXY=false
APP_ENCRYPTION_KEY=<本机固定且不要随意替换的长密钥>
CORS_ALLOWED_ORIGINS=http://127.0.0.1:4183,http://localhost:4183
```

桶保持私有。浏览器通过 `/api/photos/:photoId/content` 读取受控照片，不需要 MinIO 密钥或匿名访问。

本地直连 API 时保持 `TRUST_PROXY=false`。只有 API 位于受控代理后才启用；生产说明见 `docs/operations/deployment.md`。

## 4. 启动 PostgreSQL 和 MinIO

```powershell
docker compose config --quiet
docker compose up -d postgres minio minio-init
docker compose ps -a
```

预期：

- `postgres` 为 `healthy`。
- `minio` 正常运行。
- `minio-init` 以代码 `0` 退出。
- 桶 `ai-marriage-local` 已创建并执行 `mc anonymous set none`。

诊断：

```powershell
docker compose logs postgres
docker compose logs minio
docker compose logs minio-init
```

## 5. 部署当前迁移

仓库当前包含以下迁移，必须按目录顺序全部部署：

| 迁移 | 重点 |
| --- | --- |
| `20260813000100_initial_schema` | 初始业务表 |
| `20260814030000_message_sender_idempotency` | 消息按会话、发送者和客户端 ID 幂等 |
| `20260814031000_platform_capabilities` | 草稿、申诉、导出、筛选/快照、知识、回执、内容、审计和维护 |
| `20260814040000_persistent_domain_state` | 知识治理/版本与内容活动字段 |
| `20260814050000_complete_local_workflow` | 停用来源和 AI 会话举报证据 |
| `20260814170000_avatar_reply_failure_recovery` | AI 问题幂等键和 AI 回复失败恢复任务 |
| `20260814190000_avatar_conversation_rounds` | 移除 AI 会话的用户/对象唯一约束并保留多轮历史 |

执行：

```powershell
npm.cmd run db:validate
npm.cmd run db:generate
npx.cmd prisma migrate deploy --schema prisma/schema.prisma
npx.cmd prisma migrate status --schema prisma/schema.prisma
```

检查 Schema 和数据库没有差异：

```powershell
$env:DATABASE_URL = node deploy/scripts/recovery-set-manifest.mjs env .env DATABASE_URL
npx.cmd prisma migrate diff `
  --from-url $env:DATABASE_URL `
  --to-schema-datamodel prisma/schema.prisma `
  --exit-code
```

退出码 `0` 表示无差异。不要用 `prisma db push` 替代迁移，也不要手工修改 `_prisma_migrations`。

## 6. 启动应用

```powershell
npm.cmd run dev
```

打开：

```text
Web: http://127.0.0.1:4183/
API: http://127.0.0.1:4184/
API health: http://127.0.0.1:4184/api/health
MinIO Console: http://127.0.0.1:9001/
```

也可分别启动：

```powershell
npm.cmd run dev:api
npm.cmd run dev:web
```

只启动 Web 时，登录、资料、照片、AI、匹配和聊天不可用。本地验证码为 `123456`，仅开发入口回显。

## 7. 本地完整流程验收

至少使用两个普通测试账号和一个管理员账号验证：

1. OTP 注册两个账号，保存/恢复服务端草稿并完成 15 道问答。
2. 上传照片，提交资料，由管理员审核资料和照片。
3. 两个用户分别生成并启用自己的 AI 分身。
4. 确认未启用自己的 AI 分身不能进入正式推荐。
5. 验证 `approved_only` 不出现在游客大厅，但可出现在合格推荐。
6. 验证双向硬条件、筛选、跳过、保存筛选方案和算法版本 `bidirectional-rules-v1.0.0`。
7. 未点心仪时创建正式 AI 会话应返回 `INTEREST_REQUIRED`；点心仪后可进入。
8. AI 问答完成生活、关系、沟通三个主题，分析包含 `score`、`algorithmVersion` 和 `factors`。
9. 分数与主题满足后申请真人聊天；双方反向申请接受仍只有一个真人会话。
10. 验证 SSE 新消息、在线、输入和已读回执，以及 `clientMessageId` 幂等。
11. 从 AI 会话和真人消息发起带证据举报，确认无关消息 ID 被拒绝。
12. 验证屏蔽后关键联系路径拒绝，双方全部解除后会话恢复。
13. 管理员停用账号，OTP 登录后仍为 `suspended` 并进入 `/me/security` 申诉。
14. 请求数据导出并检查范围；申请注销、撤销注销，再测试到期维护。

AI 提问限流为每用户 10 分钟 20 条。OTP 限流为手机号 60 秒、IP 10 分钟 20 次和单码 5 次错误；测试时不要把 `429` 误判为 Provider 故障。

## 8. 跨 API 重启冒烟

```powershell
npm.cmd run build
./deploy/scripts/persistence-smoke.local.ps1
Get-Content persistence-smoke-result.json
```

脚本使用 `4194` 启动独立 API，并使用真实本地 PostgreSQL 和私有 MinIO。当前覆盖：

- 两个正式测试账号、资料和照片。
- 两个已启用 AI 分身。
- 管理员审核。
- 双向真人申请复用同一会话。
- 真人消息幂等。
- 屏蔽和解除。
- 资料重提后 AI 暂停、会员下架。
- API 重启后上述持久状态恢复。

限制：

- 只适用于本机开发，不能在共享或生产环境运行。
- 固定使用默认 PostgreSQL/MinIO 端口、凭据、桶和 `4194`。
- 会创建/覆盖固定测试账号数据，并结束占用 `4194` 的监听进程。
- 运行前必须完成构建。
- 结果/日志位于仓库根目录并已被忽略。
- AI 限流窗口、SSE 历史、在线/输入状态不跨 API 重启，不能作为持久化验收项。

## 9. 账号注销和维护

注销冷静期为 7 天。到期执行有两条路径：

- 用户再次 OTP 登录时懒执行，然后返回 `ACCOUNT_DELETED`。
- 管理员调用 `POST /api/admin/operations/cleanup` 批量执行。

维护任务同时处理到期注销、过期 OTP、过期登录会话和过期数据导出正文。可先查看：

```text
GET http://127.0.0.1:4184/api/admin/operations
```

两个接口都需要管理员 Cookie，浏览器后台也提供入口。仓库没有自动定时任务；需要长期运行时，由 Windows 计划任务、CI/CD 或外部调度使用受控管理员身份触发并监控结果。

注销当前是逻辑注销：设为 `deleted`、撤销会话并下架会员，不会立刻物理删除全部关联资料和历史记录。

数据导出有效期 24 小时。到期下载返回 `410`，维护任务清除导出正文并保留任务元数据。

## 10. 停止、重启和清空

保留数据停止：

```powershell
docker compose stop
```

删除容器/网络但保留卷：

```powershell
docker compose down
```

重新启动：

```powershell
docker compose up -d postgres minio minio-init
```

下列命令会永久删除本地数据库和照片卷，只能在明确需要空环境时执行：

```powershell
docker compose down -v
```

## 11. 健康检查边界

`GET /api/health` 会检查 API、实时通道、PostgreSQL（或内存 Store）和当前对象存储；数据库或对象存储不健康时返回 `503`。它不发送短信、不调用模型，也不检查限流与维护任务，因此完整验收还需：

- `docker compose ps -a` 中 PostgreSQL 健康、MinIO 运行、初始化成功。
- `prisma migrate status` 为最新，`migrate diff` 无差异。
- 照片上传、审核和受控读取正常，桶仍为 private。
- 推荐前置、心仪门槛、统一算法、SSE、举报证据、账号申诉和维护流程通过。
- 执行跨重启冒烟。

宿主机开发栈与容器版 Demo 是两套 Compose 项目，不要交叉使用恢复命令：

- 根目录 `docker-compose.yml` 只提供 PostgreSQL/MinIO，宿主机 Web/API 不在 Compose 内，现有恢复脚本无法替它暂停和恢复写流量，因此不要把 `deploy/scripts/backup.*` 或 `restore.*` 指向该文件。该开发栈需要自行停止宿主机 API 后使用数据库/对象存储原生工具，或改用下方自包含 Demo 完成仓库提供的恢复集流程。
- 自包含 `compose.demo.yml` 可直接使用 `npm.cmd run demo:backup` 创建 PostgreSQL 与照片桶同点恢复集。
- Demo 恢复命令为 `npm.cmd run demo:restore -- -RecoverySetDirectory <恢复集目录>`，会删除 Demo 当前数据库 schema 和桶内容，必须先另行备份当前状态。

仓库不会自动调度备份，也没有在本次交付中对真实数据执行恢复。完整门禁、验证方式和限制见 `docs/operations/backup-restore.md`。

## 12. 明确不覆盖

本地环境不提供实名认证/身份证/活体、真实短信签名模板审批、生产备案、生产级风控、高可用或大规模运营能力。这些内容不应通过调整本地配置宣称已完成。
