# SciFork

[![发布工作流](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml) [![DSH 插件](https://img.shields.io/badge/DeepSeek_Harness-plugin-0f766e.svg)](https://github.com/topics/dsh-plugin) [![许可证：MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![SciFork — Git 原生生物医学研究图谱：文献驱动、本地优先、历史可追溯。](docs/assets/scifork-banner.png)

[English](README.md) | [简体中文](README.zh-CN.md)

> 拆分假设，连接证据，推进研究。

SciFork 是面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)
的本地、Git 原生生物医学研究图谱（Research Graph）插件。你仍然在 DSH Chat 中完成
所有对话界面，SciFork 则打开一个与 DSH 同源的图谱 Companion，帮助组织研究问题
（Research Question）、假设（Hypothesis）、证据（Evidence）、研究结果（Result）和
研究发现（Finding）。

研究项目（Research Project）始终是本地 Git 仓库中的普通 Markdown 和 JSON 文件。
图谱只是这些文件可重建的视图，不是另一个数据库；SciFork 不会上传项目，也不提供
云同步。

> **早期版本：** SciFork `0.0.3` 锁定 DSH `0.2.1-rc.2`（DeepSeek Harness 桌面端
> `0.2.1-rc.2`，nightly 渠道，或同版本 Web profile）的公开接口。桌面端自动更新后
> 运行时进入未验证状态，Companion 会显示未验证版本警告条，直至重新钉住版本。

## 你可以做什么

- 把一个开放式研究问题整理成相互连接、便于检查的研究图谱。
- 导入以 PMID 或 DOI 标识的文献证据：检索来源为已安装的外部检索插件（如
  `dsh-pubmed`）、DSH web 检索降级或手动粘贴的来源文字。
- 将研究团队产生的结果、对结果的解释和未经验证的假设清楚地区分开。
- 在 **Main** 视图查看整个项目，或在 **Evidence** 视图聚焦某个实体的直接证据断言。
- 点击 **Research & Expand**，从当前焦点（Focus）执行一次文献驱动的扩展。每次点击只执行
  一步，最多产生五条直接相连的低置信分支。
- 每次成功修改研究内容后，尝试只为 SciFork 受管文件创建本地 Git 检查点。

## 安装

SciFork 以 DSH 插件包（`dsh-scifork`）分发，直接在 DeepSeek Harness 内安装，
无需命令行。

前置条件：DSH `0.2.1-rc.2`（桌面端或同版本 Web）仅监听本机回环，以及已配置
`user.name` 和 `user.email` 的 Git。

### 从插件面板安装（桌面端与 Web，推荐）

1. 在侧栏打开 **插件**，点击 **添加插件**。
2. 输入 Git 仓库地址：

   ```text
   zhang-bin-98/sci-fork
   ```

3. 点击 **安装**。出现镜像提示时，GitHub 不可达会自动提供中国大陆镜像；如果
   pnpm 询问构建脚本，使用对话框提供的 **允许这些脚本并重试**。安装会从 Git
   源码在本地构建插件。
4. 安装完成后选择 **立即启用**。如果 Research Graph 入口没有立刻出现，重启一次
   应用。

如果你的环境启用了插件管理 agent 工具，也可以直接在会话中让模型安装
`zhang-bin-98/sci-fork`。

### 安装已校验的 Release 压缩包（可选）

1. 从 [GitHub Releases 页面](https://github.com/zhang-bin-98/sci-fork/releases)
   下载 `dsh-scifork-0.0.3.tgz` 与对应 `.sha256` 并校验（Linux 用
   `sha256sum -c`，macOS 用 `shasum -a 256 -c`，Windows 用 `Get-FileHash`）。
2. 在 **添加插件** 中输入压缩包的本地绝对路径。

### 命令行（进阶）

`dsh plugin` 命令可向指定 profile 安装，适合自动化。修改桌面 profile 前必须
完全退出应用；Web profile 可在运行中更新（之后重启 DSH）。

```sh
dsh plugin --profile desktop add git+https://github.com/zhang-bin-98/sci-fork.git
dsh plugin --profile web add ./dsh-scifork-0.0.3.tgz
```

本地构建 Git 源码需要 Corepack 的 pnpm 入口（`corepack enable pnpm`；在源码
目录运行 `corepack pnpm verify:source` 可执行隔离源码安装验证）。卸载时在插件
页面选择 **移除**，或执行 `dsh plugin --profile <name> remove dsh-scifork`。

## 第一次使用

请选择不位于其他 Git 仓库内的目录，或者使用本身就是 Git 仓库根目录的目录。在 DSH
Chat 中对当前目录执行一次初始化：

```text
/research init
```

SciFork 会创建项目文件；如果当前目录还不是 Git 仓库，则初始化一个本地仓库；然后记录
基线检查点。完成后，从 DSH 右侧栏 guide 卡片或侧栏底部按钮打开 **Research
Graph**。

一个典型的研究流程是：

1. 在 DSH Chat 中描述开放式生物医学问题。SciFork 会把它记录为研究问题，而不是直接
   当作已成立的主张。
2. 请 DSH 检索相关文献，再将有依据的断言导入项目。检索是外置的：使用已安装的
   检索插件（如 `dsh-pubmed`）、DSH web 检索降级，或手动粘贴来源文字；解析不出
   合格 PMID/DOI 与真实来源文字的记录会被跳过。
3. 打开 **Research Graph**，检查问题、证据、假设、结果、发现及其关系。
4. 选中一个实体，需要继续探索时点击 **Research & Expand**，执行一次有界扩展。
   只有在当前 DSH Chat 中明确请求 Progressive Research Run，才会开始多层探索。
5. 将机器审核证据（machine-reviewed Evidence）接受为人工审核证据前，请先人工核对。
   只有人工审核证据或已验证的研究结果才能支持研究发现。
6. 随时可以检查项目：

```text
/research validate
```

图谱 Companion 用于浏览和检查。研究、纠正内容或修改图谱仍然通过 DSH Chat 提出。

## 数据与安全

SciFork 设计为在 DSH 本地 loopback Web 服务中使用。文献、PDF、模型输出和项目
Markdown 都会被视为不可信数据，Companion 不会自动加载远程内容。检索结果可能保留在
当前 DSH Chat 中，但 SciFork 不会把完整摘要或 PDF 保存到 Research Project。

提交或分享 Research Project 前，请检查其中是否包含 PHI、PII 或受控访问数据。完整的
数据和网络边界请参阅 [SECURITY.md](SECURITY.md)。

## DSH 生态与分发

SciFork 遵循 DSH 的公开 bundle 规范：包导出 `name` 和 `apply(ctx)`，在
`package.json#dsh.bundle` 中声明 `cordis.patch.yml`，并可通过 DSH 插件命令安装。
DSH 建议公开插件仓库添加官方推荐的
[`dsh-plugin` 话题](https://github.com/topics/dsh-plugin)，以便在生态中被发现。

独立社区目录 [DSH Plugin Hub](https://dsh-plugin.org) 会扫描该话题，并可能收录
符合条件的仓库。它由社区维护，不是 DeepSeek AI 运营或背书的官方市场。已经发布的
`v0.0.1` 仍然只支持 tarball；`v0.0.2` 及后续版本同时支持 GitHub 源码构建和带
checksum 的 GitHub Release tarball。SciFork 不发布到 npm。

## 许可证

SciFork 使用 [MIT License](LICENSE)。Research Project 数据可能有独立的所有权和分享条款。
