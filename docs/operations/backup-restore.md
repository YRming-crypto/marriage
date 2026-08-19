# PostgreSQL 与 S3/MinIO 完整备份恢复

业务数据位于 PostgreSQL，用户照片位于私有 S3/MinIO。两者互相引用，必须作为同一个恢复集创建、校验、保留和恢复。仓库脚本提供逻辑备份，适合联调、验收和早期单实例部署；大数据量生产环境仍应优先采用数据库和对象存储提供商的时间点快照、版本控制与异地复制。

SSE 事件回放缓冲、在线状态、输入状态及进程内限流窗口不持久化，不属于恢复集。恢复后客户端会重新连接并从持久消息同步状态。

## 1. 脚本能力与依赖

仓库提供四个入口：

- `deploy/scripts/backup.ps1`、`backup.sh`：暂停 `gateway` 和 `api` 写流量，创建 PostgreSQL custom-format dump，将整个 S3/MinIO 桶下载到同一恢复集，生成并立即验证 `manifest.sha256`，最后恢复应用服务。
- `deploy/scripts/restore.ps1`、`restore.sh`：先验证完整 SHA-256 清单并核对恢复集、确认参数和目标环境的数据库名与桶名，再停止写流量，强制覆盖对象桶、回读校验远端对象、恢复 PostgreSQL、执行 Prisma 迁移并启动服务。
- `deploy/scripts/recovery-set-manifest.mjs`：统一处理 `.env.deploy` 键读取、SHA-256 清单生成和严格校验。

四个脚本默认操作 `deploy/docker-compose.yml`。PowerShell 可通过 `-ComposeFile`、`-EnvFile` 和 `-S3ClientEndpoint` 指向其他兼容 Compose；Shell 使用 `COMPOSE_FILE`、`ENV_FILE` 和 `S3_CLIENT_ENDPOINT`。`S3ClientEndpoint` 只改变宿主机 AWS CLI 访问地址，不改变 API 容器内的 `S3_ENDPOINT`，适用于容器内使用 `http://minio:9000`、宿主机使用 `http://127.0.0.1:9000` 的 Demo。

运行主机必须具备：

- Docker Engine 与 Docker Compose v2。
- Node.js 22.12 或更高版本。
- AWS CLI v2；兼容 AWS S3、MinIO 和其他 S3-compatible 服务。
- 足够同时容纳数据库 dump 与全部照片对象的本地磁盘空间。
- 对 PostgreSQL 容器的 Compose 管理权限，以及对目标桶的列举、读取、写入和删除权限。

脚本从 `.env.deploy` 读取 `S3_BUCKET`、`S3_REGION`、`S3_ENDPOINT`、`S3_ACCESS_KEY` 和 `S3_SECRET_KEY`。AWS S3 可把 `S3_ENDPOINT` 留空；MinIO 等兼容服务填写实际 HTTPS endpoint。环境文件只被解析，不会作为 PowerShell 或 Shell 代码执行。

## 2. 恢复集格式

每次成功备份生成一个不可覆盖的目录：

```text
ai-marriage-20260814T120000Z/
  database.dump
  recovery-set.json
  manifest.sha256
  objects/
    <完整 S3 对象键目录>
```

`recovery-set.json` 采用严格结构，固定包含恢复集 ID、UTC 时间、应用 Git revision、数据库名以及对象桶、region 和 endpoint，不允许未知字段，也不包含密码或访问密钥。恢复时其中的 `database.name` 和 `objectStorage.bucket` 必须分别与显式确认的数据库名、桶名一致。`manifest.sha256` 对 `database.dump`、`recovery-set.json` 和 `objects/` 下每个普通文件逐一记录 SHA-256。

清单校验是严格的：文件内容变化、文件缺失、出现清单外文件、重复或危险路径、任意文件/子目录符号链接以及恢复集根目录本身是符号链接，都会让脚本以非零状态退出。`objects/` 必须是实际目录，即使源桶为空也会保留这个空目录。备份脚本只有在“生成清单后再次完整校验”成功时，才把 `.partial` 目录原子改名为正式恢复集目录。

恢复集不包含 `APP_ENCRYPTION_KEY`、数据库密码、S3 密钥、短信密钥或模型密钥。只在外部密钥管理系统记录对应版本；恢复环境必须取得备份时间点使用的 `APP_ENCRYPTION_KEY`，否则数据库中的加密字段不可读。

## 3. 创建完整恢复集

PowerShell：

```powershell
./deploy/scripts/backup.ps1 `
  -EnvFile .env.deploy `
  -OutputDirectory ../ai-marriage-backups
```

Linux/macOS：

```sh
ENV_FILE=.env.deploy \
BACKUP_DIR=../ai-marriage-backups \
sh deploy/scripts/backup.sh
```

脚本按以下顺序执行：

