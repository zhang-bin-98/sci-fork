# SciFork 产品设计 v0.17

> 状态：Proposed（MVP 精简版）
> 日期：2026-08-31

## 1. 产品结论

SciFork 是一个与 **DeepSeek Harness（DSH）** 协同运行、以本地 Git 仓库保存科研状态的生物医学 Research Graph。

```text
DSH Chat
   ↕
SciFork tools / Focus
   ↕
Standalone Graph Companion
   ↕
Markdown / JSON + local Git
```

MVP 边界：

- Graph 在 DSH 同源的独立浏览器页面打开，不在 `sidebar`、`conversation` 或
  `details` 内渲染；DSH 侧栏底部只贡献一个公开的启动 action。
- 页面只有一套响应式布局；窄窗口适合悬放，宽窗口适合系统分屏。
- 浏览器不承诺系统级“始终置顶”，悬浮和并列由操作系统窗口管理。
- SciFork 不依赖 `dsh-better-sidebar` 或其他第三方 DSH 插件。
- 点击 `Research & Expand` 后，提示自动提交到对应 DSH Chat；Chat 空闲时立即开始，运行中则进入 Queue。一次真实点击只授权以当前 Focus 为锚点、先检索后保存的单层 Research Expansion Step，最多保留五条直接相连的低置信分支。
- 多轮 Progressive Research Run 只能由用户在当前 DSH Chat 中明确请求；按钮、页面和已保存节点都不能自动递归。
- SciFork 只保留一个统一的 `SciFork Research` Skill；PubMed 是独立、可替换的通用检索 Skill。
- PubMed Skill 支持完整查询语法、单批最多 300 条元数据、分页和 PMID/DOI 查找。
- 大模型先使用检索 Skill，再使用 `SciFork Research` 格式化 `Research Import Draft`；Skill 之间不互相调用。
- Git 只负责当前分支受管文件的最小本地提交尝试；历史恢复、分支和远端操作交给 DSH 或用户。

## 2. 核心原则

### 2.1 Chat 不重做

DSH 已提供 Chat、Session、Agent、Tool、文件读取和用户交互。SciFork 不建设第二套聊天界面。

### 2.2 Repo 是科研事实源

科研内容保存在普通文件中：

```text
research.json
nodes/
edges/
evidence/
results/
```

Graph、摘要和模型上下文都是这些文件的可重建投影。

### 2.3 文献证据、团队结果和科研主张分开

```text
Publication Reference (PMID / DOI)
  └─ Evidence Assertion
          └─ supports / contradicts
                  └─ Finding or Hypothesis

Result
  └─ supports / contradicts
          └─ Finding or Hypothesis
```

文献标识只是 Evidence Assertion 的出处，不是独立科研实体。团队产生的数据由 Result 表达。只有 reviewed Evidence Assertion 或 validated Result 能满足 Finding 的支持门槛。

### 2.4 Git 只做最小本地提交边界

SciFork 在当前分支上为成功科研修改尝试创建一次只包含受管文件的本地提交。
它不拥有 Git 历史、undo/redo 或恢复状态；提交失败只返回结构化诊断，不执行
复杂的破坏性补偿。历史恢复、分支、远端、PR、合并、rebase 和冲突解决交给
DSH 或用户。

## 3. Companion 页面

```text
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ DeepSeek Harness Web         │  │ SciFork Graph Companion      │
│ Sessions / Chat / Tools      │  │ Global graph + Details       │
│                              │  │                              │
│ ...                          │  │ Research & Expand  Details   │
│ [Graph] Research Graph       │  │                              │
│ [Gear] Settings              │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
```

页面始终显示完整 Research Graph 投影和当前 Focus 路径高亮；只读 Details 默认打开，
用户可以通过抽屉拉手收起或重新打开。页面提供 `Research & Expand`、`Details`
两个英语操作。Focus 只高亮 Host 已确认的目标并移动视图中心，不改变图谱内容；
用户可以在保持全局上下文的同时沿关系思考。Git 历史恢复通过对应 DSH Chat 完成。

