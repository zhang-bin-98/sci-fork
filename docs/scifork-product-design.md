# SciFork 产品设计 v0.21

> 状态：Approved（桌面端右侧栏迁移；implementation pending）
> 日期：2026-10-18
> 迁移设计：[DSH 桌面端右侧栏迁移](./specs/dsh-desktop-right-sidebar.md)；
> 同批次调整：[检索外置](./specs/external-retrieval-skills.md)

## 1. 产品结论

SciFork 是一个与 **DeepSeek Harness（DSH）** 协同运行、以本地 Git 仓库保存科研状态的生物医学 Research Graph。

```text
DSH Chat
   ↕
SciFork tools / Focus
   ↕
Graph Companion（DSH 右侧栏 tab）
   ↕
Markdown / JSON + local Git
```

MVP 边界：

- Graph 在 DSH 桌面端/Web 的公开右侧栏扩展面（`sidebar.right`）内渲染为一个
  tab，不提供独立浏览器窗口，也不进入 `conversation` 或 `details`。入口是右栏
  guide 卡片和左栏底部的公开启动 action，二者都调用公开的 tab 打开操作。
- 页面只有一套响应式布局，按 tab pane 的容器宽度适配；右侧栏自身的窄态、
  全屏与浮出呈现由 DSH docking surface 提供，切换不重挂载内容树。
- DSH 基线钉住 `0.2.1-rc.2`（DeepSeek Harness 桌面端 `0.2.1-rc.2`，nightly
  频道，及同版本 Web）。桌面端自动更新后版本变为未验证状态：Companion 显示
  警告条，按重钉流程处理，不静默失败。
- SciFork 不依赖任何第三方 DSH 插件。
- 开放式研究目标先保存为 Research Question，不伪装成 Hypothesis；Research Question 通过非科学关系的 Framing Link (`frames`) 连接其范围内的 Hypothesis 或 Finding。
- 点击 `Research & Expand` 后，提示自动提交到对应 DSH Chat；Chat 空闲时立即开始，运行中则进入 Queue。一次真实点击只授权以当前 Focus 为锚点、先检索、自动提取 machine-reviewed Evidence、再保存的单层 Research Expansion Step，最多保留五条直接相连的低置信分支。
- 多轮 Progressive Research Run 只能由用户在当前 DSH Chat 中明确请求；每层保存与按钮相同的全部合格直接分支，但只自动选择一个新 Hypothesis 继续下一层，按钮、页面和已保存节点都不能自动递归。
- SciFork 只保留一个统一的 `SciFork Research` Skill，不再自带检索 Skill；论文检索
  由用户安装的外部 DSH 检索插件承担，参考实现为 dsh-pubmed（README 记录
  tested-with 版本，非依赖非保证）。
- 检索降级阶梯：外部检索插件 → DSH web 检索 → 用户手动粘贴；每级通过标准相同
  （合格 PMID/DOI 与真实来源文字），解析不出合格标识即中止，不降低标准。
- 大模型先使用检索 Skill，再使用 `SciFork Research` 格式化 `Research Import Draft`；Skill 之间不互相调用。
- Git 只负责当前分支受管文件的最小本地提交尝试；历史恢复、分支和远端操作交给 DSH 或用户。

## 2. 核心原则

### 2.1 Chat 不重做

DSH 已提供 Chat、Session、Agent、Tool、文件读取和用户交互。SciFork 不建设第二套聊天界面。

### 2.2 Repo 是科研事实源

科研内容保存在普通文件中：

```text
research.json
questions/
question-links/
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

文献标识只是 Evidence Assertion 的出处，不是独立科研实体。团队产生的数据由 Result 表达。只有人工 `reviewed` Evidence Assertion 或 validated Result 能满足 Finding 的支持门槛；`machine_reviewed` Evidence 只能支持低置信的探索性研究连续运行。

### 2.4 Git 只做最小本地提交边界

SciFork 在当前分支上为成功科研修改尝试创建一次只包含受管文件的本地提交。
它不拥有 Git 历史、undo/redo 或恢复状态；提交失败只返回结构化诊断，不执行
复杂的破坏性补偿。历史恢复、分支、远端、PR、合并、rebase 和冲突解决交给
DSH 或用户。

## 3. Companion 页面

```text
┌───────────────────────────────────────────────────────────────┐
│ DeepSeek Harness（桌面端 / Web）                               │
│ Sessions / Chat / Tools              ┌───────────────────────┐ │
│                                       │ SciFork Graph tab     │ │
│ ...                                   │ View toggle + Details │ │
│ [Graph] Research Graph（左栏底部）     │ Research & Expand     │ │
│ [Gear] Settings                       │ （右栏 docking surface）│ │
│                                       └───────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

