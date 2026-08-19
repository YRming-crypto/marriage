# 维护与故障处理

本文区分仓库已经提供的能力和部署方仍需外接的能力。当前生产 Compose 有基础容器健康检查和日志轮转，应用内提供脱敏运维摘要、管理员审计和手动清理记录，但没有外部监控平台、告警、错误追踪或定时备份/清理调度。

## 1. 已提供与未提供

| 能力 | 当前状态 |
| --- | --- |
| 容器重启策略 | 已提供，`unless-stopped` |
| Docker 日志轮转 | 已提供，单文件 `10m`、保留 `3` 个 |
| Gateway/Web 静态健康检查 | 已提供 `/healthz` |
| API 进程健康检查 | 已提供 `/api/health` |
| PostgreSQL 连接健康检查 | 已提供容器 `pg_isready` |
| 完整恢复集脚本 | 已提供 PostgreSQL dump 与整个照片桶的同点备份，但不自动调度、不加密 |
| S3、短信、模型深度健康检查 | `/api/health` 会探测当前 S3 桶；短信、模型和 S3 对象级读写检查未提供 |
| 指标、看板、告警、错误追踪 | 未提供，部署方外接 |
| API 访问与错误日志 | 当前 Fastify `logger: false`，不完整 |
| OTP 基础防刷 | 已提供：同手机号 60 秒冷却、同 IP 10 分钟 20 次、单验证码 5 次错误锁定 |
| OTP 生产级风控 | 未完整提供：缺多实例共享、设备维度、每日额度、WAF/网关和审计 |
| 登录会话 | Cookie 与服务端会话固定 30 天；可查看设备、撤销单个或其他设备，无自动续期 |
| 代理与外联网络 | 生产启用 `TRUST_PROXY`；网关以 `TRUSTED_PROXY_CIDR` 限定外层代理，API 通过独立 `egress` 访问外部 Provider |
| 屏蔽与会话状态 | PostgreSQL 事务同步屏蔽记录和会话状态；主要联系路径重新校验 |
| 管理员操作审计日志 | 已提供应用内记录和查询；不替代外部安全审计平台 |
| 账号注销维护 | 已提供 7 天冷静期、登录懒执行和管理员手动清理；无内置定时调度 |
| 数据导出维护 | 已提供 24 小时 JSON 导出和到期正文清理 |
| 实时通信 | 已提供单实例 SSE、在线、输入和已读；无 WebSocket、跨实例总线和外部推送 |

不要把“建议监控的指标”理解为仓库已经采集这些指标。

## 2. 日常检查

### 容器和浅层健康

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml ps -a
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --since 30m --tail 200 gateway web api postgres
docker stats --no-stream
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/api/health
docker compose --env-file .env.deploy -f deploy/docker-compose.yml exec -T postgres sh -ceu 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

如果修改了 `APP_HTTP_PORT`，同步替换 HTTP 地址。`pg_isready` 从容器环境读取数据库用户和库名，不要把默认值硬编码进维护脚本。

### 外部服务

`/api/health` 会主动连接 PostgreSQL，并对当前 S3/MinIO 桶执行 `HeadBucket`；它不会调用短信或模型 Provider，也不验证对象级上传、读取和删除。以下深度检查仍需另行执行：

- **S3**：桶可访问、仍为私有、容量和对象数正常，应用凭据具备最小的读写删除权限。可用提供商控制台或：

```powershell
aws s3api head-bucket --bucket <照片桶> --endpoint-url https://<S3兼容端点>
```

- **SMS**：Webhook 的 2xx 成功率、超时、供应商余额、签名/模板状态。测试使用专用号码，不向真实用户发送运维验证码。
- **模型**：Chat Completions 端点的成功率、延迟、额度、内容格式与数据地域。响应必须包含字符串 `choices[0].message.content`。
- **备份**：最近一次数据库 dump 和同恢复点对象快照都成功，异机副本可读取，恢复演练未过期。

### 建议外接的监控

- 容器重启次数、CPU、内存、磁盘和文件系统 inode。
- PostgreSQL 连接数、事务失败、锁等待、慢查询、数据库/WAL/表/索引体积。
- S3 请求错误、容量、对象数、复制延迟和版本保留状态。
- OTP 请求/验证的成功率、`429`、错误锁定和 `Retry-After` 分布，以及照片上传/读取、AI 回答、聊天、举报接口的成功率和延迟。
- 屏蔽/解除屏蔽写入失败、`blocked` 会话数量，以及已屏蔽双方尝试进入各联系路径时的拒绝结果。
- `ACCOUNT_REVIEW_REQUIRED` 数量、双向申请接受后的重复会话检查，以及即将/已经到期的 30 天登录会话行为。
- `INTEREST_REQUIRED`、`AVATAR_PROFILE_REQUIRED`、双向算法版本/分数异常、`AVATAR_MESSAGE_RATE_LIMITED` 和 SSE 重连/`resync` 数量。
- 待执行/已执行注销数量、即将过期的数据导出、维护运行失败步骤和管理员停用/申诉处理时长。
- SMS、S3、模型的 4xx/5xx、超时和费用/额度。
- 迁移、数据库备份、对象快照任务的退出码与最近成功时间。

