# SciFork 检索外置（外部检索 provider 契约）

> 状态：Approved（设计定稿；implementation pending）
> 日期：2026-10-18
> 上位设计：[产品设计 v0.21](../scifork-product-design.md) §1/§7/§8/§9；
> [软件架构 v0.22](../scifork-software-architecture.md) §1 决策 10、§10.3/§10.4
> 决策来源：2026-10《检索 Dify 科研论文插件》调研会话与用户决定；
> 2026-10-18 用户确认纳入本批次文档修订
> 取代关系：取代产品 §8 与架构 §10.3 的 `pubmed-search` packaged Skill 条款；
> M0/M3 spec 中相关内容为历史记录，不回改。与右侧栏迁移
> （[dsh-desktop-right-sidebar](./dsh-desktop-right-sidebar.md)）正交，同批次实施。

## Problem

SciFork 此前自带 `pubmed-search` Skill（SKILL.md + Entrez helper），但 DSH 生态已
出现覆盖面更广的开源检索插件（多数据库、引文、OA PDF 发现），继续维护自带检索
实现与 SciFork 的价值定位（图谱、证据审核、Git）不匹配，也带来 NCBI 速率、分页
与响应格式的持续维护成本。调研会话确认了外部插件选型与降级边界，本 spec 把该
决定固化为权威设计。

## Confirmed decisions（调研会话结论，2026-10 确认）

1. **完全移除** package-owned `pubmed-search` Skill：`skills/pubmed-search/`
   （SKILL.md、`scripts/pubmed.mjs`）、Host 的 directory `resourceBase` 注册、
   相关打包清单与测试。
2. **检索由外部 DSH 插件承担**；推荐 **dsh-pubmed**（Apache-2.0，README 记
   "tested with" 版本，当前 0.4.4）作为参考实现——推荐与冒烟验证对象，
   非依赖、非保证、不打包分发。
3. **降级阶梯**：外部插件 → DSH web 检索 → 用户手动粘贴；各级通过标准相同
   （合格 PMID/DOI + 真实来源文字），解析不出合格标识即中止，不降标准。
4. `scifork-research` 成为**唯一 package-owned Skill**：catalog description 保留
   “检索先行”硬边界（顺序约束必须出现在 description 中，M0 教训），正文写降级阶梯。
5. **lookup-only 校验助手**（PMID/DOI 存在性核验，建议 Europe PMC 单源）为后续
   任务，本期不实现。
6. ChatGPT "Life Sciences Literature" 插件为专有许可证，仅作设计参考，不复制代码；
   Sci-Hub 类插件有法律风险，不采用。

## Goals

1. SciFork 包内不再含任何检索实现、检索网络客户端或上游 API 约束。
2. 外部检索 provider 有明确的消费契约，任何满足契约的插件都可替换使用。
3. 检索缺失或不足时的行为确定：降级阶梯与明确中止，不降标准、不伪造记录。
4. Draft 契约记录真实检索来源。

## Non-goals

- 不把任何第三方 DSH 插件作为运行依赖、peerDependency 或打包分发物（仓库红线）。
- 不实现 lookup-only 存在性校验助手（后续任务）。
- 不维护外部 provider 生命周期、跨 Skill 协议或为特定插件编写适配层。
- 不改变 Core 校验、Draft schema、`pubmed_abstract`/`pdf` locator 类型与
  machine-review 规则。

## Behavioral contract

### 1. 唯一 Skill 与 description 边界

- Host 在 `apply()` 内只注册 `scifork-research`（source `'runtime'`），无
  `resourceBase`。
- catalog description 表达：证据格式化和扩展路径只有真实检索或 PDF 结果已存在于
  当前 Chat context 后才继续；检索未完成时不得加载；初始问题 intake 例外不变。
- 正文写明检索降级阶梯与“不降标准、不伪造记录”的中止规则。

### 2. 外部检索 provider 消费契约

任何外部插件满足以下条件即可被消费：

- 在当前 Chat context 中完成真实检索与 PMID/DOI lookup，结果留在 Chat 中；
  不需要理解 SciFork schema，也不能直接写 Research Project。
