# Lody OSS 自建控制面

本仓库提供两种明确分开的 OSS 运行模式：

- `local`：严格本机模式，不连接 Lody 官方服务，也不连接自建服务。
- `self-hosted`：仍使用 `~/.lody-oss`、`lody-oss://`、本机 CLI 端口 `17789` 和本机 Agent，同时把会话同步、机器目录、Web 控制和 ntfy 通知接到自己的 Loro Streams。

`self-hosted` 不需要 Lody 账号、Convex、官方机器配对、官方推送或遥测。它复用公开仓库已有的 machine-flock、Session Dispatch Watcher、Machine RPC、权限 RPC 和共享界面。控制面只转发状态与 RPC，不同步项目工作树，也不执行 Agent。

## 1. 拓扑与访问边界

推荐单用户拓扑：

```text
浏览器 ─┐
Mac ────┼─ Tailnet HTTPS ─ tan: Web + Streams + ntfy
Mac mini┤
Windows ┘

安装程序 ── 公网 HTTPS ─ tan:8443/lody-oss/
设备状态 ── SFTP/Restic ─ tan:/srv/lody-oss/device-backups
```

- Web、`/.well-known/lody-oss.json`、Streams `/ds/` 和 ntfy 只通过 Tailscale Serve 暴露。
- 公网 `8443` 只暴露安装包、`latest.yml`、`release.json` 和下载页。
- 每台工作机保留独立 `machineId` 和项目目录。会话创建后绑定原机器；目标离线时消息留在会话队列，机器恢复后继续。
- Tailscale ACL 是单用户自建版的访问边界。不要把控制 nginx 的 `127.0.0.1:18080` 或 ntfy 的 `127.0.0.1:8094` 直接绑定公网地址。

## 2. 自建配置

控制端在 `/.well-known/lody-oss.json` 返回版本化配置：

```json
{
  "version": 1,
  "controlOrigin": "https://tan.example-tailnet.ts.net",
  "workspace": { "id": "lw_...", "slug": "local", "name": "Lody" },
  "user": { "id": "local:...", "name": "Lody OSS" },
  "ntfy": {
    "baseUrl": "https://tan.example-tailnet.ts.net:8093",
    "topic": "lody-oss-example"
  },
  "downloads": {
    "pageUrl": "https://updates.example.com/lody-oss/",
    "macArm64Url": "https://updates.example.com/lody-oss/LodyOSS-0.89.0-arm64.dmg",
    "windowsX64Url": "https://updates.example.com/lody-oss/LodyOSS-0.89.0-x64-setup.exe"
  },
  "releaseManifestUrl": "https://updates.example.com/lody-oss/release.json"
}
```

客户端严格要求 HTTPS、无 URL 凭据、受支持的配置版本和完整字段。成功获取后会缓存配置，所以 tan 短时不可达不影响打开本地界面和本地数据。

桌面和 CLI 通过构建时的控制地址进入自建模式：

```bash
export LODY_OSS_CONTROL_URL='https://tan.example-tailnet.ts.net'
export LODY_OSS_UPDATE_URL='https://updates.example.com/lody-oss/'
```

Web 从当前同源的 `/.well-known/lody-oss.json` 加载配置，不嵌入官方服务地址。

## 3. tan 控制面

仓库中的 `ops/lody-oss/` 包含 nginx、systemd、ntfy 和配置模板。目标目录：

```text
/srv/lody-oss/web
/srv/lody-oss/control/streams.sqlite
/srv/lody-oss/releases
/srv/lody-oss/device-backups
/etc/lody-oss/config.json
```

部署前把 `ops/lody-oss/config.json` 中的 `__CONTROL_ORIGIN__`、`__NTFY_ORIGIN__`、
`__WORKSPACE_ID__`、`__USER_ID__` 和 `__NTFY_TOPIC__` 替换为本机 catalog 提取出的值；
模板本身不保存某个使用者的身份。

Streams 只监听 loopback：

```bash
loro dev \
  --db-path /srv/lody-oss/control/streams.sqlite \
  --host 127.0.0.1 \
  --port 8787 \
  --protocol http1
```

`@loro-dev/loro-cli` 0.6.0 的 dev server 在客户端中断已开始的响应时会再次写响应头，
造成 `ERR_HTTP_HEADERS_SENT` 和 systemd 重启循环。安装全局 CLI 后先应用仓库内的幂等补丁：

```bash
sudo node ops/lody-oss/patch-loro-cli-0.6.0.mjs
```

服务启动后还要确保固定的 `lody` bucket 存在；随仓库提供的 systemd unit 会用
`ExecStartPost` 幂等创建它。

`ops/lody-oss/nginx-control.conf` 在 `127.0.0.1:18080` 提供 Web、配置和 `/ds/` 同源反代。ntfy 在 `127.0.0.1:8094` 监听，并设置：

```yaml
upstream-base-url: https://ntfy.sh
```

这让 iOS 使用上游唤醒通道；通知正文仍从自建 ntfy 读取。Tailscale Serve 配置为：

```bash
tailscale serve --bg --https=443 http://127.0.0.1:18080
tailscale serve --bg --https=8093 http://127.0.0.1:8094
```

浏览器打开 tan 的 Tailnet HTTPS 地址即可进入固定 workspace。自建模式的“添加机器”不会调用官方 pairing；它打开自己的下载页。新设备加入同一 Tailnet、安装并启动自建桌面后，会通过 machine-flock 自动出现在机器菜单中。

## 4. 构建桌面与 Web

只构建需要的目标：Apple Silicon DMG、Windows x64 NSIS 和 Web 静态包。