当前 API 关闭 Fastify 应用日志，完整接口错误率需要接入代理访问日志、应用日志或 APM 后才能可靠统计。日志、指标和告警不得记录 OTP、Session Token、完整手机号、聊天正文、模型密钥或 S3 私钥。

## 3. 建议维护周期

| 周期 | 操作 |
| --- | --- |
| 每日 | 检查容器、核心健康、SMS/S3/模型状态；执行并复核过期资源清理；确认数据库和对象存储备份属于同一恢复点 |
| 每周 | 检查磁盘、数据库/WAL/表/索引增长、对象容量、异常登录和管理员权限清单 |
| 每月 | 在隔离环境恢复数据库与对象存储，执行完整业务冒烟并记录 RPO/RTO |
| 每季度 | 更新并重建基础镜像，在预发布完成测试、迁移和恢复演练后发布 |
| 变更前 | 创建完整恢复集，保留旧镜像，评审迁移和回滚兼容性 |

备份脚本和过期资源清理都不会自行定时运行。必须使用计划任务、CI/CD、外部平台或受控人工操作调度，并为失败配置告警。

### 手动维护任务

管理员可在后台或通过带管理员 Cookie 的 API 执行：

```text
GET  /api/admin/operations
POST /api/admin/operations/cleanup
```

清理任务按顺序处理：

1. 到期账号注销：账号设为 `deleted`、撤销全部会话并移除会员投影。
2. 过期 OTP。
3. 过期登录会话。
4. 过期数据导出：标记 `expired` 并清空加密导出正文。

维护运行记录包含任务状态、每个步骤状态、清理数量和总数，并写入 PostgreSQL 与管理员审计。同名任务正在运行时返回 `409 MAINTENANCE_ALREADY_RUNNING`。单个步骤失败后其他步骤会继续，但整个运行标记为 `failed`，应逐项排查后重新执行。

注销当前是逻辑注销，不是立即物理擦除所有资料、聊天、举报和审计记录。冷静期为 7 天；到期后 OTP 登录也会懒执行注销并返回 `ACCOUNT_DELETED`。

## 4. 常见故障

### `migrate` 失败

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs migrate postgres
docker compose --env-file .env.deploy -f deploy/docker-compose.yml run --rm migrate migrate status --schema prisma/schema.prisma
```

先排查连接串、权限、SQL、锁等待和磁盘。不要反复手工修改 `_prisma_migrations`；修复迁移应先在数据库副本演练。

### API 启动失败或不健康

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --tail 200 api migrate postgres
docker compose --env-file .env.deploy -f deploy/docker-compose.yml exec -T postgres sh -ceu 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose --env-file .env.deploy -f deploy/docker-compose.yml restart api
```

重点检查：

- `DATABASE_URL` 使用容器主机名 `postgres`，密码已正确 URL 编码。
- `APP_ENCRYPTION_KEY` 存在、至少 32 字符且不是公开示例值。
- `PUBLIC_ORIGIN` 与浏览器实际 HTTPS Origin 完全一致。
- `SMS_PROVIDER=http` 且 Webhook 已配置。
- `OBJECT_STORAGE_PROVIDER=s3` 且 S3 必填值齐全。
- `AVATAR_MODEL_PROVIDER=openai` 且端点、密钥、模型名齐全。
- API 同时连接 `backend` 和 `egress`，PostgreSQL 只连接内部 `backend`。
- `TRUST_PROXY=true`，`TRUSTED_PROXY_CIDR` 与实际外层代理来源一致，且网关没有把用户可伪造的转发头直接交给 API。
- `migrate` 已成功退出。

生产 Provider 配置缺失时，API 会主动拒绝启动。

### 网页可开但 API 请求失败

```powershell
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/api/health
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --tail 200 gateway api
```