页面在两个互斥的本地视图之间切换。`Main` 是默认视图，显示完整的非 Evidence
实体及其关系；`Evidence` 视图只显示进入时锁定的一个锚点实体、该实体直接引用且
实际存在的 Evidence Assertion，以及对应的 `evidence_ref`。视图状态不持久化，不改变
项目文件。只读 Details 默认打开，
用户可以通过抽屉拉手收起或重新打开。页面提供 `Research & Expand`、`Details`
两个英语操作。Focus 只高亮 Host 已确认的目标并移动视图中心。在 Main 中，只有当前
Focus 是至少一条有效 `evidence_ref` 的非 Evidence 实体且没有待确认 Focus 时，
才能进入 Evidence。视图切换只有一个按钮：Main 中显示 `Evidence`，Evidence 中显示
`Main`。进入后的 Evidence 点击可更新 Focus 和 Details，但不替换锁定锚点。
返回 Main 时恢复锚点 Focus；Host 确认前保持 Evidence 视图并禁用新选择，恢复失败则
停留并显示现有错误。若锚点已从投影消失，则直接返回 Main。Git 历史恢复通过对应
DSH Chat 完成。

实体点击期间显示独立的 pending 状态；连续点击按顺序完成并以最后一次点击为最终
Focus，不把 React Flow 的临时选择态伪装成已持久的 Focus。Details 显示所选 Research
Question、Node、Result、Evidence Assertion、Framing Link 或 Edge 的完整 ID；ID 文本本身是可点击和键盘激活的复制
控件。页面不保留独立 Focus 面包屑栏；
Focus 路径继续在全局图中高亮。图中截断的实体标签在鼠标悬停或键盘聚焦时由卡片
本体向下展开为完整、可换行文本，不显示脱离卡片的 tooltip，也不触发全图重新布局。

Companion 使用颜色圆点和文字共同区分实体：Research Question 为中性灰、Finding 为绿色、
Hypothesis 为琥珀色、Prediction 为紫色、Evidence Assertion 显示为 `EVIDENCE` 并使用蓝色、Result 为青色。
颜色不是唯一语义载体。Node 卡片用紧凑标签显示去重的 Publication 数，并分别显示
machine-reviewed 与人工 reviewed Evidence 数（例如 `Low · 1 pub · 1 machine · 0 human`）；
完整术语保留在 Details 中。Framing Link 和 Question 本身不贡献文献计数。相关 Node
和已保存科学 Edge 的 Details 按人工 reviewed、machine-reviewed、
rejected 以及仅检索引用分组展示文献来源，rejected 默认收起。

Node 与 Result 的正文采用统一的 Markdown 摘要约定：正文第一段必须只有一句加粗的
主张或观察摘要（`**一句摘要**`），后续段落再写解释、方法、限制、假设和证据细节。
图谱卡片只展示这句摘要及类型、置信度和证据计数；Details 先展示完整正文，再展示结构化
Evidence 列表。Finding、Hypothesis 和 Prediction 均遵守该约定；Evidence Assertion
的文献标识、定位和审核理由不得写进摘要句。

Companion 的通用视觉系统由 Tailwind theme tokens 和 utilities 统一负责，包括页面骨架、
顶栏、按钮、通知、卡片、Details、间距、字号、边框、圆角、阴影和响应式布局。保留深
鼠尾草绿品牌顶栏、暖中性画布、白色内容面和克制的科研工具风格。手写 CSS 只处理
Preflight 禁用所需的最小文档基础归一化、React Flow 外部 DOM/Edge 状态、卡片有界展开
以及 utilities 无法安全表达的 Markdown pseudo-element；不保留一套并行的通用组件样式。
顶栏 `Research & Expand` 使用暖白 surface 与绿色 accent 文字，不使用实心绿色 CTA。

DSH 入口有两个，都走公开扩展面：右侧栏 guide 页的 `Research Graph` 入口卡片，
以及左栏底部 `sidebar.footer.action` 的启动 action（展开时在 Settings 上方显示
Graph 图标和 `Research Graph`，折叠时跟随侧栏变成 36 px 图标按钮，保留
`Open Research Graph` tooltip/accessible name）。二者都调用公开的 tab 打开操作
在当前 Session 的右侧栏打开 SciFork tab 并展开面板，不使用私有 DOM/CSS 或
窗口导航。若将来存在其他 footer actions，它们的相对布局服从 DSH 的 list-slot
owner。右侧栏表面按 Session 独立：没有当前 Session 时没有右侧栏，也就没有
图谱表面；这与 Page Key 绑定 Session 的模型一致。SciFork 不自建 pane 分割、
浮出或全屏管理，全部交给 DSH docking surface。

页面按 tab pane 的容器宽度自动调整（面板宽度不等于浏览器视口宽度，不得使用
viewport media queries）：

- Companion 按 tab pane 容器宽度使用 container queries：mobile/base 为
  `<sm`（小于 640 px），`sm` 从 640 px 开始，`md` 从 768 px 开始，`xl` 从
  1280 px 开始；不再定义 360/480/760/1120 px 等自定义响应式阈值，也不监听
  视口宽度。不得把 Tailwind v4 容器变体的默认档位（`@sm/@md/@xl` =
  384/448/576 px）当作这些断点使用。右侧栏的 normal 窄面板通常落在 `<md`，
  全屏呈现落在宽区间；两种呈现共享同一内容树，切换不重挂载。