实体点击期间显示独立的 pending 状态；连续点击按顺序完成并以最后一次点击为最终
Focus，不把 React Flow 的临时选择态伪装成已持久的 Focus。Details 显示所选 Node、
Result、Evidence Assertion 或 Edge 的完整可复制 ID。页面不保留独立 Focus 面包屑栏；
Focus 路径继续在全局图中高亮。图中截断的实体标签在鼠标悬停或键盘聚焦时由卡片
本体向下展开为完整、可换行文本，不显示脱离卡片的 tooltip，也不触发全图重新布局。

Companion 使用颜色圆点和文字共同区分实体：Finding 为绿色、Hypothesis 为琥珀色、
Prediction 为紫色、Evidence Assertion 显示为 `EVIDENCE` 并使用蓝色、Result 为青色。
颜色不是唯一语义载体。Node 卡片显示去重后的 `总参考数（reviewed evidence 数）`；
总数合并 Node 的 Evidence Assertion 引用与 incident Edge 的结构化 Publication
References，reviewed 数只统计 reviewed Evidence Assertion 背后的去重文献。

Companion 的通用视觉系统由 Tailwind theme tokens 和 utilities 统一负责，包括页面骨架、
顶栏、按钮、通知、卡片、Details、间距、字号、边框、圆角、阴影和响应式布局。保留深
鼠尾草绿品牌顶栏、暖中性画布、白色内容面和克制的科研工具风格。手写 CSS 只处理
Preflight 禁用所需的最小文档基础归一化、React Flow 外部 DOM/Edge 状态、卡片有界展开
以及 utilities 无法安全表达的 Markdown pseudo-element；不保留一套并行的通用组件样式。

DSH 入口使用公开的 `sidebar.footer.action`：展开时在 Settings 上方显示 Graph
图标和 `Research Graph`，折叠时跟随侧栏变成 36 px 图标按钮，并保留
`Open Research Graph` tooltip/accessible name。点击仍打开独立 Companion，
不会把 Graph 嵌入侧栏。若将来存在其他 footer actions，它们的相对布局服从
DSH 的 list-slot owner，不用私有 DOM/CSS 强制重排。

页面按宽度自动调整：

- 视口不宽于 1120 px 时把 Details 放到图下方；更宽时与 Graph 并列。
- 宽窗口把 Graph 与 Details 并列。
- 顶栏固定在可视区域并始终保持单行；项目名与分支 chip 位于左侧，分支不在窄窗口
  另起第二行，空间不足时按 HEAD、项目名、分支文字的顺序降级或截断。
- 页面不显示独立 Focus 面包屑栏；Graph 和 Details 使用顶栏以下的剩余高度。
- Details 收起时，宽屏保留右侧竖向拉手，窄屏保留图下方横向拉手；展开状态只存在于
  当前页面，刷新后恢复默认打开。
- Details 顶部固定为两行：第一行显示精确实体类型、紧凑的
  `N ref/refs (M reviewed)`、Focus 状态和抽屉按钮；第二行显示完整等宽 ID 及内嵌复制
  操作。可见的冗余 `Details` 大标题移除，但保留无障碍标题。只有正文区域独立滚动，
  内容不会撑高整个页面。
- Details 在右侧时使用左右方向箭头，在图下方时使用上下方向箭头；箭头方向表达
  当前操作将打开或收起抽屉的方向。
- 不提供 Compact/Workspace 模式开关。
- 不保存第二套布局状态、Details 展开状态或节点坐标。

### Git 历史

SciFork 不提供 Back/Forward，也不维护 undo 状态。用户需要恢复历史时，
直接在 DSH Chat 中请求 Git 操作或使用现有 Git 工具；SciFork 在后续读取时
检测外部 HEAD 或分支变化并重新解析项目。

### Research & Expand

```text
用户点击 Research & Expand
→ Companion 根据 Focus 生成单步结构化提示
→ DSH Bridge 写入对应 Session composer
→ DSH Bridge 调用公开 submit
→ Chat 空闲：立即开始
→ Chat 运行中：进入 Queue
→ Companion 显示 Started 或 Queued
→ 大模型读取当前 Chat 研究目的、最新 Focus 与方向邻居
→ 默认先用 PubMed Search 检索并 lookup 高价值记录
→ 生成最多五条不重复、可解释的直接扩展分支
→ 每条分支以低置信 Hypothesis/Prediction + 明确关系 Edge 保存
```