1. 检查环境文件、Docker、AWS CLI、Node.js 和 S3 必填配置。
2. 从运行中的 PostgreSQL 容器读取实际数据库名。
3. 停止本 Compose 项目中的 `gateway` 和 `api`，形成应用自身不再新增数据库记录和照片上传的窗口。
4. 执行 `pg_dump --format=custom --compress=9`，并用 `pg_restore --list` 检查 archive 可读。
5. 执行 `aws s3 sync s3://<S3_BUCKET> <恢复集>/objects` 下载全部对象。
6. 写入元数据，生成 `manifest.sha256`，再逐文件重新计算 SHA-256 并核对文件集合。
7. 发布正式恢复集目录并启动 `api`、`web`、`gateway`。

任何数据库、对象下载或校验步骤失败都会明确非零退出，删除本次未完成的 `.partial` 目录，并尝试恢复应用服务。若 `compose up` 返回失败，脚本会再次停止 `gateway` 和 `api`，避免把部分启动状态留在失败返回之后；二次停服失败会明确告警，整体仍以失败结束。正式恢复集目录已存在时脚本拒绝覆盖。

逻辑备份期间本 Compose 的应用写流量会暂停，耗时取决于数据库和照片总量。脚本只能停止本 Compose 的 `gateway` 和 `api`，不能阻止外部写入者直接修改数据库或桶，也不能暂停对象存储生命周期规则、跨区域复制或提供商后台任务。若存在这些写入者或规则，必须先在外部冻结它们，或改用能提供一致时间点语义的数据库与对象存储快照。

该逻辑备份不保留对象版本 ID、对象标签和自定义元数据；下载到本地后只保存当前对象内容和对象键形成的相对路径。Content-Type、Content-Disposition、Cache-Control、用户元数据、对象锁、保留期、ACL 和存储类别等属性都不属于 `manifest.sha256`，恢复时可能由 AWS CLI 或对象存储重新推断或采用默认值。业务依赖这些属性时，应使用提供商原生版本化复制、清单和快照方案。

对象键到宿主文件系统的映射存在限制：Windows 保留名、大小写碰撞、尾随点或空格、路径长度、文件系统不支持的字符、换行符，以及以 `/` 结尾的目录标记对象都可能无法无损落盘或往返恢复。脚本遇到无法创建的路径会失败，不会静默生成“完整”恢复集。正式使用前必须用真实对象键样本在实际备份宿主机上演练；需要覆盖任意合法 S3 对象键时，应改用不会映射到普通文件路径的提供商原生导出或归档格式。

数据量增大后应改用提供商快照，但快照也必须用同一恢复点 ID 绑定数据库、对象、应用版本和密钥版本，并定期做隔离恢复演练。

## 4. 独立校验恢复集

备份复制到异机、加密卷或归档存储后，再执行一次独立校验：

```powershell
node deploy/scripts/recovery-set-manifest.mjs verify `
  ../ai-marriage-backups/ai-marriage-20260814T120000Z
```

```sh
node deploy/scripts/recovery-set-manifest.mjs verify \
  ../ai-marriage-backups/ai-marriage-20260814T120000Z
```

成功输出 `Recovery set verified`；任何异常都输出 `Recovery-set manifest verification failed` 并返回非零退出码。SHA-256 证明完整性，不提供机密性。恢复集必须保存在加密、私有、最小权限的介质上，传输使用 TLS，且至少保留一份不同故障域副本。

最低建议：每日备份并保留 7 个日恢复点和 4 个周恢复点；备份成功、失败与超时接入外部告警；每月至少一次隔离恢复演练并记录 RPO、RTO、数据库行数、对象数、缺失对象和孤儿对象。

## 5. 执行恢复

恢复会删除目标桶中恢复集不存在的对象，并在已确认的目标数据库中执行 `DROP SCHEMA public CASCADE`、重建空 `public` schema 后加载归档。这样旧恢复点之后新增的表、类型和其他结构不会残留。不要对真实环境做试运行。先在隔离环境完成演练、重新备份当前目标、确认恢复集版本和密钥版本，然后安排维护窗口。

PowerShell：

```powershell
./deploy/scripts/restore.ps1 `
  -EnvFile .env.deploy `
  -RecoverySetDirectory ../ai-marriage-backups/ai-marriage-20260814T120000Z `
  -ConfirmDatabaseName ai_marriage `
  -ConfirmBucketName ai-marriage-photos
```

Linux/macOS：

```sh
ENV_FILE=.env.deploy sh deploy/scripts/restore.sh \
  ../ai-marriage-backups/ai-marriage-20260814T120000Z \
  ai_marriage \
  ai-marriage-photos