- Graph 在 `<md` 使用上下（TB）布局，在 `md` 及以上使用左右（LR）布局。
- Details 在 `<xl` 位于 Graph 下方，在 `xl` 及以上与 Graph 并列；收起拉手和箭头方向
  使用同一个 `xl` 切换点。
- 顶栏沿用 0.0.5 完整顶栏的视觉：所有 pane 宽度都保留当前 Git 分支 chip、
  `Main`/`Evidence` 上下文切换和带完整文字的 `Research & Expand` 按钮；普通桌面
  右栏不能因小于 640px 而隐藏分支或把研究操作替换成只有图标的按钮。
  空间不足时截断分支文字，保留完整分支/HEAD 的悬停提示；极窄 pane 至少保留
  分支图标和操作文字，品牌名可截断以避免重叠。`md` 再显示项目名。
  `<sm` 继续使用失败恢复条和单列 Edge Details，`sm` 只调整顶栏间距。
- 顶栏固定在 pane 可视区域并始终保持单行；项目名与分支 chip 位于左侧，分支不在窄
  pane 另起第二行，空间不足时按 HEAD、项目名、分支文字的顺序降级或截断。
- 页面不显示独立 Focus 面包屑栏；Graph 和 Details 使用顶栏以下的 pane 剩余高度。
- Details 收起时，宽容器保留右侧竖向拉手，窄容器保留图下方横向拉手；展开状态只存在于
  当前 tab body，隐藏、切换 Session 或重开后恢复默认打开。
