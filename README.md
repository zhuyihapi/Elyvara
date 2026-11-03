# Elyvara

面向固定小组的 Windows P2P 屏幕共享与语音项目，当前仅完成 M0 工程骨架。

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

## 当前能力

Electron 本地静态窗口；启用 sandbox/contextIsolation，关闭 nodeIntegration；默认拒绝权限、导航和新窗口。不连接服务器，不请求捕获权限。尚无房间、STUN、WebRTC、共享、音频或网络诊断实现。

- `apps/desktop`：主进程与本地界面，目前无需 preload/IPC。
- `apps/signaling`：信令工作区占位，导入不开放端口。
- `packages/protocol`：协议版本，消息与运行时校验待 M0.3 实现。
- `packages/diagnostics`：明确区分未知路径与缺失测量的共享类型，实际采样待 M0.4 实现。

依赖版本由锁文件固定，Electron 自带的 Node 运行时与开发用 Node 版本分别管理。安装 Electron 需要下载官方二进制；开发下载代理与产品媒体路径是不同问题，切勿提交带认证的代理配置。

[初始规划](init-plan.md) · [开发 Project](https://github.com/users/zhuyihapi/projects/5) · [工程骨架任务](https://github.com/zhuyihapi/Elyvara/issues/3)

真实线路与媒体质量均未验收；缺失环境资料不妨碍离线工程开发，但仍是网络验收前提。下一步是 M0.3 信令和 M0.4 诊断，不把工程启动当成直连可用。