```

恢复脚本在任何破坏性动作之前完成以下门禁：

1. 严格验证 `manifest.sha256` 和恢复集全部文件。
2. 严格校验 `recovery-set.json`，要求其中的 `database.name`、`objectStorage.bucket` 与两个显式确认参数完全一致。
3. 要求 `ConfirmBucketName`/第三个 Shell 参数与 `.env.deploy` 的 `S3_BUCKET` 完全一致。
4. 从 PostgreSQL 容器读取实际 `POSTGRES_DB`，要求与确认参数完全一致。
5. 把 dump 复制到容器临时目录并用 `pg_restore --list` 检查格式。

门禁通过后，脚本执行以下步骤：

1. 停止 `gateway` 和 `api`。
2. 对已确认目标桶执行 `aws s3 rm --recursive`，清除当前对象视图。
3. 使用 `aws s3 cp --recursive` 上传恢复集中的每个对象；这一步不会采用 `sync` 的尺寸/更新时间跳过规则，因此目标端更新但同尺寸的错误对象也必定被覆盖。
4. 把目标桶完整下载到独立临时目录，调用 `verify-objects` 按对象键集合和 SHA-256 与恢复集清单逐项比较。
5. 只有远端对象校验通过后，才清空并重建目标 `public` schema，再执行 `pg_restore`、当前 Prisma 迁移和服务启动。

对象清空、上传、远端回读校验、数据库恢复或迁移任一步失败后，API 与网关保持停止，防止在半恢复状态继续写入。即使 `compose up` 已部分启动服务后返回失败，失败处理也会再次执行 `stop gateway api`。二次停服本身失败时脚本继续保持非零退出并明确告警，运维人员必须从容器状态和网关端口确认服务没有对外开放。

远端校验只证明当前对象内容和对象键集合与逻辑恢复集一致，不证明对象版本、标签、自定义元数据或存储策略一致。对象恢复期间也必须冻结所有 Compose 外部写入者和生命周期规则，否则它们可能在“上传完成”和“回读校验”之间改变目标桶。

本任务只提供并自动化测试脚本，没有对任何真实数据库或对象桶执行破坏性恢复。

## 6. 自包含 Demo 的备份与恢复

`compose.demo.yml` 同时包含 PostgreSQL、MinIO、API、Web 和 Gateway，因此可以安全地由同一脚本暂停该项目的写流量。PostgreSQL、MinIO S3 API 与 Console 都只绑定 `127.0.0.1`，默认分别使用 `5432`、`9000` 和 `9001`；可通过 `DEMO_POSTGRES_PORT`、`DEMO_MINIO_API_PORT` 和 `DEMO_MINIO_CONSOLE_PORT` 调整。

先启动 Demo 并确认健康，再创建完整恢复集：

```powershell
npm.cmd run demo:up
npm.cmd run demo:backup
```

备份默认写入仓库同级目录 `ai-marriage-backups`。恢复前先为当前 Demo 再创建一个恢复集，确认目标确实为 `ai_marriage` 数据库和 `ai-marriage-local` 桶，然后执行：

```powershell
npm.cmd run demo:restore -- `
  -RecoverySetDirectory ..\ai-marriage-backups\ai-marriage-<UTC时间>
```

Shell 使用同一底层逻辑：

```sh
ENV_FILE=deploy/demo.env \
COMPOSE_FILE=compose.demo.yml \
S3_CLIENT_ENDPOINT=http://127.0.0.1:9000 \
./deploy/scripts/backup.sh

ENV_FILE=deploy/demo.env \
COMPOSE_FILE=compose.demo.yml \
S3_CLIENT_ENDPOINT=http://127.0.0.1:9000 \
./deploy/scripts/restore.sh <恢复集目录> ai_marriage ai-marriage-local
```

这些命令要求宿主机安装 AWS CLI v2。恢复会删除目标桶现有对象、重建数据库 `public` schema、部署迁移并重启网页服务。当前自动测试使用伪基础设施验证失败门禁与脚本顺序，CI 使用真实 PostgreSQL/MinIO验证迁移和跨 API 重启持久化，但 CI 不执行破坏性恢复；仓库尚未声称真实恢复成功。

## 7. 恢复后验收

先检查容器和浅层健康状态：

```powershell
docker compose --env-file .env.deploy -f deploy/docker-compose.yml ps -a
docker compose --env-file .env.deploy -f deploy/docker-compose.yml logs --tail 200 migrate api postgres gateway
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

随后使用专用验收账号核对：

- 登录、资料、问答、审核状态、AI 分身知识与启用状态、匹配快照均可读取。
- AI 会话、真人聊天、消息回执、通知、举报证据、屏蔽、申诉、注销计划、审计和维护记录完整。
- 已审核与待审核照片仍遵守原权限，数据库中每个有效 `Photo.objectKey` 在私有桶存在。
- 内容发布、点赞、活动报名和管理员操作记录完整。
- SSE 能重新连接；持久消息可重新拉取，在线/输入状态从空状态重建属于正常现象。

`/healthz` 只是网关静态存活检查。API `/api/health` 会主动探测 PostgreSQL 数据库和 S3 兼容对象存储，任一关键组件失败时返回 `503`；它不调用短信或模型供应商，也不能替代上述完整业务验收。恢复演练不得使用真实用户手机号，也不得向真实用户发送短信。

## 8. 明确边界

仓库脚本不提供备份加密、密钥托管、定时调度、异地传输、保留清理、不可变归档、外部告警或云提供商快照编排。这些属于部署环境能力，但不能省略。对于正式生产，应由备份平台调用本脚本或提供商原生快照，并把同一恢复点的数据库、对象、应用 revision 与密钥版本作为一个不可拆分的恢复单元管理。