自动运行只能由真实用户点击触发，不能由页面加载、轮询、模型输出或后台事件触发。
一次点击只授权一次、单层、有界的展开；不得由已保存分支自动递归触发下一轮。
大模型默认保存它实际提出且通过 Core 校验的全部分支，不再逐条等待用户确认；
若当前 Chat 没有明确研究目的，或检索后没有科学上可辩护的明确关系，则不创建实体
并说明原因。单步完成后 Focus 保持不变，用户可选择一个新节点后再次点击。

用户也可以在 DSH Chat 中明确请求 Progressive Research Run。该请求而不是按钮授权
大模型围绕一个研究目的维护 frontier/visited state，逐轮完成“检索 → 阅读 → 识别缺口
→ 保存明确关系 → 选择下一 frontier”。每一轮仍先完成独立检索 Skill，再加载
`SciFork Research`；Skill 不互相调用。大模型在达到用户范围、没有新关系、耗尽已声明
计划或需要改变目标时停止，不能转为后台任务。

若 DSH 页面、Session 或 Bridge 不可用，Companion 保留提示并显示 `Retry` 和 `Copy`，不能静默丢失，也不能另建 Session 或发送到其他 Chat。

### Details

Companion 只读渲染受管 Markdown。禁用 raw HTML、脚本和自动远程资源加载；附件路径
必须位于 Research Project 根目录。Details 的两行固定头部以实体类型为第一视觉层级，
同一行显示适用的 `N ref/refs (M reviewed)` 和 Focus 状态；第二行显示完整 ID 和内嵌
复制操作。`Details` 仅作为无障碍标题和收起拉手文字存在。正文在面板内部滚动，首个
Markdown 标题使用克制的内容标题尺度，不与应用顶栏或实体类型竞争。

## 4. 领域模型

### Evidence Assertion

从已标识文献中提取、带精确 locator 的可审核科研断言。每条 Evidence Assertion 直接保存 Publication Reference：至少包含 PMID 或规范化 DOI；两者同时存在时以 PMID 为 canonical、DOI 为 alias。SciFork 不为论文建立独立实体。

同一篇文献可以产生多条内容不同的 Evidence Assertion。

```text
candidate | reviewed | rejected
```

模型或外部 Skill 只能提出 candidate；用户审核后才能变成 reviewed。

### Result

研究团队记录的实验观察、分析输出或计算结果。Result 将观察与 Interpretation 分开。

```text
draft | validated | superseded
```

只有 validated Result 能支持 Finding。

### Finding

已经达到 Research Project 支持门槛的解释性科研主张。

### Hypothesis

合理但尚未达到支持门槛的科研主张。

### Prediction

从 Finding 或 Hypothesis 推导出的可检验后果。

### Research Expansion Step

一次用户发起、先检索后推理的单层图谱扩展。它不是新的实体类型，也不代表用户接受
其科学内容。每个保留的低置信 Hypothesis 或 Prediction 必须通过一条持久化 Edge
连接到当前图谱锚点，并在 `ai_inference` 上保留检索 provenance、Evidence Gap 与支撑
该推断的结构化 `publication_refs`。这些 Publication References 是可计数的检索
provenance，不是 Evidence Assertion，也不能满足 Finding 支持门槛。

### Progressive Research Run

用户在 DSH Chat 中明确发起、围绕同一研究目的连续执行的多个 Research Expansion
Step。运行可分叉和汇合，但每个新节点都必须连接到已访问研究状态；它不由 Companion
按钮、已保存节点或后台事件触发。

### Edge

MVP 只保留 `supports`、`contradicts`、`causes`、`associated_with`、`predicts`
五类科学关系。`predicts` 只能从 Finding/Hypothesis 指向 Prediction。

`ai_inference` 是来源标记，不是科学关系：

```text
basis: literature | experiment | ai_inference
```

`ai_inference` Edge 保存一至五十条去重的 `publication_refs`。每项至少包含 PMID 或
规范化 DOI；同一条记录同时有 PMID 和 DOI 时按同一文献计数。它们只说明推断查阅了
哪些文献，不代表已提取、审核或接受其中的 Evidence Assertion。

### Focus

用户当前讨论的 Node、Result 或 Edge，也是完整图谱中的视觉中心。Focus 只影响
视口位置、高亮、Details 和 Chat context，不筛选图谱实体，也不修改科研文件。