- Details 顶部固定为两行：第一行显示精确实体类型、适用的紧凑
  `N publications · A machine-reviewed · H reviewed`、Focus 状态和抽屉按钮；第二行是无背景、无边框的完整等宽
  ID 复制控件。ID 文本本身支持点击、Enter 和 Space，复制成功或失败时显示短暂、轻量
  且不引起布局位移的反馈，并通过 polite live region 提供无障碍状态。可见的冗余
  `Details` 大标题移除，但保留无障碍标题。只有正文区域独立滚动，内容不会撑高整个页面。
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
→ Companion 禁用按钮并显示无文字的等待转圈
→ 大模型读取当前 Chat 研究目的、最新 Focus 与方向邻居
→ 先完成真实检索（外部检索插件或降级路径）并 lookup 高价值记录
→ 从真实 abstract 或用户提供的有界 PDF 段落提取并自动审核 Evidence Assertion
→ 生成最多五条不重复、可解释且有 machine-reviewed Evidence 的直接扩展分支
→ 普通 Focus：以低置信 Hypothesis/Prediction + 从已有 Node/Result 锚点指向新 Node 的科学 Edge 保存
→ Question Focus：以低置信 Hypothesis + Question → Hypothesis frames Framing Link 保存，不伪造科学 Edge
→ 对应 Session 从运行态恢复空闲后，Companion 复位按钮
```

自动运行只能由真实用户点击触发，不能由页面加载、轮询、模型输出或后台事件触发。
一次点击只授权一次、单层、有界的展开；不得由已保存分支自动递归触发下一轮。
大模型默认保存它实际提出且通过 Core 校验的全部分支，不再逐条等待用户确认；每条
分支先保存 machine-reviewed Evidence，再保存依赖它的 Node、科学 Edge 或 Framing Link。
仅标题或元数据不能产生 machine-reviewed Evidence；没有可核验摘要/PDF 文字的分支省略。
若当前 Chat 没有明确研究目的，或检索后没有科学上可辩护的明确关系，则不创建实体
并说明原因。单步完成后 Focus 保持不变，用户可选择一个新节点后再次点击。

Bridge 调用被接受只表示提交成功；tab body 与 Bridge 同属一个 client 插件，
进程内直接调用同步返回接受或拒绝，不存在跨窗口投递或超时等待。之后 Bridge
观察它捕获的原始 Session。
由于钉住的 DSH 公开契约没有 per-turn 完成事件，Companion 将该 Session 已被观察为
running、随后恢复 `running=false` 定义为本次界面运行完成。同一 Session 的其他排队工作
可以延迟按钮复位；该定义不改变一次点击只授权一个 Research Expansion Step 的边界。

用户也可以在 DSH Chat 中明确请求 Progressive Research Run。该请求而不是按钮授权
大模型围绕一个研究目的逐层重复相同的单层扩展。每层仍保存全部零至五条合格直接
Hypothesis/Prediction 分支，但模型只自动选择其中一个新 Hypothesis 作为下一层的唯一
continuation；其他 Hypothesis 和全部 Prediction 作为本次运行的终止旁支保留。每一轮
仍先完成独立检索 Skill，再加载 `SciFork Research`；Skill 不互相调用。没有新的
Hypothesis 可继续，或达到用户范围、耗尽已声明计划、遇到不可恢复错误或需要改变目标时
停止并汇报，不逐层等待用户确认，也不能转为后台任务。

若调用被同步拒绝（Session 已关闭、Page Key 因重载失效等），Companion 保留提示并显示
`Retry` 和 `Copy`，不能静默丢失，也不能另建 Session 或发送到其他 Chat；`Copy` 允许
用户把提示手动粘贴到 Chat。

### Details

Companion 只读渲染受管 Markdown。禁用 raw HTML、脚本和自动远程资源加载；附件路径
必须位于 Research Project 根目录。Details 的两行固定头部以实体类型为第一视觉层级，
同一行显示适用的文献与 machine-reviewed/人工 reviewed 计数和 Focus 状态；第二行使用无框原生 button
语义显示完整 ID，ID 文本本身支持鼠标和键盘复制，并提供短暂的 `Copied` 或
`Copy failed` 反馈。`Details` 仅作为无障碍标题和收起拉手文字存在。正文在面板内部
滚动，首个 Markdown 标题使用克制的内容标题尺度，不与应用顶栏或实体类型竞争。

## 4. 领域模型

### Research Question

用户提出的开放式询问。它没有置信度、支持门槛或科学方向，可以作为初始 Focus。命令式
输入（例如“识别骨衰老的关键驱动因子”）按原意规范化为 Question，而不是伪装成可被
支持或反驳的 Hypothesis。

### Framing Link

从 Research Question 指向 Hypothesis 或 Finding 的独立 `frames` 关系。它只表达某个
问题把主张纳入其研究范围，不携带 basis、evidence、provenance、confidence 或 Evidence Gap，
不参与 Finding 门槛或文献计数，也不是科学 Edge。

### Evidence Assertion

从已标识文献中提取、带精确 locator 的可审核科研断言。每条 Evidence Assertion 直接保存 Publication Reference：至少包含 PMID 或规范化 DOI；两者同时存在时以 PMID 为 canonical、DOI 为 alias。SciFork 不为论文建立独立实体。

同一篇文献可以产生多条内容不同的 Evidence Assertion。

```text
machine_reviewed -> reviewed | rejected
reviewed ---------------------------------> rejected
rejected is terminal
```

普通导入、一次获授权的 Research Expansion Step 与 Progressive Research Run 都从真实
abstract/PDF 段落创建 `machine_reviewed` Evidence，并保存 title 与可选 journal/year 的
Citation Snapshot 及机器审核理由。`candidate` 只表示 Research Import Draft 中尚未持久化的
Evidence Candidate，不是 Evidence review state。只有用户明确接受后才成为 `reviewed`；拒绝前必须先移除其活动引用，
rejected Evidence 保留作审计记录。

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
其科学内容。普通 Node/Result/Edge Focus 的每个保留分支必须通过持久化科学 Edge 连接
到当前图谱锚点；Question Focus 的候选 Hypothesis 则通过 Framing Link 连接。每个分支
必须先保存至少一条真实来源支持的 machine-reviewed Evidence；`ai_inference` 仍可保留
一至五十条去重 `publication_refs`、Evidence Gap 与检索 provenance。只有标识而没有可
提取来源文字的记录仍只是 retrieval provenance，不能成为 Evidence Assertion。

### Progressive Research Run

用户在 DSH Chat 中明确发起、围绕同一研究目的连续执行的多个 Research Expansion
Step。每层可以保存多个分支，图谱整体仍可分叉和汇合，但本次运行只自动选择一个新
Hypothesis 继续下一层；未选择的 Hypothesis 和全部 Prediction 是终止旁支。每个新节点
都必须连接到已访问研究状态；运行不由 Companion 按钮、已保存节点或后台事件触发。

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

用户当前讨论的 Research Question、Node、Result、Evidence Assertion、Framing Link 或
Edge，也是 Research Graph 中的视觉中心。Focus 影响视口位置、高亮、Details 和 Chat context。
Main 中 Host 已确认的 Focus 只决定能否以它为锚点进入 Evidence 视图；进入后的视图成员
由锁定锚点决定，不跟随后续 Evidence Focus 变化。

### Confidence Band

使用 `low | moderate | high` 表达支持强度，不使用伪精确小数。每次变化必须记录理由。

### Research Import Draft

其他 Skill 产生的临时导入包，包含 Evidence Candidate 和 provenance。它尚未成为 Research Project 的一部分，也不代表用户接受其内容。

```text
schema validation
→ publication reference validation
→ locator validation
→ automatic machine review
→ SciFork typed persistence as machine_reviewed
```

外部 Skill 不能直接生成 `reviewed`/`machine_reviewed` Evidence Assertion、Finding、
持久化文件或 Git 检查点；`machine_reviewed` 由 SciFork Core 在统一自动审核通过后
通过 typed command 创建。用户后续可明确接受 Evidence，使其转为 `reviewed`。

## 5. 文件设计

```text
research-project/
├── research.json
├── questions/
├── question-links/
├── nodes/
├── edges/
├── evidence/
└── results/
```

`research.json` 只保存 schema version、project ID 和名称，不保存实体索引、UI 坐标或 Git 状态。

每个实体一个 Markdown 或 JSON 文件。front matter 保存结构字段，正文保存人类可读说明。

Research Question：

```yaml
---
id: question_<uuid>
question: What are the key drivers of bone aging?
scope_assumptions:
  - mammalian skeletal aging
