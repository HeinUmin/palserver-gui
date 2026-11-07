# palserver GUI — v2.10.0-personal.1

基于上游 [v2.10.0](https://github.com/palserver-gui/palserver-gui/releases/tag/v2.10.0) 的个人非商业自用 Fork 版本，包含本仓库已合并的 PR #1–#6。本版本由 GitHub Actions 构建并发布，原项目许可证、版权和声明保留。

<details open>
<summary><b>🇨🇳 简体中文</b></summary>

### 本 Fork 的变更
- 个人非商业自用功能不再要求填写赞助识别码；保留原项目许可证与赞助入口。
- 修复 Agent Docker 镜像缺少游戏镜像构建上下文、运行依赖以及构建错误反馈的问题。
- 修复原生 Linux 游戏实例的目录权限及配置路径，允许游戏用户生成和写入 PalWorldSettings.ini。
- 修复修改 RCON 设置后 Docker 端口绑定未刷新的问题；重建容器时保留数据卷与网络。
- GUI 与游戏容器可共享 Docker 网络，通过容器名或固定别名解析。
- RCON、REST API 与 PalDefender API 合并为一个“统一管理访问地址”：支持 IP、域名、容器名或 HTTP(S) 地址；留空使用 localhost；端口分别从实例配置读取。旧版独立地址配置保留兼容，保存统一地址后切换为新配置。

### 下载与使用
| 文件 | 用途 |
| --- | --- |
| palserver-agent-windows.zip | Windows 免安装版 |
| palserver-agent-linux.zip | Linux 免安装版 |
| palserver-agent-macos.zip | macOS 免安装版 |
| palserver-web.zip | 独立部署的网页前端，需连接 Agent |
| palserver-agent-*.tar.gz | 含 Agent 与网页的更新包 |
| SHA256SUMS.txt | 下载文件的 SHA-256 校验值 |

解压对应系统的 ZIP，保留可执行文件旁的 web/ 和 LICENSE.md，然后运行 palserver-agent（Windows 为 palserver-agent.exe）。升级前备份数据目录；不要删除实例存档。架构与对应 Actions runner 一致。

**Docker 用户**：本次沿用上游的可执行文件与网页发布方式，未推送新的容器镜像。更新你的源码后，按仓库 Docker Compose 文档重新构建并启动 GUI，保留现有数据卷。使用共享网络时，在统一管理访问地址中填写游戏容器名或 palserver-<实例 ID>；留空仍表示 Agent 自身的 localhost。

**自动更新来源**：现有代码默认查询上游仓库。本 Fork 的免安装版若要检查本仓库的后续版本，请在启动 Agent 前设置 PALSERVER_GITHUB_REPO=HeinUmin/palserver-gui。此环境变量不会自动修改现有部署。

### 验证
发布基于已通过 CI 的主分支：类型检查、构建、连接地址与 Docker 回归测试，以及真实 Docker 的网络解析、端口绑定刷新和数据卷保留检查均通过。本次发布另由 Windows、Linux、macOS runner 分别构建安装包。

</details>

<details>
<summary><b>🇺🇸 English</b></summary>

### Fork changes
Personal noncommercial fork based on upstream v2.10.0, including merged PRs #1–#6: personal-use features without a sponsorship code; Docker build contexts and runtime dependencies; Linux write permissions and configuration paths; refreshed RCON port bindings with preserved volumes/networks; shared Docker networking; one management address with configuration-derived ports and a localhost default.

### Downloads
Download the ZIP matching your operating system, extract it with web/ and LICENSE.md, and run palserver-agent (palserver-agent.exe on Windows). The tar.gz archives support updates; palserver-web.zip contains only the frontend. Verify downloads with SHA256SUMS.txt. Back up data before upgrading.

Docker users should rebuild from source using the repository's Compose instructions; this release does not publish container images. To check this fork's future releases, set PALSERVER_GITHUB_REPO=HeinUmin/palserver-gui before starting the Agent; the existing default points upstream.

</details>

### License and acknowledgements
Original project: [palserver-gui/palserver-gui](https://github.com/palserver-gui/palserver-gui), by Dalufishe and contributors. This fork retains the original [LICENSE.md](https://github.com/HeinUmin/palserver-gui/blob/v2.10.0-personal.1/LICENSE.md) (PolyForm Noncommercial 1.0.0) and notices. This is a personal noncommercial fork release, independently maintained by HeinUmin.

[Upstream v2.10.0 release notes and acknowledgements](https://github.com/palserver-gui/palserver-gui/releases/tag/v2.10.0).