### Confidence Band

使用 `low | moderate | high` 表达支持强度，不使用伪精确小数。每次变化必须记录理由。

### Research Import Draft

其他 Skill 产生的临时导入包，包含 Evidence Candidate 和 provenance。它尚未成为 Research Project 的一部分，也不代表用户接受其内容。

```text
schema validation
→ publication reference validation
→ locator validation
→ user review
→ SciFork typed persistence
```

外部 Skill 不能直接生成 reviewed Evidence Assertion、Finding、持久化文件或 Git 检查点。

## 5. 文件设计

```text
research-project/
├── research.json
├── nodes/
├── edges/
├── evidence/
└── results/
```

`research.json` 只保存 schema version、project ID 和名称，不保存实体索引、UI 坐标或 Git 状态。

每个实体一个 Markdown 或 JSON 文件。front matter 保存结构字段，正文保存人类可读说明。

Node：

```yaml
---
id: node_<uuid>
kind: hypothesis
confidence: moderate
evidence_refs:
  - id: ev_<uuid>
    role: supports
---
```

Evidence Assertion：

```yaml
---
id: ev_<uuid>
publication_ref:
  pmid: "12345678"
  doi: "10.xxxx/example"
locator:
  kind: pubmed_abstract
assertion: "..."
direction: supports
review_status: reviewed
---
```

Result：

```yaml
---
id: res_<uuid>
status: validated
observed_at: "2026-08-24"
---
```

```md
## Method

...

## Result

...

## Interpretation

...
```

Evidence Assertion、Node、Edge 和 Result 都不保存反向引用。反向关系由 Graph 投影重建。

## 6. 核心工作流

### 6.1 初始化与打开

```text
用户执行 /research init
→ 显式确认项目目录
→ 创建受管文件
→ 若目录没有自己的 Git，则在该目录初始化 Git
→ 在当前分支创建基线检查点
→ Open Research Graph
```

SciFork 不递归使用意外的父目录 Git 仓库，也不自动创建或切换分支。

### 6.2 Chat → Graph

DSH Chat 使用三个 SciFork 工具：

```text
research_graph_read
research_graph_apply
research_graph_focus
```

```text
读取当前 Focus
→ SciFork Research Skill 选择基本 typed tools
→ 普通修改或 Evidence 导入按相应审核边界等待用户确认
→ Research & Expand 点击授权一次文献支撑的直接扩展进入有界持久化流程
→ 用户在 Chat 中明确请求时，SciFork Research Skill 可编排有界 Progressive Research Run
→ Core 校验
→ 每个实体分别写入并创建本地检查点
→ Companion 刷新
```

### 6.3 Graph → Chat

点击实体更新 Focus 并在保持当前缩放的前提下把该实体或关系移动到视图中心；只有
Host 确认后的 Focus 使用正式高亮，连续点击不会被静默丢弃。
完整图谱内容保持不变。点击 `Research & Expand` 后，Companion 生成只包含 Focus
ID/摘要、当前 Chat 研究目的约束、单步任务和明确保存授权的提示，并自动提交到启动
该页面的 DSH Session。提示不预装邻域正文；大模型使用 `research_graph_read` 的
方向邻居与 entity 操作选择最新上下文。Graph 不增加编辑或删除控件；用户通过 DSH
Chat 发起多轮研究、修改或删除分支。

## 7. SciFork Research Skill

MVP 只发布一个 SciFork 专用的 `SciFork Research` Skill：

- **Retrieval guidance**：根据 Focus 建议检索式和需要补齐的信息。
- **Import formatting**：把当前 Chat 中的检索或 PDF 解析结果格式化为 Research Import Draft。
- **Research expansion step**：读取 Focus/方向邻居，先完成检索，再生成最多五条不重复的直接分支并以低置信 Node + Edge 逐条保存。
- **Progressive research**：仅在用户通过 Chat 明确请求时维护 frontier/visited state，按检索与图谱阶段逐轮扩展并在达到停止条件后汇报。
- **Branch deletion**：用户说“当前”“选中”或“聚焦”实体时，先通过
  `research_graph_read focus` 解析准确 ID 并回报；随后读取目标及关系，先删除 Edge，
  再删除无关联的 Hypothesis/Prediction，并处理当前 Focus。