---
```

Framing Link：

```json
{
  "id": "qlink_<uuid>",
  "from": "question_<uuid>",
  "to": "node_<uuid>",
  "relation": "frames"
}
```

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
review_status: machine_reviewed
citation:
  title: "..."
  journal: "..."
  year: 2024
machine_review_rationale: "Identity, locator, entailment, direction and limitations checked."
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

Research Question、Framing Link、Evidence Assertion、Node、Edge 和 Result 都不保存反向
引用。反向关系由 Graph 投影重建。

## 6. 核心工作流

### 6.1 初始化与打开

```text
用户执行 /research init
→ 显式确认项目目录
→ 创建受管文件
→ 若目录没有自己的 Git，则在该目录初始化 Git
→ 在当前分支创建基线检查点
→ 打开 Research Graph tab（guide 卡片或左栏底部 action）
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
→ 普通 Evidence 导入与扩展使用同一自动审核边界，人工确认仅用于提升为 reviewed
→ 用户消息提交后，开放式目标先保存为 Research Question 并设为 Focus
→ 完成真实检索后，先保存 machine-reviewed Evidence，再保存低置信 Hypothesis 与 Framing Link
→ Research & Expand 点击授权一次“检索 → Evidence 自动审核 → 直接扩展”的有界持久化流程
→ 用户在 Chat 中明确请求时，SciFork Research Skill 可按同一证据顺序编排有界 Progressive Research Run
→ Core 校验
→ 每个实体分别写入并创建本地检查点
→ Companion 刷新
```

### 6.3 Graph → Chat

点击实体更新 Focus 并在保持当前缩放的前提下把该实体或关系移动到视图中心；只有
Host 确认后的 Focus 使用正式高亮，连续点击不会被静默丢弃。
默认 Main 保持完整非 Evidence 上下文，Evidence 视图只保留锁定锚点及其直接 Evidence。切换
只影响当前页面投影。点击
`Research & Expand` 后，Companion 生成只包含 Focus
ID/摘要、当前 Chat 研究目的约束、单步任务和明确保存授权的提示，并自动提交到该 tab
绑定的 DSH Session。提示不预装邻域正文，也不复述 Skill 的工作流与格式细则——
那些由 `SciFork Research` 正文单一承载；大模型使用 `research_graph_read` 的
方向邻居与 entity 操作选择最新上下文。Graph 不增加编辑或删除控件；用户通过 DSH
Chat 发起多轮研究、修改或删除分支。

## 7. SciFork Research Skill

MVP 只发布一个 SciFork 专用的 `SciFork Research` Skill：

- **Retrieval guidance**：根据 Focus 建议检索式和需要补齐的信息。
- **Import formatting**：把当前 Chat 中的检索或 PDF 解析结果格式化为 Research Import Draft。
- **Question framing**：识别开放式输入，保存 Research Question，并用 `frames` Framing Link 连接其候选答案。
- **Research expansion step**：读取 Focus/方向邻居，先完成检索，从真实 abstract/PDF
  段落提取 machine-reviewed Evidence，再生成最多五条不重复的直接分支；普通 Focus
  保存低置信 Node + 科学 Edge，Question Focus 保存低置信 Hypothesis + Framing Link。
- **Progressive research**：仅在用户通过 Chat 明确请求时维护一个 current continuation 与 visited state；每层保存全部合格分支并自动选择一个新 Hypothesis 继续，在达到停止条件后汇报。
- **Branch deletion**：用户说“当前”“选中”或“聚焦”实体时，先通过
  `research_graph_read focus` 解析准确 ID 并回报；随后读取目标及关系，先删除 Framing Link
  与科学 Edge，
  再删除无关联的 Hypothesis/Prediction，并处理当前 Focus。
- **Critique**：检查矛盾、Evidence Gap、过度推断、重复实体和缺失 locator。

Skill 负责推理、格式化和常见流程，不联网检索，也不直接写文件；大模型通过
SciFork typed tools 执行持久化。Evidence 导入与扩展先经过同一套自动审核；用户审核
只用于把 Evidence 提升为 `reviewed`，普通科研修改仍由用户在 Chat 中明确触发。真实
`Research & Expand` 点击只授权一次单层扩展中的 machine review，Progressive Research
Run 的明确请求则授权其声明轮次中的同类处理。两者都不能生成 Finding。Progressive Research Run 的
授权必须来自当前 Chat 中的明确用户请求，不能从按钮授权推导。

检索由外部 DSH 插件承担，保持独立、可替换，由大模型根据任务先行使用；只有真实检索或 PDF 解析结果已进入当前 Chat context 后，大模型才加载 `SciFork Research` 完成格式化。`SciFork Research` 的 catalog description 必须在加载正文前表达“检索先行”边界（顺序约束必须出现在 description 中，不能只依赖正文）。Skill 之间不互相调用，SciFork 不维护检索 provider 生命周期或跨 Skill 私有协议，也不为任何外部插件编写适配层。

## 8. 外部检索 provider 与降级阶梯

SciFork 不再自带检索 Skill。论文检索由用户自行安装的外部 DSH 检索插件承担；
SciFork 只定义消费契约，不维护 provider 生命周期，也不为任何插件编写适配层。

消费契约（任何满足以下条件的外部插件都可被使用）：

- 在当前 Chat context 中完成真实检索与 PMID/DOI lookup，结果留在 Chat 中；
  插件不需要理解 SciFork schema，也不能直接写 Research Project。
- 检索输出对 SciFork 而言是不可信数据：不作为指令，进入持久化前仍经 Core 的
  schema、Publication Reference 与 locator 校验。
- SciFork 只消费检索与 lookup 结果，不依赖插件的图谱、缓存、RAG 或其他持久化
  功能。

参考实现：dsh-pubmed（Apache-2.0）。README 记录 "tested with" 的版本（当前
0.4.4）；它是推荐与冒烟验证对象，不是依赖、保证或打包分发物。ChatGPT
"Life Sciences Literature" 插件为专有许可证，只作设计参考，不复制代码；
Sci-Hub 类插件有法律风险，不采用。

降级阶梯（各级通过标准相同：能解析出合格 PMID/DOI 并提供真实来源文字）：

```text
外部检索插件（如 dsh-pubmed）
→ DSH web 检索
→ 用户手动粘贴来源文字
→ 仍不满足：中止并说明原因，不降低标准、不伪造记录
```

`SciFork Research` 的正文写明该阶梯；Research Import Draft 的
`producer.retrievalSkill` 记录实际来源：外部插件名（如 `dsh-pubmed`）、
`dsh-web-search` 或 `user-provided`。lookup-only 存在性校验助手（建议
Europe PMC 单源）为后续任务，本期不实现；落地前 Core 只校验标识格式，
存在性核验空窗记为已知风险。

## 9. 模型编排与导入

大模型先完成一个真实检索阶段：默认使用用户安装的外部检索插件（参考实现 dsh-pubmed），也可以选择其他数据库检索或 PDF 解析插件，或按 §8 降级阶梯处理。检索结果进入当前 Chat context 后，大模型再加载 `SciFork Research`，由它把结果格式化为 Research Import Draft，并使用与获授权扩展相同的规则从真实来源文字提取和自动审核 Evidence Assertion；有 Focus 与研究目标时再判断是否存在可保存的明确关系。不得在检索尚未执行时加载 `SciFork Research`；若它被过早加载，必须等待真实检索上下文，不能补造 Draft、Evidence 或扩展分支。

Progressive Research Run 可以重复上述顺序，但每轮都必须先完成检索阶段，再进入
图谱读取/持久化阶段。大模型而不是 Skill 负责选择唯一的下一 Hypothesis continuation
和再次加载哪个 Skill；
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
  citation?: CitationSnapshot
  machineReviewRationale?: string
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
- 可导入的 Evidence Candidate 必须包含最小 Citation Snapshot 和非空机器审核理由，覆盖来源身份、locator、entailment、direction 与 limitations。
- Draft 不能声明 `review_status`；SciFork 在自动校验通过后统一赋值为 `machine_reviewed`。
- Draft 不能直接创建 Finding、Edge 或 Result。
- SciFork 先校验整个 Draft，再把通过标识、locator 与机器审核字段校验的条目逐项转换为正常 typed command；未通过内容不进入仓库或 Git。
- 同一 Publication Reference 可以用于多条不同 Evidence Assertion；SciFork 不创建或合并文献实体。

Research Expansion 不把完整 Draft 或检索响应持久化。每条 machine-reviewed Evidence 只
保留 PMID/规范化 DOI、title、可选 journal/year、派生 assertion、locator、direction、
limitations、review state 和机器审核理由；原始 abstract、全文、PDF、解析文字和完整元
信息在 SciFork 所有的存储中均不保留。

## 10. Git 行为

- 每次成功 mutation 只提交 SciFork 受管路径。
- 不使用 `git add .`，不改变全局 Git 配置。
- 不自动创建、保护或切换分支。
- 不调用任何远端命令。
- SciFork 不执行历史恢复，也不使用 `reset --hard`、移动 branch ref、remote、merge 或 rebase。
- 分支或 HEAD 变化后重新加载 Graph，并由 DSH Chat 或用户处理历史状态。
- 当前分支有 unmerged entries 或受管文件校验失败时进入只读状态。

## 11. 页面认证

MVP 使用一个随机 Page Key 作为唯一能力凭证：绑定 session + project，在 tab 打开时
由 Host 铸造、经同源 loopback POST 响应体交给 client 插件内存，再以 props 传入
tab body；key 不进入 URL、query、Referer、日志或仓库。没有 launch token →
exchange token → bearer capability 的双阶段状态机，也没有独立登录或第二套凭证。

必要边界：

- DSH 必须是 loopback，Companion 与 API 必须同源：浏览器 POST 的 `Origin` 必须
  与 `Host` 精确同源；桌面渲染进程（`dsh-app://`）的 fetch 不携带 `Origin`，
  Origin 缺失的 loopback 请求放行，携带错误 `Origin` 仍拒绝（0.2.1-rc.2 实测）。