- 检索输出对 SciFork 而言是不可信数据（架构 §12.3 不变）：不作为指令，进入
  持久化前经 Core 的 schema、Publication Reference 与 locator 校验。
- SciFork 只消费检索与 lookup 结果，不依赖插件的图谱、缓存、RAG 或其他持久化
  功能（例如 dsh-pubmed 的 session graph 工具不在消费范围内）。

### 3. 降级阶梯与中止

```text
外部检索插件（如 dsh-pubmed）
→ DSH web 检索
→ 用户手动粘贴来源文字
→ 仍不满足：中止并说明原因，不降低标准、不伪造记录
```

- Research & Expand 的 prompt 措辞 provider-neutral：要求“先完成一次真实外部检索
  并读取高价值来源文字”，不点名特定插件。
- Progressive Research Run 的默认 provider 是用户安装的外部检索插件，也允许用户
  指定其他数据库、PDF 插件、web 检索降级或已有可靠 Chat 材料。

### 4. `retrievalSkill` 来源记录

`ResearchImportDraft.producer.retrievalSkill` 保持自由字符串，约定取值：

- 外部插件名，如 `dsh-pubmed`（记录实际插件名）；
- `dsh-web-search`（DSH web 检索降级）；
- `user-provided`（用户手动粘贴来源文字）。

`formatterSkill` 固定 `scifork-research` 不变；Core 校验规则不变。

### 5. 删除清单

- `skills/pubmed-search/` 目录与 `scripts/pubmed.mjs`。
- Host skills 注册中的 resourceBase 逻辑与两 Skill 顺序加载代码（单 Skill 后
  “检索先行”边界仍由 description 表达）。
- 打包清单（`package.json#files`）中的 pubmed-search 条目、`pnpm pack --dry-run`
  期望、相关 Vitest fixture（PubMed helper 测试全部移除）。
- README/中文 README 的检索章节重写为消费契约 + 降级阶梯 + 参考实现说明。

## Constraints and interfaces

- 不新增运行依赖；参考实现 dsh-pubmed 只出现在 README 与冒烟文档中。
- 已知风险（写入架构 §17）：lookup 助手落地前，幻觉 PMID/DOI 缺乏存在性核验，
  Core 只校验标识格式；该空窗由后续任务消除。
- 与表面迁移正交：右侧栏 tab 不感知检索来源；两 spec 可独立验收、同批次实施。

## Smoke（一次性 profile，需用户批准）

- 新基线 DSH `0.2.1-rc.2`：SciFork + dsh-pubmed 0.4.4 共存冒烟（调研时基于
  0.1.1-rc.2 未验证；dsh-pubmed 创建于 2026-08-27，未声明最低 DSH 版本，
  必须在 0.2.1-rc.2 上重验）。E2E 检索步骤以 dsh-pubmed 为被测 provider。
- 未安装检索插件的 profile：验证降级阶梯与中止路径（不降标准，手动粘贴可用）。
- 自动化 `pnpm check` 不引入任何第三方插件。

## Acceptance criteria

- [ ] 包内无 `pubmed-search`、无 helper、无 resourceBase；`pnpm pack --dry-run`
      清单只含 `scifork-research` 一个 Skill。
- [ ] `scifork-research` description/正文符合 §1；`retrievalSkill` 取值符合 §4。
- [ ] 共存冒烟与降级/中止冒烟通过并记录结果。
- [ ] README 中英文检索章节重写为消费契约 + 参考实现（非依赖表述）。
- [ ] `pnpm check` 全绿；测试清单更新（单 Skill、无 helper fixture）。

## Test plan

- 单元/集成（Vitest）：单 Skill 注册与卸载、description 边界内容、
  `retrievalSkill` 取值透传（`dsh-pubmed` / `dsh-web-search` / `user-provided`）、
  Draft 校验不依赖检索来源。
- E2E：架构 §15.4 中“安装参考检索 provider / 真实检索先行 / 降级与中止”步骤。