- **Critique**：检查矛盾、Evidence Gap、过度推断、重复实体和缺失 locator。

Skill 负责推理、格式化和常见流程，不联网检索，也不直接写文件；大模型通过
SciFork typed tools 执行持久化。Evidence 导入和普通科研修改仍服从用户审核，
而真实 `Research & Expand` 点击只授权一次单层扩展。Progressive Research Run 的
授权必须来自当前 Chat 中的明确用户请求，不能从按钮授权推导。

检索 Skill 保持独立、可替换，由大模型根据任务先行使用；只有真实检索或 PDF 解析结果已进入当前 Chat context 后，大模型才加载 `SciFork Research` 完成格式化。两个 packaged Skill 的 catalog description 必须在加载正文前表达这个先后边界。Skill 之间不互相调用，SciFork 不维护检索 provider 生命周期或跨 Skill 私有协议。

## 8. 轻量 PubMed 检索 Skill

默认 `pubmed-search` Skill 支持：

```text
search: PubMed/Entrez query + retstart + retmax
lookup: PMID or DOI
```

Bundle 只为 `pubmed-search` 注册 directory `resourceBase`，并把它限制为该 Skill 自己的 package-owned 目录。Skill 正文显式引用相对资源 `helper.mjs`，DSH 在加载 Skill 时基于该目录解析脚本；模型不得扫描 DSH 安装目录、猜测包位置，或把 helper 复制到 Research Project。`SciFork Research` 不需要本地附属资源，因此不注册 `resourceBase`。

Search 原样接受 PubMed/Entrez 查询语法。默认 `retmax=20`，单批最多 300 条元数据，返回总数和下一页位置；用户可以继续分页，不设置 300 条的总结果上限。每条只返回 PMID、DOI、title、journal、year、简化 authors 和 publication type。

PMID/DOI lookup 返回单篇确定性记录，可附带可用 abstract，并保留 canonical URL 和获取时间。检索结果只进入当前 Chat context，不直接创建 Research Import Draft 或科研实体。

Skill 遵守 NCBI 请求频率；大于约 200 个 PMID 的批量元数据请求使用 POST 或 Entrez History。它不自动扩展 MeSH，不实现 PubTator、全文下载、缓存、向量检索、RAG 或文章知识图谱。

网络失败、标识不存在或响应结构无效时明确失败，不能让模型补造文献信息。

## 9. 模型编排与导入

大模型先加载并完成一个检索 Skill；默认可以选择 `pubmed-search`，也可以选择其他数据库检索或 PDF 解析 Skill。检索结果进入当前 Chat context 后，大模型再加载 `SciFork Research`，由它把当前结果格式化为 Research Import Draft，或判断是否存在可保存的明确扩展关系。不得在检索尚未执行时预先或同时加载两个 packaged Skill；若 `SciFork Research` 被过早加载，它必须等待真实检索上下文，不能补造 Draft 或扩展分支。

Progressive Research Run 可以重复上述顺序，但每轮都必须先完成检索阶段，再进入
图谱读取/持久化阶段。大模型而不是 Skill 负责选择下一 frontier 和再次加载哪个 Skill；
SciFork 不建立跨 Skill 私有协议或 provider 生命周期。

Skill 之间没有直接调用关系。检索 Skill 不需要理解 SciFork schema，也不能直接写 Research Project；只有格式化后的 Draft 进入 SciFork 校验。

格式化后的 Draft 必须符合：

```ts
interface PublicationReference {
  pmid?: string
  doi?: string
}

interface EvidenceCandidate {
  publicationRef?: PublicationReference
  assertion: string
  locator:
    | { kind: 'pubmed_abstract' }
    | { kind: 'pdf'; page?: number; section?: string }
  direction: 'supports' | 'contradicts' | 'context'
  limitations?: string[]
}

interface ResearchImportDraft {
  schemaVersion: 1
  producer: {
    retrievalSkill: string
    formatterSkill: 'scifork-research'
    generatedAt: string
  }
  evidenceCandidates: EvidenceCandidate[]
  warnings?: string[]
}
```

约束：

