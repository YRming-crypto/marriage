# 生产部署手册

本文对应 `deploy/docker-compose.yml` 的单机 Docker Compose 部署。它适合联调、验收和早期单实例运行，不提供高可用数据库、对象存储、TLS、监控、告警或自动灾备，也不代表实名认证、短信模板审批、备案或生产级风控已经完成。

## 1. 实际架构

```text
Browser
  -> HTTPS/TLS proxy or load balancer (部署方提供)
    -> gateway:${APP_HTTP_PORT:-8080}
      -> web:8080
      -> api:8080 -> socat -> Fastify 127.0.0.1:4184
          -> postgres:5432
          -> external SMS webhook
          -> external private S3-compatible storage
          -> external OpenAI-compatible chat-completions endpoint

migrate (one-shot) -> postgres:5432
```

- `gateway` 是 Compose 唯一映射到宿主机的服务，代理 `/api/` 和 Web。
- `web` 提供已构建的 React SPA。
- `api` 内部 Fastify 监听 `127.0.0.1:4184`，镜像暂用 `socat` 暴露为容器端口 `8080`。
- `migrate` 一次性执行 `prisma migrate deploy`，成功后 API 才启动。
- `postgres` 是单实例 PostgreSQL 16，数据位于命名卷 `postgres-data`，不映射到公网。
- 生产 Compose 不包含 MinIO。短信、S3 兼容对象存储和模型服务都必须由部署方提供。
- `backend` 网络标记为 `internal: true`，连接 PostgreSQL、迁移、API 和网关；API 额外连接普通 `egress` 网络，以访问外部 SMS、S3 和 OpenAI-compatible 服务。PostgreSQL 与 `migrate` 不连接 `egress`。

本地开发网站使用 `4183/4184`；生产浏览器只访问 `PUBLIC_ORIGIN`，不直接访问这两个内部端口。

真人聊天使用 `/api/realtime/events` SSE 长连接发布新消息、通知、在线、输入和已读事件。在线状态、输入状态和最近 100 个事件只存在单 API 进程；当前部署没有跨实例事件总线。仓库网关为该路径配置了独立精确路由：`proxy_buffering off`、`proxy_cache off`、`proxy_read_timeout 1h`，并返回 `X-Accel-Buffering: no`。外层 TLS 代理或负载均衡器也必须关闭响应缓冲、把空闲读取超时设置为至少 1 小时，并在预发布验证断线重连；否则外层代理仍可能抵消仓库网关配置。

## 2. 上线前准备

需要：

- Docker Engine 和 Docker Compose v2。
- 至少 2 GB 可用内存，以及足够的数据库、镜像和日志磁盘空间。
- 正式域名和 HTTPS 入口。生产 Cookie 默认要求安全传输。
- 可访问的 SMS HTTP Webhook、私有 S3 兼容桶和 OpenAI-compatible 模型端点。
- 密钥管理和异机备份位置。

### 镜像版本策略

为提高镜像可复现性，`Dockerfile` 的 Node 和 Nginx 基础镜像、两套 Compose 的 PostgreSQL 镜像都固定到补丁版本；MinIO 与 `mc` 固定到不可变 SHA-256 digest。补丁标签仍可能被镜像仓库重新发布，因此正式发布应在构建记录中保存每个实际解析到的镜像摘要（digest）和应用 Git revision，并在受控依赖更新中统一升级版本、重新构建、执行测试与恢复演练。不要在发布流水线中把固定版本临时改回 `latest`、主版本或浮动 minor 标签。

创建私有配置：

```powershell
Copy-Item deploy/.env.example .env.deploy
```

`.env.deploy` 已被 `.gitignore` 的 `.env.*` 规则忽略，仍应限制文件 ACL，且不要通过聊天、工单或构建日志传播内容。

## 3. 必填配置

### 应用、数据库与管理员