- API 从 Page Key 解析 session 和项目，不接受页面自报 cwd。
- Session 关闭、bundle 卸载、DSH 重启或 tab body 卸载后 Page Key 失效；tab 重开时重新铸造。
- 静态资源、受管路径和请求体有固定边界。

铸造/传递流程、失效语义与 Research & Expand 的进程内直接提交契约以
[右侧栏迁移 spec](./specs/dsh-desktop-right-sidebar.md) 为准；不再使用
BroadcastChannel、nonce 防重放、DraftRequest、bridge secret 或 Host claim。

## 12. 职责边界

| 能力 | 负责人 |
| --- | --- |
| Chat、Session、Agent、通用文件读取 | DSH |
| Question、Framing Link、Graph schema 与科研规则 | SciFork Core |
| 三个模型工具与项目定位 | SciFork Host |
| 右侧栏 Graph tab 与 Details | SciFork Companion |
| 单步 Research Expansion 的进程内提交 | SciFork DSH Bridge |
| 问题建模、检索建议、Draft 格式化、Evidence 自动审核、单步/递进研究和批判 | SciFork Research Skill |
| 论文检索与 PMID/DOI 查找 | 外部 DSH 检索插件（用户安装；参考实现 dsh-pubmed） |
| 替代数据库检索或 PDF 解析 | 其他检索 Skill |
| Research Import Draft 校验与持久化 | SciFork Core + Host |
| 受管文件的最小本地提交尝试 | SciFork Host |
| Git 历史恢复与多步 undo/redo | DSH / 用户 |
| 分支、远端、PR、合并和冲突解决 | DSH / 用户 |