检查外层代理是否传递 `Host`、`X-Forwarded-Proto` 和客户端地址，浏览器是否始终通过 `PUBLIC_ORIGIN` 访问，以及 HTTPS Cookie 是否被浏览器接受。生产 API 启用 `TRUST_PROXY`；仓库网关只信任 `TRUSTED_PROXY_CIDR` 内的外层代理，并将解析后的单一客户端地址写给 API。若 API 看到统一代理地址，先核对实际代理来源是否落在该 CIDR 内。静态 `/healthz` 成功只说明网关进程存活。

### 验证码发送失败或返回 `429`

API 在 SMS Webhook 非 2xx、连接失败或 10 秒超时时返回发送失败。检查：

- `SMS_WEBHOOK_URL` 网络和 TLS 可达。
- Bearer Token、供应商余额、短信签名和模板有效。
- Webhook 能接收 `phone`、`code`、`expiresInSeconds` JSON。
- Webhook 日志没有记录完整验证码和手机号。

如果返回 `429 RATE_LIMITED`，先读取 `Retry-After`，确认是否命中以下基础规则，而不是立即判断短信供应商故障：

- 同一手机号发送后 60 秒内不能再次发送。
- 同一 IP 在滚动 10 分钟内最多请求 20 次。
- 同一验证码连续错误 5 次后失效并拒绝继续验证。

手机号冷却和 IP 窗口仅存在当前 API 进程内，API 重启后清空，多实例之间不共享；启用 PostgreSQL 时，验证码错误次数由 OTP 记录持久化。公开部署前仍需增加共享限流存储、设备维度、每日额度、WAF/网关规则、告警和审计，不能通过增加 API 实例绕开或稀释这些要求。

若所有用户被当成同一 IP，优先检查外层 TLS 代理、仓库网关与 `TRUST_PROXY` 的地址链。不要通过关闭代理信任来掩盖拓扑错误；应限定可信代理并用两个不同来源地址完成限流验收。

### 屏蔽后仍能联系

屏蔽操作会在一个 PostgreSQL 事务中写入 `Block` 并把双方已有真人会话更新为 `blocked`；解除操作也在一个事务中删除当前方向记录、检查反向记录并决定是否恢复 `active`。数据库事务成功后 API 才修改内存。AI 分身了解、创建或读取 AI 会话、匹配分析、真人聊天申请、接受申请以及真人消息发送都会重新检查双方屏蔽关系或会话状态。

出现异常时检查：

- PostgreSQL 中屏蔽记录是否存在，API 重启后是否正确加载。
- 双方真人会话是否为 `blocked`，以及该状态是否成功持久化。
- 是否有旧 API 实例、旧镜像或绕过网关的流量仍在运行。
- 解除屏蔽时对方是否仍保留反向屏蔽；只要任意一方仍屏蔽，会话就不应恢复为可联系。

不要仅删除数据库中的屏蔽行。应通过应用解除屏蔽接口操作，使屏蔽关系和会话状态保持一致。当前没有完整安全审计，异常绕过尝试需要由网关、数据库审计或外部 SIEM 补充记录。

### 外部 Provider 同时不可用

API 通过非内部的 `egress` 网络访问短信、S3 和模型服务，同时通过 `internal: true` 的 `backend` 网络访问 PostgreSQL。若多个外部 Provider 同时超时，检查 API 的网络连接、容器 DNS、宿主机防火墙和出口代理；若数据库正常，不要取消 `backend` 隔离或给 PostgreSQL 增加外网网络。可先检查：

```powershell
$apiContainer = docker compose --env-file .env.deploy -f deploy/docker-compose.yml ps -q api
docker inspect $apiContainer
docker network ls
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --tail 200 api
```

第一条命令会按当前 Compose 项目解析 API 容器 ID，避免把可能随 `COMPOSE_PROJECT_NAME` 改变的容器名写死。

### 照片上传或读取失败

照片存储失败通常表现为 502，读取不到对象表现为 404。检查：

```powershell
aws s3api head-bucket --bucket <照片桶> --endpoint-url https://<S3兼容端点>
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --tail 200 api gateway
```

同时核对 endpoint、region、path-style 设置、桶名、凭据权限和对象是否存在。桶应保持私有；不要通过开放匿名访问绕过问题。恢复后还要抽查数据库 `Photo.objectKey` 对应对象是否存在。

### AI 分身回答失败

检查模型端点是否是完整 Chat Completions POST 地址、API Key 和模型名是否有效、调用是否在 20 秒内返回，以及响应是否包含字符串 `choices[0].message.content`。确认模型没有返回手机号等禁止数据。不要把生产对话正文直接发送给不符合数据合规要求的模型服务。

如果返回 `429 AVATAR_MESSAGE_RATE_LIMITED`，表示当前用户在滚动 10 分钟内已发送 20 条 AI 问题。该窗口只存在当前 API 进程，重启会清空，多实例也不共享；不能将它作为生产级 AI 配额或成本保护。