```text
COMPOSE_PROJECT_NAME=ai-marriage
APP_HTTP_PORT=8080
PUBLIC_ORIGIN=https://marriage.example.com

POSTGRES_DB=ai_marriage
POSTGRES_USER=ai_marriage
POSTGRES_PASSWORD=<独立高强度原始密码>
DATABASE_URL=postgresql://ai_marriage:<URL 编码后的同一密码>@postgres:5432/ai_marriage

APP_ENCRYPTION_KEY=<独立随机值，至少 32 字符>
ADMIN_PHONES=<至少一个管理员手机号；多个用逗号分隔>
OTP_TTL_SECONDS=300
TRUST_PROXY=true
TRUSTED_PROXY_CIDR=<外层 TLS 代理的来源 CIDR；直连测试可用 127.0.0.1/32>
```

`DATABASE_URL` 的主机必须是 Compose 服务名 `postgres`。密码含有 `@`、`:`、`/`、`#` 等字符时，只在 URL 中进行百分号编码，`POSTGRES_PASSWORD` 仍填写原始密码。

可用 PowerShell 生成加密密钥：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

`APP_ENCRYPTION_KEY` 用于手机号和私密消息等字段的应用层加密。丢失后历史密文无法读取；当前仓库没有自动重加密工具，不能只改环境变量完成轮换。管理员由 `ADMIN_PHONES` 指定，使用正常 OTP 流程首次登录后获得管理入口。

生产 API 默认启用 Fastify `trustProxy`，Compose 也显式设置 `TRUST_PROXY=true`。仓库网关要求 `TRUSTED_PROXY_CIDR`，只允许该网段的外层 TLS 代理通过 `X-Forwarded-For` 提供真实客户端地址；Nginx 解析后会把单一 `$remote_addr` 写给 API，不在可信网段内的客户端请求头会被覆盖。API 端口不应绕过网关暴露。直连网关的本机验收可用 `127.0.0.1/32`，正式部署必须填写外层代理实际来源 CIDR，并用至少两个不同来源验证 OTP IP 限流分组。当前模板只接受一个 CIDR；多个不连续代理网段需要在网关模板中增加对应的 `set_real_ip_from` 后再发布。

### 外部短信服务

```text
SMS_PROVIDER=http
SMS_WEBHOOK_URL=https://sms-provider.example/send-code
SMS_BEARER_TOKEN=<可选；Webhook 需要 Bearer 鉴权时填写>
```

生产环境强制使用 HTTP Provider。API 会向 `SMS_WEBHOOK_URL` 发送 JSON POST：

```json
{
  "phone": "13800138000",
  "code": "123456",
  "expiresInSeconds": 300
}
```

Webhook 必须在 10 秒内返回 2xx；否则用户收到验证码发送失败。仓库只提供通用 Webhook 适配器，不包含具体短信厂商账号、签名、模板报备或回执处理。

API 已实现以下进程内基础 OTP 防刷规则：

- 同一手机号发送验证码后冷却 60 秒，冷却期内返回 `429` 和 `Retry-After`。
- 同一 IP 在滚动 10 分钟内最多请求 20 次，超过后返回 `429` 和 `Retry-After`。
- 同一验证码连续错误 5 次后锁定；使用 PostgreSQL 时错误次数记录在 OTP 数据中。

手机号冷却和 IP 窗口位于单个 API 进程内，重启会清空，多实例之间不共享。生产部署仍需补充共享限流存储、设备维度、手机号/IP 每日额度、WAF 或网关限流、异常行为告警和可追溯审计。短信供应商自身的频控和额度也必须单独配置。

### 外部私有 S3 兼容对象存储

```text
OBJECT_STORAGE_PROVIDER=s3
S3_ENDPOINT=<AWS S3 可留空；兼容服务填写 HTTPS endpoint>
S3_REGION=<区域>
S3_ACCESS_KEY=<访问密钥>
S3_SECRET_KEY=<私密密钥>
S3_BUCKET=<照片桶>
S3_PUBLIC_BASE_URL=<该桶的规范 HTTPS 基础地址>
S3_FORCE_PATH_STYLE=false
```

生产环境强制使用 S3 Provider，并校验 region、访问密钥、桶名和 `S3_PUBLIC_BASE_URL`。兼容 MinIO 等 path-style 服务时设为 `true`。桶必须保持私有，凭据至少需要 `PutObject`、`GetObject` 和 `DeleteObject` 权限。

