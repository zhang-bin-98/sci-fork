# SciFork

[![发布工作流](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml/badge.svg)](https://github.com/zhang-bin-98/sci-fork/actions/workflows/release.yml) [![DSH 插件](https://img.shields.io/badge/DeepSeek_Harness-plugin-0f766e.svg)](https://github.com/topics/dsh-plugin) [![许可证：MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![SciFork — Git 原生生物医学研究图谱：文献驱动、本地优先、历史可追溯。](docs/assets/scifork-banner.png)

[English](README.md) | [简体中文](README.zh-CN.md)

> 拆分假设，连接证据，推进研究。

SciFork 是面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)
的本地、Git 原生生物医学**研究图谱**插件。`dsh-pubmed` 这类检索插件负责找文献；
SciFork 负责把找到的内容沉淀为可审计的科研知识：每条断言绑定 PMID/DOI 与精确定位，
机器审核与人工审核分离，主张必须通过明确的证据门槛才能成为研究发现（Finding），
每次修改都是普通 Markdown/JSON 文件上的本地 Git 检查点。SciFork 自身不做检索，
也不绑定任何检索插件——已安装的检索插件、DSH web 检索或手动粘贴的来源文字均可作为
来源，整个项目渲染为 DSH 右侧栏中的研究图谱。

> **早期版本：** SciFork `0.0.3` 锁定 DSH `0.2.1-rc.2` 的公开接口。桌面端自动更新后
> 运行时进入未验证状态，图谱会显示未验证版本警告条，直至重新钉住版本。

## 你可以做什么

- **深度研究**——在会话中明确提出请求，SciFork 执行有界的多层研究：每层完成检索、
  保存机器审核证据、保留全部合格分支，并自动选择一个新假设继续下一层，直至覆盖你的
  研究范围。
- **一键扩展**——选中任意实体点击 **Research & Expand**，执行一次有依据的单步扩展
  （最多五条直接相连的低置信分支）。
- **可审计的证据**——每条断言携带 PMID/DOI、定位与审核理由；机器审核与人工审核分开
  计数，只有人工审核的证据（或已验证的研究结果）才能支持研究发现。
- **可读的图谱**——在侧栏的 **Main** / **Evidence** 视图中组织研究问题、假设、预测、
  结果与发现。
- **纯文件 + Git**——项目就是普通 Markdown/JSON 文件；每次修改尝试创建本地 Git
  检查点。没有数据库，没有云同步。

## 安装

**从插件面板安装（推荐）**：在侧栏打开 **插件**，点击 **添加插件**，输入
`zhang-bin-98/sci-fork`，安装（如询问构建脚本则允许），然后 **立即启用**。

**在会话中安装**：直接对模型说——“帮我安装 DSH 插件 zhang-bin-98/sci-fork”。

两种方式都会从 Git 源码在本地构建插件。卸载时在插件页面选择 **移除**。

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
   多层探索（深度研究）只有在当前 DSH Chat 中明确请求 Progressive Research Run
   时才会开始。
5. 将机器审核证据（machine-reviewed Evidence）接受为人工审核证据前，请先人工核对。
   只有人工审核证据或已验证的研究结果才能支持研究发现。
6. 随时可以检查项目：

```text
/research validate
```

研究图谱用于浏览和检查。研究、纠正内容或修改图谱仍然通过 DSH Chat 提出。

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
