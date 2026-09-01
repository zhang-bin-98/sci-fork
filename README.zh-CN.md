# SciFork

[English](README.md) | [简体中文](README.zh-CN.md)

[![发布工作流](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 拆分假设，连接证据，推进研究。

SciFork 是面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)
的本地、Git 原生生物医学 Research Graph 插件。DSH Chat 仍然是唯一的对话界面；
SciFork 在其旁边打开同源 Graph Companion，把普通 Research Project 转换为可重建、
可审计的图谱。

## SciFork 做什么

科研工作经常同时包含文献主张、团队观察和仍需验证的想法。SciFork 将它们分开，
同时让关系保持可检查：

- **Research Project 是事实源。** 本地 Git 仓库中的 Markdown 和 JSON 文件保存项目；
  图谱、摘要和模型上下文都只是可重建的投影。
- **独立图谱 Companion。** 在 DSH 的 `Research Graph` 操作中打开响应式 Companion。
  它使用现有 DSH Web origin，不新增服务器、数据库、登录或云同步。
- **有明确审核边界的 Evidence。** Evidence Assertion 保存 PMID 或规范化 DOI、精确
  locator 和最小 Citation Snapshot。 `machine_reviewed` Evidence 可以用于探索；
  只有人工 `reviewed` Evidence 或 validated Result 才能支持 Finding。
- **文献驱动的扩展。** 真实点击 `Research & Expand` 后执行一次先检索的有界扩展，
  保留零至五条直接、低置信分支。Focus 不会移动，也不会在后台递归。
- **两个轻量 Skill。** `pubmed-search` 检索 PubMed 记录和有界摘要；
  `scifork-research` 将检索材料格式化为导入 Draft，并通过 SciFork typed tools
  引导受保护的图谱变更。必须先完成检索，再进行格式化。PubMed 支持完整查询语法、
  分页元数据（每页最多 300 条），以及带可选有界摘要的 PMID/DOI lookup。
- **本地 Git 检查点。** 成功变更会尝试在当前分支只提交 SciFork 受管路径。分支、
  远端、历史恢复和共享由用户控制。

## 数据模型概览

```text
Research Question
       | addresses（Framing Link）
       v
Hypothesis ---- supports / contradicts ----> Finding
       ^                                      ^
       | predicts                             | reviewed Evidence
Prediction                                      ^
                                                | PMID / DOI + locator
                                      Publication Reference
```

开放式询问是 **Research Question**，不是未经验证的 Hypothesis。研究团队的观察是
**Result**，与解释分开。**Framing Link** 只表示某个主张试图回答某个问题，不是
科学 Edge。Publication identity 直接保存在 Evidence 中，SciFork 不创建 Publication
或 Source 节点。Machine-reviewed Evidence 仍是临时探索依据，不能满足 Finding 或
文献 Edge 的门槛。完整术语见 [CONTEXT.md](CONTEXT.md)。

## 当前状态

仓库包含已实现的 M0 兼容性基线以及 M1 Core、M2 Companion、M3 Research 里程碑。
当前包名为 `dsh-scifork`，版本为 `0.0.1`，锁定公开 DSH `0.1.1-rc.2`
契约。这是一个早期、兼容性锁定的版本；DSH 预览 API 与研究流程可能一起演进。

DSH bundle 接口保持最小化：`index.js` 是插件入口，
`package.json#dsh.bundle.patch` 指向 `cordis.patch.yml`，浏览器 bundle 通过
`exports["./client"]` 暴露。该 package 只包含一个 first-party bundle，不依赖其他
DSH 插件。

## 安装

### 前置条件

- DSH `0.1.1-rc.2` 的 Web profile
- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.23.0`（建议使用 Corepack）
- 监听 `127.0.0.1` 的 loopback DSH Web 服务

请使用 Web profile，而不是只有基础服务的 base-only profile；SciFork 需要 DSH 的
Web、filesystem、tools、storage、session 和 subprocess 服务。

### 安装 GitHub Release

每个 Release 包含一个预构建 tarball 和同名 SHA-256 文件。先从
[Releases](https://github.com/zhang-bin-98/sci-fork/releases) 下载两个文件，
再校验 tarball。

Linux：

```sh
sha256sum -c dsh-scifork-0.0.1.tgz.sha256
```

macOS：

```sh
shasum -a 256 -c dsh-scifork-0.0.1.tgz.sha256
```

Windows PowerShell：

```powershell
$asset = 'dsh-scifork-0.0.1.tgz'
$checksum = $asset + '.sha256'
$expected = (Get-Content $checksum).Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $asset -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 verification failed' }
```

校验通过后，将归档安装到 DSH Web profile，并从包含 Research Project 的目录启动：

```sh
dsh plugin --profile web add ./dsh-scifork-0.0.1.tgz
dsh --profile web
```

在 DSH 中执行 `/research init` 创建项目，然后点击侧栏的 **Research Graph**。
`/research validate` 会报告项目诊断和 revision。卸载时执行：

```sh
dsh plugin --profile web remove dsh-scifork
```

`dsh plugin` 会把剩余参数转发给所选 profile 目录中的 pnpm。安装或卸载 bundle 后，
请重启 DSH 或刷新页面。

### 从源码 checkout 安装

开发或审阅变更时，在仓库根目录执行：

```sh
corepack pnpm install
corepack pnpm check
dsh plugin --profile web add .
dsh --profile web --dump-config
```

`pnpm check` 会运行严格 TypeScript 检查、Vitest 测试和生产构建。最后一条命令的
配置中应恰好有一个 `scifork` bundle。源码安装前必须先构建；Release tarball
始终包含生成的 `dist/` 资源。

## 典型流程

1. 打开 Research Project，首次执行 `/research init`。
2. 提出开放式问题。`scifork-research` 会将其记录为 Research Question，并保留
   明确的范围假设。
3. 使用 `pubmed-search`（或其他检索/PDF Skill）取得真实来源材料，再加载
   `scifork-research` 格式化并校验导入 Draft。
4. 在 Companion 查看图谱。Evidence 默认隐藏，需要时打开 **Show evidence**。
5. 选中问题或主张并点击 **Research & Expand**，执行一次有界的文献优先扩展。
   Chat 正在运行时请求会排队，空闲时会立即开始。多层探索必须在 DSH Chat 中明确
   请求 Progressive Research Run。
6. 在将 machine-reviewed Evidence 接受为人工 reviewed 前先完成人工审阅；只有之后
   才能计入 Finding 的支持门槛。
7. 分享项目或创建检查点前执行 `/research validate`。

## 安全与数据边界

SciFork 面向本地研究数据：

- Web 服务必须只监听 loopback，Companion 与 DSH 同源。Page Key 绑定 Session 和
  Project，仅保存在内存和 window-scoped storage 中，不作为路径或查询参数使用。
- Publication、PDF、摘要、Draft、Result 和 Markdown 都是不可信数据。Markdown 的
  HTML、脚本和自动远程资源加载均已禁用。
- SciFork 只保留最小 publication identity、Citation Snapshot、派生 assertion、审核
  理由和有界 Edge provenance；不缓存完整元数据、摘要、PDF、全文或原始 provider response。
- 检索输出可能保留在当前 DSH Chat 中；SciFork 没有删除该 Chat 历史的公开契约。
- 将包含 PHI、PII 或受控访问数据的项目提交或共享 Git 前，请自行评估风险。SciFork
  不会自动上传研究数据。

使用真实研究数据前请阅读 [SECURITY.md](SECURITY.md)。

## 范围与非目标

当前版本不提供第二套聊天界面、后台自动研究、按钮递归、远程后端、数据库、云同步、
全文摄取、自动 MeSH 扩展、PubTator、缓存、RAG 或 SciFork 自有的 Git 历史恢复。
它也不依赖 `dsh-better-sidebar` 或其他第三方 DSH 插件。

## 开发与发布

仓库是一个 pnpm package 和一个 first-party DSH bundle。常用命令：

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm verify:pack
corepack pnpm check
node --check index.js
```

当前仓库唯一的 GitHub Actions 工作流是
[release.yml](.github/workflows/release.yml)。它只在推送匹配宽规则 `v*` 的 tag
时触发，**不会**在 Pull Request 或普通分支 push 时运行 CI。随后工作流要求 tag
精确等于 `v<package.json version>`、其 commit 位于默认分支、已选择的许可证元数据和根
许可证文件存在、无 `workspace:*` 依赖，并在 check/build/pack/真实归档检查全部通过后，
向新的 GitHub Release 发布一个 tarball 和对应 checksum。它不会创建 tag、推送分支、
发布 npm 或隐式运行 DSH 冒烟测试。

启用发布前，请在 GitHub 配置 active 的 `v*` tag ruleset，并将 tag 创建、更新、
删除和 bypass 限制给发布维护者。完整契约和失败行为见
[GitHub Release Automation](docs/specs/github-release-automation.md)。

当前分发渠道是 GitHub Releases。仓库不会发布到 npm，也不会自动登记 DSH 插件市场；
如果你的 DSH 部署提供市场，市场提交需要由维护者另行完成。

发布时，维护者先更新 `package.json#version`，将变更提交并合并到默认分支，再创建并
推送完全匹配的 tag：

```sh
git tag v0.0.1
git push origin v0.0.1
```

推送 tag 会启动工作流。工作流不会替你修改版本、创建 tag 或推送分支。

## 文档

- [产品设计](docs/scifork-product-design.md)
- [软件架构](docs/scifork-software-architecture.md)
- [领域语言](CONTEXT.md)
- [M0 兼容性 spike](docs/specs/m0-compatibility-spike.md)
- [渐进式研究扩展](docs/specs/progressive-research-expansion.md)
- [Research Question 与 machine-reviewed Evidence](docs/specs/research-questions-machine-review.md)
- [安全策略](SECURITY.md)

## 贡献

请先阅读 [AGENTS.md](AGENTS.md) 中的规格驱动和测试驱动开发规则。非平凡变更应先
更新对应规范、推导聚焦测试、运行 `corepack pnpm check`，并在工作分支中完成。
不要在 issue 或 Pull Request 中提交研究数据、凭据、Page Key、prompt 或本地路径。

## 许可证

SciFork 使用 [MIT License](LICENSE)。第三方依赖和复制的材料仍受其各自许可证和声明约束。
Research Project 数据的共享许可由项目所有者决定。