- `retrievalSkill` 记录实际使用的检索 Skill，`formatterSkill` 固定为 `scifork-research`。
- Evidence Candidate 只有在包含有效 PMID 或规范化 DOI 后才能被接受和持久化；两者都有时必须指向同一篇文献。
- 必须提供 locator；PDF 至少包含页码或章节。
- 没有 PMID/DOI 的 PDF 内容可以暂留 Chat 或 Draft，补齐标识前不能进入 Research Project。
- Draft 不能声明 `review_status: reviewed`。
- Draft 不能直接创建 Finding、Edge 或 Result。
- SciFork 先校验整个 Draft，再让用户选择要导入的 Evidence Candidate。
- 被接受条目逐项转换为正常 typed command；未接受内容不进入仓库或 Git。
- 同一 Publication Reference 可以用于多条不同 Evidence Assertion；SciFork 不创建或合并文献实体。

## 10. Git 行为

- 每次成功 mutation 只提交 SciFork 受管路径。
- 不使用 `git add .`，不改变全局 Git 配置。
- 不自动创建、保护或切换分支。
- 不调用任何远端命令。
- SciFork 不执行历史恢复，也不使用 `reset --hard`、移动 branch ref、remote、merge 或 rebase。
- 分支或 HEAD 变化后重新加载 Graph，并由 DSH Chat 或用户处理历史状态。
- 当前分支有 unmerged entries 或受管文件校验失败时进入只读状态。

## 11. 页面认证

MVP 使用一个随机 Page Key：

```text
DSH Open action
→ Host 创建绑定 session + project 的 Page Key
→ key 放在 URL fragment
→ Companion 读入 sessionStorage 并清除 fragment
→ API 请求携带 Page Key
```

不再设计 launch token → exchange token → bearer capability 的双阶段状态机，也不为不同 API 建立独立凭证。

保留必要边界：

- DSH Web 必须是 loopback，Companion 与 API 必须同源。
- Page Key 不进入 query、Referer、日志或仓库。
- API 从 Page Key 解析 session 和项目，不接受页面自报 cwd。
- Session 关闭、bundle 卸载或 DSH 重启后 Page Key 失效。
- 静态资源、受管路径和请求体有固定边界。

Page Key 同时派生不可猜测的浏览器 channel 名称，使 Companion 只能把单步 Research
Expansion 提交给启动它的 DSH Bridge；不再使用二次 DraftRequest、bridge secret 或 Host claim。

## 12. 职责边界

| 能力 | 负责人 |
| --- | --- |
| Chat、Session、Agent、通用文件读取 | DSH |
| Graph schema 与科研规则 | SciFork Core |
| 三个模型工具与项目定位 | SciFork Host |
| 同源独立页面与 Details | SciFork Companion |
| 自动提交单步 Research Expansion | SciFork DSH Bridge |
| 检索建议、Draft 格式化、单步/递进研究和批判 | SciFork Research Skill |
| 默认 PubMed 检索与 PMID/DOI 查找 | PubMed Search Skill |
| 替代数据库检索或 PDF 解析 | 其他检索 Skill |
| Research Import Draft 校验与持久化 | SciFork Core + Host |
| 受管文件的最小本地提交尝试 | SciFork Host |
| Git 历史恢复与多步 undo/redo | DSH / 用户 |
| 分支、远端、PR、合并和冲突解决 | DSH / 用户 |

## 13. MVP 明确不做

- DSH 内嵌 Panel、Tab、右栏或 Sidebar。
- 第三方 DSH 插件运行依赖。
- 两套页面模式或自定义窗口管理。
- 多包 monorepo 和内部 npm 包。
- 把 SciFork Research 拆成多套 Skill，或让 Skill 直接调用另一个 Skill。
- 自动 MeSH 扩展、PubTator、全文下载、缓存或 RAG。
- 外部 Skill 直接写 Research Project。
- Companion 按钮递归、多轮后台研究、单步保存超过五条分支，或把自动扩展提升为 Finding。
- 在 Companion 中增加图谱编辑、删除或批量确认界面。
- SciFork-owned undo/redo、Timeline Panel 或 Graph 搜索框。
- 独立后端、额外端口、登录系统或云同步。
- 自动 Git 分支策略、PR 或远端同步。

## 14. MVP 用户流程