### SSE 无消息、在线或已读状态异常

确认浏览器请求 `/api/realtime/events` 返回 `text/event-stream`，Cookie 已携带，代理未缓存事件流且读取超时足够长。当前事件历史每用户仅保留最近 100 条并位于 API 内存：

- `Last-Event-ID` 过旧时客户端会收到 `resync`，应重新拉取消息、通知和会话状态。
- API 重启会丢失事件历史、在线和输入状态，但不会丢失 PostgreSQL 中的消息和回执。
- 多 API 实例之间不会广播事件；当前 Compose 只适合单 API 实例。

### 注销或导出未按时处理

先通过 `GET /api/admin/operations` 查看最近维护运行，再执行一次 `POST /api/admin/operations/cleanup`。检查：

- 账号 `deletion_scheduled_at` 是否已早于当前时间。
- 数据导出 `expires_at` 是否已过期。
- 维护步骤 `accountDeletions` 或 `dataExports` 是否失败。
- 数据库持久化是否可写。

不要直接批量删除用户关联表。当前注销设计是逻辑注销并撤销会话；需要物理擦除时必须另行制定留存、审计和外键处理方案。

### PostgreSQL 或对象存储容量不足

先停止非必要写流量并扩容。不要删除 `pg_wal`、PostgreSQL 数据文件、Docker 卷或仍被数据库引用的照片对象。检查 Docker 占用：

```powershell
docker system df
```

清理旧镜像和构建缓存前，确认保留了可回滚镜像。对象存储清理前先比对数据库引用并保留版本；直接按时间删除对象可能破坏用户照片。

## 5. 安全维护

- 数据库密码、`APP_ENCRYPTION_KEY`、SMS、S3 和模型凭据存入密钥管理服务。
- 只允许 TLS 入口或内网访问 `APP_HTTP_PORT`，PostgreSQL 不暴露公网。
- 私有照片桶禁止匿名读取，并启用服务端加密、版本控制和最小权限。
- `ADMIN_PHONES` 变更采用双人复核。应用审计记录后台账号、申诉、内容和维护动作，但仍需外部不可篡改变更记录补足生产审计。
- 怀疑凭据泄漏时，先隔离服务、保全日志并撤销对应凭据。
- `APP_ENCRYPTION_KEY` 轮换需要专门的数据重加密迁移；当前仓库未提供该工具，不能直接替换变量。
- 不在日志中记录 OTP、Cookie/Token、完整手机号、私聊正文或 Provider 密钥。
- 登录会话固定 30 天；人员离职、账号风险或凭据泄漏处置不能等待自然过期，应通过应用退出撤销当前会话，并在需要全端失效时执行受控数据库会话撤销和业务验收。

## 6. 数据库维护窗口

保持 PostgreSQL autovacuum 默认启用。只有在有监控指标和查询计划证据时才调整 autovacuum、连接数或索引。高风险维护前必须创建数据库与对象存储完整恢复集，并在副本验证执行时长、锁影响和应用兼容性。

## 7. 发布验收清单

- `docker compose --env-file .env.deploy -f deploy/docker-compose.yml config --quiet` 通过。
- 应用测试、构建、Prisma 校验和迁移检查通过。
- SMS、私有 S3 和 OpenAI-compatible 凭据已在预发布真实验证。
- 数据库 dump 与对象快照已创建为同一恢复点，SHA-256 已手工校验。
- 旧镜像、应用版本、数据库迁移版本和 `APP_ENCRYPTION_KEY` 引用均已记录。
- Gateway、Web、API、PostgreSQL 的浅层健康检查通过。
- 用不同来源地址验证 OTP IP 限流没有把所有用户归为同一代理 IP。
- 两个专用账号完成 OTP、建档、照片、审核、正式会员联系门槛、AI 分身、双向申请复用同一会话、真人聊天、屏蔽/解除事务结果、举报和退出闭环。
- 验证自己的 AI 分身前置、正式会员心仪门槛、算法版本 `bidirectional-rules-v1.0.0`、AI 提问限流和带消息归属校验的举报证据。
- 验证 SSE 新消息、在线、输入和已读，以及 API 重启后通过持久消息重新同步。
- 用测试账号验证管理员停用后 OTP 不自动恢复、停用账号可申诉、7 天注销维护和 24 小时导出清理。
- 确认交往目标“先认识了解”写入 PostgreSQL 并在 API 读取后保持原值。
- 监控、告警、备份调度和回滚负责人已经确认。