## 13. MVP 明确不做

- 独立浏览器窗口、独立 OS 窗口或第二套页面表面。
- 第三方 DSH 插件运行依赖或检索 provider 适配层（外部检索插件仅为参考实现与
  冒烟对象，不打包分发）。
- SciFork 自建的 pane 分割、浮出、全屏或窗口管理（由 DSH docking surface 提供）。
- 多包 monorepo 和内部 npm 包。
- 把 SciFork Research 拆成多套 Skill，或让 Skill 直接调用另一个 Skill。
- lookup-only PMID/DOI 存在性校验助手（后续任务，本期不实现）。
- 自动 MeSH 扩展、PubTator、全文下载、缓存或 RAG。
- Publication/Source 实体、文章图谱、原始文章/PDF/abstract/全文/完整检索元信息归档。
- 外部 Skill 直接写 Research Project。
- Companion 按钮递归、多轮后台研究、单步保存超过五条分支，或把自动扩展提升为 Finding。
- 在 Companion 中增加图谱编辑、删除或批量确认界面。
- SciFork-owned undo/redo、Timeline Panel 或 Graph 搜索框。
- 独立后端、额外端口、登录系统或云同步。
- 自动 Git 分支策略、PR 或远端同步。

## 14. MVP 用户流程

```text
1. 用户在 DSH 打开研究目录并执行 /research init
2. 通过右栏 guide 卡片或左栏底部 action 打开 Research Graph tab
3. 用户给出开放式目标时，大模型先创建 Research Question 并设为 Focus
4. Companion 默认显示 Main；选中有直接 Evidence 的实体后可进入只含该锚点及其 Evidence 的视图
5. 用户点击 Research & Expand
6. 对应 DSH Chat 自动开始或进入 Queue
7. 大模型读取最新 Question/方向邻居并选择已安装的外部检索插件或其他检索/PDF Skill（降级阶梯见 §8）
8. 检索结果进入当前 Chat context，大模型只从真实 abstract/PDF 段落提取 Evidence
9. 大模型加载 SciFork Research，逐条保存 machine-reviewed Evidence，再保存最多五条有效、非重复的低置信分支
10. Question Focus 的 Hypothesis 通过 Framing Link 连接；其他 Focus 使用明确科学 Edge；Focus 保持不变
11. 用户可选择一个新节点再次单步扩展，或在 Chat 中明确请求 Progressive Research Run
12. 递进运行按相同顺序连续执行，不逐条打断用户，也不把 machine-reviewed Evidence 提升为 Finding
13. 用户事后把 Evidence 接受为人工 reviewed 或拒绝，并可通过 Chat 修改/删除不合适的分支
14. 普通 Evidence 导入同样格式化 Research Import Draft，并把通过自动审核的条目保存为 machine-reviewed Evidence
15. SciFork 为每个实体修改创建本地检查点，只保留最小 Citation Snapshot，不保存原始检索材料
16. 用户在需要时通过 DSH Chat 或现有 Git 工具恢复历史
```