```text
1. 用户在 DSH 打开研究目录并执行 /research init
2. 点击 Open Research Graph
3. 大模型读取 Focus 并选择检索 Skill
4. 大模型使用 PubMed Search 或其他检索/PDF Skill
5. 检索结果进入当前 Chat context
6. 大模型加载 SciFork Research 并格式化 Research Import Draft
7. SciFork 校验文献标识，用户审核 Evidence Candidate
8. 用户创建 Hypothesis 或 Finding
9. Companion 显示完整图谱，并以 Focus 控制高亮和视图中心
10. 用户点击 Research & Expand
11. 对应 DSH Chat 自动开始或进入 Queue
12. 大模型读取最新方向邻居、检索 PubMed，并保存全部有效、非重复的直接低置信分支及其 Edge；Focus 保持不变
13. 用户可选择一个新节点再次单步扩展，或在 Chat 中明确请求 Progressive Research Run
14. 用户通过 Chat 修改或删除不合适的分支；Evidence 与 Result 仍走各自审核状态
15. SciFork 为每个实体修改创建本地检查点
16. 用户在需要时通过 DSH Chat 或现有 Git 工具恢复历史
```

## 15. MVP 完成标准

- 无第三方 DSH 插件即可打开独立 Companion。
- 页面能窄窗悬放，也能系统并列，并自动响应宽度。
- Companion 默认显示完整图谱；Focus 只改变高亮、Details 和视图中心，不裁剪内容。
- Host Focus 与图中正式选中态一致；连续点击最终落到最后一次目标，且完整实体 ID 可见、可复制。
- Details 默认打开且可收起；不宽于 1120 px 时位于 Graph 下方，两行头部固定、正文独立滚动，顶栏不随正文滚动。
- 截断的实体标签在鼠标悬停或键盘聚焦时由卡片本体展开显示完整文本。
- Companion 的页面骨架、顶栏、按钮、通知、卡片、Details、排版和响应式布局都使用
  Tailwind 构建期 utilities 与 SciFork theme tokens；不增加浏览器 runtime 或 UI
  组件库，只为最小文档基础归一化、React Flow 外部选择器、卡片展开和必要 Markdown
  规则保留少量手写 CSS。
- Graph、文件、Focus 和 DSH Chat context 一致。
- 点击 Research & Expand 后对应 Chat 自动开始；运行中正确进入 Queue。
- 一次点击先检索再最多保存五条直接低置信 Hypothesis/Prediction；每条都有明确 Edge、provenance 和 Evidence Gap，不移动 Focus 且不会自动递归。
- 用户可在 Chat 中明确发起 provider-neutral Progressive Research Run；大模型逐轮选择上下文与 frontier，并在明确条件下停止。
- 大模型能用单实体 typed commands 删除 Edge 及无关联的 Hypothesis/Prediction；Finding、Evidence 和 Result 不提供物理删除。
- 提交失败时 Retry/Copy 可恢复。
- 统一 SciFork Research Skill 能完成检索建议、Draft 格式化、单步/递进研究和批判。
- PubMed Search Skill 能执行完整查询、按 300 条分页并按 PMID/DOI 查找，且不会伪造记录。
- 大模型能先使用任一检索 Skill，再使用 SciFork Research 格式化 Draft；检索 Skill 不能绕过校验写仓库。
- 每次有效修改都尝试形成受管路径本地检查点；失败时返回诊断并交给 DSH Chat 或用户处理。
- SciFork 不提供 Back/Forward；Git 历史恢复由 DSH Chat 或用户完成。
- 冲突或陈旧版本不会覆盖外部修改。
- 卸载后 Research Project 文件仍完整可读。

## 16. better-sidebar 参考边界

参考 [DSH-better-sidebar v0.15.2](https://github.com/omdsh-dev/DSH-better-sidebar/releases/tag/v0.15.2) 的 session/cwd 作用域、页面隐藏时暂停刷新、composer input 接入、effect/disposer 生命周期和 mount smoke test。

不复用 portal、全局布局 CSS、`/sidebar/api`、WebSocket、侧栏状态协议、终端、Git、浏览器、编辑器、子代理或 `node-pty`。

它不是 dependency、peerDependency、profile 或运行时 provider。若未来复制具体代码，必须保留对应来源和许可证声明。
