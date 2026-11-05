# Elyvara

面向固定小组的 Windows P2P 屏幕共享与语音项目，当前包含 M0 直连测试客户端、Go 房间信令和 STUN-only 部署配置。公网 WSS 证书仍需按部署条件配置。

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

安装 Go 1.27 并加入 PATH 后，`npm run start:signaling` 启动 Go 服务（默认 `127.0.0.1:8080`）。`npm test` 检查两端共用的 v1 样例，并用真实 WS/WSS 测试房间和权限。`npm run build:signaling` 输出本机可执行文件。

[信令契约](docs/signaling.md) · [部署与回退](docs/deployment.md)。可信 WSS 可使用 IP 证书，不强制购买域名；不允许关闭证书校验。STUN 仅地址发现，禁止 TURN 媒体中继。

## 当前能力

本地测试时先在一个终端运行 `npm run start:signaling`，再在另一个终端运行 `npm start`。使用默认回环信令地址连接。输入昵称、创建房间并复制邀请信息。其他实例粘贴邀请后申请加入，房主审批后建立逐成员连接。点击「发送测试图案」开始发送 640×360 合成视频。测试结束后停止图案、退出房间或关闭窗口。

「检查 STUN」可主动查看是否观察到 srflx。加入房间后，界面每秒更新候选路径、地址族、传输协议、速率和 RTT。「导出脱敏诊断」保存当前摘要。详细步骤和验收范围见 [M0 直连测试](docs/direct-probe.md)。

- `apps/desktop`：主进程信令、沙盒 preload、房间和直连诊断界面。
- `apps/signaling`：内存房间、邀请审批、成员定向信令、共享租约、限流和清理；入口单独启动。
- `packages/protocol`：协议版本与 Zod 客户端消息运行时校验。
- `packages/diagnostics`：区分未知路径与缺失测量的共享类型。客户端在逐成员连接中采样并导出摘要。

依赖版本由锁文件固定，Electron 自带的 Node 运行时与开发用 Node 版本分别管理。安装 Electron 需要下载官方二进制；开发下载代理与产品媒体路径是不同问题，切勿提交带认证的代理配置。

[初始规划](init-plan.md) · [开发 Project](https://github.com/users/zhuyihapi/projects/5) · [工程骨架任务](https://github.com/zhuyihapi/Elyvara/issues/3)

真实好友线路、媒体质量和公网 WSS 仍待验收。M0 客户端使用合成视频，实际屏幕采集与语音属于后续阶段。