虽然变量名为 `S3_PUBLIC_BASE_URL`，当前业务返回给浏览器的是受控 API 路径 `/api/photos/:photoId/content`，不应因此开放桶的匿名读取。审核通过的照片可经 API 读取，待审核或退回照片仅本人可读。

### 外部 OpenAI-compatible 模型

```text
AVATAR_MODEL_PROVIDER=openai
AVATAR_MODEL_ENDPOINT=https://model-provider.example/v1/chat/completions
AVATAR_MODEL_API_KEY=<模型密钥>
AVATAR_MODEL_NAME=<实际模型名>
```

`AVATAR_MODEL_ENDPOINT` 必须是可直接接收 POST 的 Chat Completions 兼容端点，不是只到 `/v1` 的基础 URL。响应至少要提供字符串 `choices[0].message.content`。生产 Compose 不提供模型服务或额度。

以上三个外部 Provider 均从 API 的 `egress` 网络发起请求。若短信、照片或模型同时连接失败，除核对凭据外还应检查宿主机 DNS、防火墙、代理策略和 `egress` 网络；不要为恢复外联而取消 `backend` 的内部网络隔离或给 PostgreSQL 增加公网出口。

### 外部凭据边界

未取得并验证上述 SMS、S3 和模型凭据前，只能说明“代码已提供适配器”，不能宣称线上短信、云照片存储或真实 AI 已上线。`deploy/docker-compose.yml` 会拒绝缺少必填值的配置，API 也会在生产 Provider 不合规时拒绝启动。

## 4. 首次部署

先渲染配置，缺少任何 Compose 必填值都会在此失败：

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml config --quiet
docker compose --env-file .env.deploy -f deploy/docker-compose.yml build --pull
docker compose --env-file .env.deploy -f deploy/docker-compose.yml up -d
docker compose --env-file .env.deploy -f deploy/docker-compose.yml ps -a
```

`migrate` 正常以退出码 `0` 结束，不应常驻。验收：

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs migrate
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --tail 200 gateway web api postgres
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

如果 `APP_HTTP_PORT` 不是 `8080`，同步替换检查地址。TLS 在外层终止时，只允许反向代理或内网访问该明文端口，并传递 `Host`、`X-Forwarded-Proto` 和客户端地址；外层代理来源必须落在 `TRUSTED_PROXY_CIDR` 内。网关不会把原始转发链交给 API，只会传递解析后的单一客户端地址。

健康接口通过后，还必须用专用验收账号完成：短信验证码、服务端草稿、15 道问答、照片上传与读取、管理员审核、自己的 AI 分身前置、双向推荐、心仪门槛、AI 分身问答限流、三个主题和适合度分析、双向申请复用会话、SSE 新消息/在线/输入/已读、举报证据、屏蔽/解除、申诉、数据导出和退出登录。检查新登录会话的 Cookie 为 30 天，并验证退出后旧 Cookie 失效。不得用真实用户账号做上线测试。

## 5. 健康检查的限制

现有检查分为浅层存活和关键依赖探测：

- `gateway /healthz` 是 Nginx 静态 `200`，不检查 Web、API、PostgreSQL、S3、短信或模型。
- `web /healthz` 只说明 Web Nginx 进程可响应。
- `api /api/health` 会主动探测 PostgreSQL 数据库和 S3 兼容对象存储；关键组件异常时返回 `503`，响应中包含各组件的脱敏状态。
- PostgreSQL 容器的 `pg_isready` 只检查数据库接受连接，不检查迁移完整性或业务查询。

因此 `/healthz` 和 `/api/health` 同时成功仍不等于完整业务可用。生产监控仍须覆盖迁移完整性、业务查询、私有桶真实读写、短信发送结果、模型调用结果和核心用户流程。

## 6. 发布与迁移

发布前必须把数据库和对象存储作为同一恢复集共同备份。仓库的 `backup.ps1`/`backup.sh` 会暂停本 Compose 的 `gateway` 和 `api` 写流量，把 PostgreSQL dump 和整个 S3/MinIO 桶写入同一恢复集，并生成、验证 `manifest.sha256`。运行主机必须安装 Node.js 22.12+ 与 AWS CLI v2，并有足够磁盘空间容纳完整恢复集。脚本不能冻结直接访问数据库或桶的外部写入者，也不能暂停对象生命周期规则；维护窗口必须由部署方同时控制这些外部来源。

建议发布顺序：

1. 进入维护窗口并通知用户；备份脚本会停止写流量。
2. 创建并校验包含数据库 dump 和全部照片对象的完整恢复集，另行保存密钥版本引用。
3. 构建新镜像，保留当前可回滚镜像。
4. 执行并检查迁移。
5. 启动新 API、Web 与网关。
6. 完成业务冒烟后再结束维护窗口。

命令骨架：

```powershell
./deploy/scripts/backup.ps1 -EnvFile .env.deploy -OutputDirectory ../ai-marriage-backups
docker compose --env-file .env.deploy -f deploy/docker-compose.yml build --pull
docker compose --env-file .env.deploy -f deploy/docker-compose.yml run --rm migrate
docker compose --env-file .env.deploy -f deploy/docker-compose.yml up -d --remove-orphans api web gateway
docker compose --env-file .env.deploy -f deploy/docker-compose.yml ps -a
```

新数据库会应用 `prisma/migrations` 中已有迁移。不要在生产使用 `prisma migrate dev`、`prisma db push`，也不要手工改 `_prisma_migrations`。

当前应按顺序看到：

```text
20260813000100_initial_schema
20260814030000_message_sender_idempotency
20260814031000_platform_capabilities
20260814040000_persistent_domain_state
20260814050000_complete_local_workflow
20260814170000_avatar_reply_failure_recovery
20260814190000_avatar_conversation_rounds
```

最后一个迁移移除 AI 会话的用户/对象唯一约束，允许结束后开启新一轮了解并保留历史；前一个迁移新增 AI 问题幂等键和 AI 回复失败恢复任务。发布后执行 `prisma migrate status`，并在数据库副本或维护窗口使用 `prisma migrate diff` 确认当前 Schema 无漂移。

迁移通常不能靠回退应用镜像撤销。回滚前必须确认旧版代码兼容新数据库结构；不兼容时，按 `backup-restore.md` 恢复同一恢复集中的对象存储和数据库。

## 7. 停止与卸载

停止服务但保留数据库卷：

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml stop
```