## 15. MVP 完成标准

- 无第三方 DSH 插件即可在 DSH 桌面端或同版本 Web 的右侧栏打开 Research Graph tab。
- tab 在窄面板、全屏与浮出呈现下共享同一内容树，并按 tab pane 容器宽度自动响应。
- DSH 运行时版本与钉住的 `0.2.1-rc.2` 不符时，Companion 显示未验证版本警告条。
- Companion 默认显示完整非 Evidence 主图；单一视图按钮在 Main 中显示 `Evidence`、
  在 Evidence 中显示 `Main`，且只允许从有直接 Evidence 的 Host-confirmed Focus 进入。
- Host Focus 与图中正式选中态一致；连续点击最终落到最后一次目标，且完整实体 ID
  可见，ID 本身支持点击/键盘复制和轻量状态反馈。
- Details 默认打开且可收起；`<xl` 时位于 Graph 下方，`xl` 及以上与 Graph 并列，两行
  头部固定、正文独立滚动，顶栏不随正文滚动。
- Graph 在 `<md` 使用 TB、在 `md` 及以上使用 LR；移动端 UI 只使用 `<sm`。
- 截断的实体标签在鼠标悬停或键盘聚焦时由卡片本体展开显示完整文本。
- Companion 的页面骨架、顶栏、按钮、通知、卡片、Details、排版和响应式布局都使用
  Tailwind 构建期 utilities 与 SciFork theme tokens；不增加浏览器 runtime 或 UI
  组件库，只为最小文档基础归一化、React Flow 外部选择器、卡片展开和必要 Markdown
  规则保留少量手写 CSS。
- `Research & Expand` 使用暖白底、绿色文字的反色样式，而不是绿色实心按钮。
- Graph、文件、Focus 和 DSH Chat context 一致。
- 点击 Research & Expand 后对应 Chat 自动开始；运行中正确进入 Queue；按钮在原 Session
  恢复空闲前保持禁用转圈，随后复位。
- 开放式输入能保存为 Research Question；Question 通过独立 `frames` Framing Link
连接 Hypothesis/Finding，Question 不携带 confidence 且 Framing Link 不参与科学支持。
- 一次点击先检索真实 abstract/PDF 文字、保存 machine-reviewed Evidence，再最多保存五条
  直接低置信 Hypothesis/Prediction；普通 Focus 使用明确科学 Edge，Question Focus 使用
  Framing Link，不移动 Focus 且不会自动递归。
- 用户可在 Chat 中明确发起 provider-neutral Progressive Research Run；大模型每层保存
  全部合格分支并只选择一个新 Hypothesis 继续，不逐层等待人工确认，并在明确条件下停止。
- `machine_reviewed` 与人工 `reviewed` 分开计数；前者可支撑探索分支但不能满足 Finding
  或 `basis: literature`，title-only 记录不能成为 machine-reviewed Evidence。
- 大模型能用单实体 typed commands 先删除 Framing Link/科学 Edge，再删除无关联的
  Hypothesis/Prediction；Finding、Evidence、Question 和 Result 不提供物理删除。
- 提交失败时 Retry/Copy 可恢复。
- 统一 SciFork Research Skill 能完成检索建议、Draft 格式化、单步/递进研究和批判。
- 论文检索由用户安装的外部插件完成真实查询与 PMID/DOI lookup；未安装或检索不足时
  按降级阶梯处理，解析不出合格标识即中止，不降标准、不伪造记录。
- 大模型能先使用任一检索 Skill，再使用 SciFork Research 格式化 Draft；普通导入与扩展使用同一套自动审核规则，检索 Skill 不能绕过校验写仓库。
- Node/Edge Details 能按状态显示 Citation Snapshot、PMID/DOI、assertion、locator、
  direction、limitations 和机器审核理由；卡片计数区分 publication、machine-reviewed 和人工 reviewed。
- SciFork 项目、Git、日志与缓存不保留 authors、publication type、retrieval URL/time、
  abstract、全文、PDF、解析文字、完整元信息或原始 provider 响应；文档明确 DSH Chat
  可能保留 Skill 输出且 SciFork 无权删除。
- 每次有效修改都尝试形成受管路径本地检查点；失败时返回诊断并交给 DSH Chat 或用户处理。
- SciFork 不提供 Back/Forward；Git 历史恢复由 DSH Chat 或用户完成。
- 冲突或陈旧版本不会覆盖外部修改。
- 卸载后 Research Project 文件仍完整可读。
