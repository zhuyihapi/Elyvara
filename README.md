# Elyvara

面向固定小组的 Windows P2P 屏幕共享与语音项目，当前包含 M0 客户端骨架、最小房间信令和 STUN-only 部署配置。公网 WSS 证书仍需按部署条件配置。

## 本地开发

Windows 11 x64，Node.js 24 LTS，npm 11。在仓库根目录运行：

```powershell
npm ci
npm run check
npm run smoke
npm start
```

`npm start` 使用构建后的本地文件，修改源码后重新执行 `npm run build`。关闭窗口退出。

`npm run smoke` 启动真实 Electron，验证页面加载、CSP、sandbox/contextIsolation 和渲染层无 Node 后自动退出。首次启动可能下载官方 Electron 二进制，需要网络可达。

当前依赖审计报告开发用 ESLint 工具链的 minimatch 中危告警（10个受影响依赖条目）；不盲目应用跨大版本降级修复。尚未进行安装包分发或媒体功能验收。

## 信令开发

`npm run start:signaling` 启动回环地址上的开发服务（默认 `127.0.0.1:8080`）。`npm test` 用真实 WebSocket 连接验证房间权限、转发、限流及 TLS；需要 OpenSSL CLI。Windows 可设置 `$env:OPENSSL_BIN="C:\Program Files\Git\usr\bin\openssl.exe"`（若已安装 Git for Windows），其他环境使用 PATH 中的 openssl。测试端口随机分配，测试证书显式信任，仅用于本地测试并自动删除。

[信令契约](docs/signaling.md) · [部署与回退](docs/deployment.md)。可信 WSS 可使用 IP 证书，不强制购买域名；不允许关闭证书校验。STUN 仅地址发现，禁止 TURN 媒体中继。

## 当前能力

Electron 仍是本地静态窗口；启用 sandbox/contextIsolation，关闭 nodeIntegration；默认拒绝权限、导航和新窗口。客户端尚未接入服务，不请求捕获权限。房间和共享租约已在服务端实现，但尚无客户端房间界面、WebRTC、屏幕/音频或网络诊断界面。

- `apps/desktop`：主进程与本地界面，目前无需 preload/IPC。
- `apps/signaling`：内存房间、邀请审批、成员定向信令、共享租约、限流和清理；入口单独启动。
- `packages/protocol`：协议版本与 Zod 客户端消息运行时校验。
- `packages/diagnostics`：明确区分未知路径与缺失测量的共享类型，实际采样待 M0.4 实现。

依赖版本由锁文件固定，Electron 自带的 Node 运行时与开发用 Node 版本分别管理。安装 Electron 需要下载官方二进制；开发下载代理与产品媒体路径是不同问题，切勿提交带认证的代理配置。

[初始规划](init-plan.md) · [开发 Project](https://github.com/users/zhuyihapi/projects/5) · [工程骨架任务](https://github.com/zhuyihapi/Elyvara/issues/3)

真实好友线路与媒体质量均未验收；缺失环境资料不妨碍离线工程开发，但仍是网络验收前提。后续需完成公网 WSS 证书启用、M0.4 客户端连接与诊断，不把服务启动当成好友直连可用。