删除容器和网络但保留数据库卷：

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml down
```

生产环境不得随意执行以下命令，它会删除 Compose 管理的 PostgreSQL 卷：

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml down -v
```

外部 S3 对象不会随 Compose 删除，必须按对象存储提供商的保留策略独立管理。

## 8. 当前生产边界

- 单 PostgreSQL、单 API、单 Web、单网关，没有自动故障转移和滚动发布。
- PostgreSQL 在本机命名卷中，不是托管高可用数据库。
- 不内置 TLS、WAF、网关级限流、监控、告警、错误追踪和定时备份；应用内只有上一节所述的单进程基础 OTP 防刷。
- API 已在内存中收集脱敏请求指标、结构化错误和组件健康摘要，并持久化管理员操作及维护运行；Fastify 通用日志仍关闭，现有数据不能替代外部日志、APM、长期指标和安全审计平台。
- OTP 防刷尚无多实例共享、设备维度和每日额度；AI 问答的每用户 10 分钟 20 条限制也位于单 API 进程，二者不能替代生产级风控。
- 屏蔽记录和真人会话状态在 PostgreSQL 事务中同步更新，持久化成功后才修改 API 内存；关键联系路径仍会重新校验双方屏蔽。生产环境仍需监控事务失败和异常绕过尝试。
- 登录会话固定 30 天，无刷新接口；用户可查看设备、撤销单个会话或退出其他设备。
- 真人消息已支持单实例 SSE、在线状态、输入状态和已读回执；不含 WebSocket、跨实例广播或外部消息推送。
- 注销有 7 天冷静期，并由 OTP 登录或管理员维护任务执行逻辑注销。仓库没有内置定时调度，也不会立即物理擦除所有历史记录。
- 外部 SMS、S3 和模型的 SLA、费用、合规与数据地域由部署方负责。
- 实名/身份证/活体、短信签名模板审批、备案、生产级分布式风控、高可用和大规模运营明确不在当前交付范围内。