```bash
pnpm install --frozen-lockfile

LODY_OSS_CONTROL_URL='https://tan.example-tailnet.ts.net' \
LODY_OSS_UPDATE_URL='https://updates.example.com/lody-oss/' \
  pnpm --dir apps/electron run build

LODY_OSS_CONTROL_URL='https://tan.example-tailnet.ts.net' \
LODY_OSS_UPDATE_URL='https://updates.example.com/lody-oss/' \
  pnpm --dir apps/electron run package -- --mac --arm64 --version=0.89.0 --publish never

pnpm --filter @lody/web-oss build
```

### macOS

首版没有 Developer ID，只生成 `LodyOSS-0.89.0-arm64.dmg`，不生成 ZIP 或 `latest-mac.yml`。应用每 30 分钟读取 `release.json`；发现新版本时显示“下载新版”并打开 DMG，不尝试 Squirrel.Mac 静默安装。

个人使用不必购买 Apple 证书。首次安装对 DMG 中的应用使用 Finder 右键“打开”即可放行。将来要无警告分发、公证或静默更新时，再启用 Developer ID 签名、公证、ZIP 和 `latest-mac.yml`。

### Windows

Windows 生成 x64 NSIS、blockmap 和 `latest.yml`。无 Authenticode 时首次安装可能出现 SmartScreen；自建构建关闭更新代码签名验证，但仍使用 HTTPS 和 `latest.yml` 的 SHA-512 校验。已下载的更新在正常退出、CLI 和会话收尾完成后安装。

### 发布顺序

`scripts/build-lody-oss-release-manifest.mjs` 校验文件名、大小和 SHA-512 后生成 `release.json`。发布顺序必须是：

1. 版本化 DMG、EXE 和 blockmap。
2. `latest.yml`。
3. 最后原子替换 `release.json`。

`.github/workflows/release-electron.yml` 在 GitHub Actions 构建三种产物，GitHub Release 只作为镜像，客户端实际读取自建更新源。

## 5. 加密会话备份

桌面正常退出时，Electron 会先停止内置 CLI，再执行最多 90 秒的 Restic 备份。失败不会无限阻塞退出；若配置了 `ntfyUrl`，会发送不含会话内容的失败通知。

`~/.lody-oss/backup-config.json` 示例：

```json
{
  "version": 1,
  "repository": "sftp:lodybackup@tan:/srv/lody-oss/device-backups",
  "resticPath": "/opt/homebrew/bin/restic",
  "passwordCommand": "security find-generic-password -a mac -s lody-oss-restic -w",
  "sftpCommand": "ssh -i /Users/me/.ssh/lody_oss_backup_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes lodybackup@tan -s sftp",
  "ntfyUrl": "https://tan.example-tailnet.ts.net:8093/lody-oss-example"
}
```

备份包含 catalog、identity、machine-id、loro-repo、chats、orchestration、session-files 和 Electron 设置；不包含 `run/`、socket、锁、npm cache、下载的 Agent 或 Git 工作树。密码由系统 Keychain 或 root-only 文件提供，不能放进仓库或命令参数。

每日兜底任务：

```bash
scripts/install-lody-oss-backup-launch-agent.sh
```

LaunchAgent 每天 03:30 运行 `lody-oss-restic-backup.sh`。Lody 或 `17789` 仍在运行时安全跳过；正常退出钩子仍是主备份路径。

恢复时必须先停止目标 Lody 和 CLI，然后把 Restic 快照恢复到隔离目录检查。不要让两台运行中的机器共享同一个 `.lody-oss` 或 `machineId`。项目代码通过 Git 恢复，不属于会话备份。

旧的 `scripts/lody-oss-state.sh` 保留为单机、停机、未加密的 tar 快照工具，适合迁移前再留一份本地不可变副本；跨设备日常备份使用 Restic。

tan 的中央 Streams 使用 `ops/lody-oss/lody-oss-control-backup.sh` 先执行 SQLite
`.backup` 和 `PRAGMA integrity_check`，再写入 Mac mini 的 Restic 仓库。配置好
`/etc/lody-oss/control-backup.env` 后才启用 daily backup timer 和 weekly check timer；
目标仓库未接入时保持两者 disabled，不能把 tan 本机副本误报为异机备份。

## 6. 通知与安全边界

自建通知覆盖会话完成、会话失败、权限请求和备份失败。正文只含机器名、会话标题、简短状态和 Web 会话链接；不发送完整提示词、命令输出或文件内容。权限仍在 Web 中批准，ntfy 不提供另一套审批 API。

本实现不提供 Lody 官方账号、团队、计费、APNs 应用、Live Activities、官方 Convex、运行中会话迁移、自动创建云 VM 或共享工作树。它提供的是单用户自建控制面：浏览器选择在线工作机创建会话，并继续、停止或批准原机器上的 Agent。

## 7. 验证

最小验证命令：

```bash
pnpm check:public-boundary
pnpm check:platform-boundaries
pnpm --filter @lody/platform test
pnpm --filter @lody/platform typecheck
pnpm --filter @lody/components typecheck
pnpm --filter @lody/cli typecheck
pnpm --dir apps/electron run typecheck
pnpm --filter @lody/web-oss typecheck
pnpm --filter @lody/web-oss test
pnpm --filter @lody/web-oss build
scripts/lody-oss-restic-backup.test.sh
scripts/lody-oss-state.test.sh
```

上线后还要从 Tailnet 内实际验证 Web、Streams、三台 machine-flock 在线、会话定向执行、权限批准和 ntfy；并从公网验证控制面 URL 不可达而下载目录可达。
