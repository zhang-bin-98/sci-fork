# SciFork 产品设计 v0.8

> **Fork hypotheses. Connect evidence. Advance research.**

SciFork 是一个与 **DeepSeek Harness（DSH）** 协同运行、以 Git 仓库保存科研状态、基于文献证据进行交互式科研虚拟推演的轻量级生物医学 Research Graph 插件。DSH 保留原生 Chat，SciFork 通过独立的浏览器 Companion 页面展示图谱。

> **A Git-native research graph for evidence-grounded scientific simulation alongside DeepSeek Harness.**

## 1. 产品定义

SciFork 不重新实现 Chat，不建立复杂科研平台，也不维护独立数据库。

核心思想是：

> **用文本文件保存科研状态，用 Git 保存科研历史，用 Research Graph 展示科研结构，用 DSH 完成检索、推理和虚拟推演。**

产品主要面向生物医学科研团队。

用户可以从一个研究问题开始，通过 PubMed 等证据逐渐构建研究图谱；在已有证据基础上，由 AI 推演新的研究假设；学生或研究人员随后通过实验、计算分析等方式产生新的结果，再将结果加入研究图谱。

因此整个研究项目会逐渐形成一张不断演化的 **Living Research Graph**。

## 2. 核心产品理念

整个系统只坚持六个原则。

### 2.1 Chat 不重做

完全使用 DSH 原生 Chat。

插件只增加一个主要界面：

> **独立 Research Graph Companion Window**

DSH 页面内只挂载一个 SciFork 自有的轻量入口和草稿桥接，不占用 `sidebar`、`conversation` 或 `details`，也不修改 DSH 的页面布局。用户点击 `Open Research Graph` 后，在同源的新浏览器窗口打开图谱；窗口可以缩窄后悬放在 Chat 旁边，也可以通过操作系统分屏与 DSH 并列。v0.1 不提供内嵌 Panel/Tab 模式。

因此用户仍然使用熟悉的：

- DSH Chat
- Tool Call
- Session
- Subagent
- Fork
- Skills

插件只是给 DSH 增加一个科研状态层。

### 2.2 Repo 就是数据库

不使用 PostgreSQL、Neo4j 等复杂基础设施。

研究项目本身就是一个普通目录：

```text
research-project/
├── README.md
├── research.json
├── nodes/
├── edges/
├── sources/
├── evidence/
└── results/
```

主要使用 Markdown 和 JSON / YAML。

仓库仍然是标准 Git repository。需要远端协作时，DSH 或熟悉 Git 的高级用户仍然可以使用：

```bash
git clone
git pull
git commit
git push
```

普通研究操作不需要执行这些命令；研究项目始终完全属于用户。

### 2.3 Git 就是科研历史

不另外开发复杂版本控制系统，直接使用 Git 作为 SciFork 内部的本地时间线引擎。初始化研究项目时，插件自动创建 Git 仓库、`main` 基线和个人工作分支；此后的有效科研操作自动形成本地检查点。普通用户不需要决定是否 commit，也不需要操作暂存区或维护提交历史。

| 科研行为 | Git |
| --- | --- |
| 新研究结果 | Commit |
| 修改科研结论 | Commit |
| 隔离虚拟推演 | Branch（由 DSH 按用户指令创建） |
| 接受推演 | Merge（由 DSH 按用户指令处理） |
| 撤销结论 | Revert |
| 查看历史 | Log |
| 比较变化 | Diff |
| 分享项目 | 任意 Git remote（由 DSH 操作） |
| 多学生协作 | Branch / PR（由 DSH 操作） |
| 基于别人研究继续工作 | Fork |

因此一个科研项目天然具备：**版本控制 + 审计 + 协作 + 分享 + 迁移。**

普通界面只呈现 `Saved` 状态，以及 `Back`、`Forward`、`Simulate`、`Details` 四个操作。`Back` 与 `Forward` 都从 Git 检查点恢复科研状态并创建新的恢复记录，不删除或重写旧历史；查看更早变化或恢复任意检查点通过 Chat 完成。Push、Pull、远端分支、PR、Merge、Rebase 和冲突解决不由 SciFork 设计，统一交给 DSH 在用户要求下处理。

### 2.4 Graph 是科研状态的视图

Graph 本身不是数据库。它只是 Markdown / JSON 文件的可视化结果。

```text
Research files
      ↓
Graph parser
      ↓
Research Graph
```

文件变了，打开的 Graph Companion 会在下一次刷新周期自动更新；页面隐藏时暂停轮询，回到前台后立即重新校验。刷新和视图适配由插件自动完成，不增加手动按钮。图上进行了科研语义操作，文件随之改变。

### 2.5 AI 推演必须与真实证据分离

Graph 中必须清楚区分 **已有证据** 和 **合理假设**。

```text
A
│
│ established
↓
B
│
│ supported
↓
C
│
│ hypothesis
↓
D ?
```

用户通过实验或计算得到新证据之后：

```text
C
│
│ supported by experiment
↓
D
```

随着 reviewed Evidence Assertion 或 validated Result 累积，达到支持门槛的 Hypothesis 可以经显式审核升级为 Finding；原始证据与科研主张仍是不同实体。这是整个产品最核心的科研逻辑。

### 2.6 SciFork UI 统一使用英语

SciFork 自有界面中的按钮、状态、空状态、提示和错误信息统一使用英语。固定的主要操作为 `Back`、`Forward`、`Simulate` 和 `Details`；常用状态包括 `Saved`、`Working…`、`Read-only` 和 `Git conflict`。第一版不提供语言切换，也不在 Companion 或 DSH Bridge 中硬编码中文界面文案。

这一约束只适用于 SciFork 自有 UI。DSH Chat 可以继续按照用户的会话语言响应，科研 Markdown 文件也不限制语言。

## 3. 产品一句话定位

> **一个与 DeepSeek Harness 协同运行、以 Git 仓库保存科研状态、通过独立 Companion 页面进行交互式科研虚拟推演的轻量级生物医学 Research Graph 插件。**

更简洁的英文描述：

> **A Git-native research graph for evidence-grounded scientific simulation alongside DeepSeek Harness.**

## 4. 用户界面

Graph 是一个由 SciFork 自己托管的窄职责 Web App，不复制 Chat、Agent Runtime、用户系统或协作服务。DSH 与 Graph Companion 是同源的两个浏览器窗口，共享同一个 SciFork Host/Core 和 Research Repo：

```text
┌────────────────────────────────┐  ┌────────────────────────────────┐
│       Native DSH Web           │  │   SciFork Graph Companion      │
│ Sessions / Chat / Tools        │  │ [Finding] A → [Hypothesis] B   │
│                                │  │                                │
│ [Open Research Graph]          │  │ Back Forward Simulate Details  │
└────────────────────────────────┘  └────────────────────────────────┘
              │                                  │
              └──────── SciFork Host/Core ───────┘
```

Graph Companion 提供两种响应式密度，而不是两套产品模式：

- **Compact**：适合窄窗口悬放在 Chat 旁边，默认显示 Focus、当前路径和一层邻居。
- **Workspace**：适合操作系统分屏、第二显示器或独立标签页，可使用更大的画布和同页 Details 区域。

普通浏览器不能可靠强制窗口“始终置顶”；窗口位置、系统级置顶和分屏由操作系统管理。SciFork 只记忆页面密度、窗口尺寸提示和当前 Focus，不尝试获取桌面级窗口权限。

Research Graph 视图只承担三个功能：

### 看

查看以当前 Focus 为中心的局部 Research Graph。默认展示当前实体、当前研究路径和一层直接邻居；Workspace 密度允许扩展可视邻域，但不会一次加载整个大型项目。

每个节点使用紧凑信息卡片，固定显示类型、标题或一行 Claim、状态/置信度/来源，以及支持、反对和 Evidence Gap 计数。

### 选

点击 Node 或 Result 卡片即可改变当前科研焦点；Focus 变化只改变局部视图和 Chat 上下文，不修改科研文件。

### 做

Graph 页面只显示四个操作；`Simulate` 和 `Details` 作用于当前 Focus：

- **Back**：撤回上一个完整科研操作组，从 Git 恢复此前状态并创建新的恢复检查点。
- **Forward**：重新应用刚刚撤回的科研状态；发生新的科研写入后禁用该操作，但原状态仍保留在 Git 历史中。
- **Simulate**：把基于当前 Focus 的结构化推演提示写入 Chat 草稿，由用户确认发送。
- **Details**：在 Companion 页面内打开只读、经过安全处理的受管 Markdown，并显示其来源、审核与版本信息。

`Back` 和 `Forward` 是科研状态的 Git 导航，不是 Focus 浏览历史。Focus 导航直接通过点击卡片或在 Chat 中指定节点完成。

SciFork 不实现第二套 Chat、Graph 搜索框、`Find Evidence`、`Find Counterevidence`、`Add Result` 按钮或 Timeline 面板。查找证据、筛选文献、寻找反证、添加实验结果、查看完整历史和恢复指定状态都通过 DSH Chat 完成。

Graph Companion 自己包含一个最小 Markdown 阅读器，依赖随 SciFork 构建进入发布 tarball，不要求额外文件预览插件。默认禁用原始 HTML、脚本和任意工作区路径访问；链接和附件必须经过项目根路径校验。

## 5. Research Graph 的基本模型

MVP 不做复杂知识图谱 ontology，只保留少量节点类型。

### Finding

已经达到项目支持门槛的解释性科研主张。Finding 不是一篇论文，也不是一条未经解释的实验观察；它必须由经过审核的 Evidence Assertion 或已验证 Result 支持。

```text
Finding
```

### Hypothesis

合理但尚未得到充分验证的推测。

```text
Hypothesis
```

### Prediction

从假设进一步推导出的结果。

```text
Prediction
```

### Result

研究团队自己的实验观察、生信分析、计算输出或模型输出。Result 保存“观察到了什么”，其 Interpretation 与图上的 Finding/Hypothesis 分开。

```text
Result
```

第一版在 Graph 上显示四种实体卡片足够。持久化时，Finding、Hypothesis、Prediction 保存于 `nodes/`；Result 只保存于 `results/`，由 Graph 直接投影，不再复制为第二个 Node 文件。

## 6. Edge

第一版不设计几十种关系，只保留：

```text
supports
contradicts
causes
inhibits
associated_with
```

关系语义和认识来源分开保存：

```text
relation: supports | contradicts | causes | inhibits | associated_with
basis: literature | experiment | user_assertion | ai_inference
```

例如 AI 推断的因果关系表示为 `relation: causes` 与 `basis: ai_inference`，不再把 `inferred` 混入 relation。

UI 上可以：

```text
────── 已有证据
- - -  AI 推断
```

让研究人员一眼看出哪里是知识，哪里是未知。

## 7. 文件设计

保持人类可读。一个节点：

```text
nodes/
└── hyp_8d15c5d4-b474-4a35-9918-581169f126d4.md
```

内容：

```markdown
---
schema_version: "0.1"
id: hyp_8d15c5d4-b474-4a35-9918-581169f126d4
kind: hypothesis
status: plausible
title: TREM2 may affect anti-PD-1 response through lipid metabolism
confidence: moderate
origin: ai
created_at: 2026-08-23T00:00:00.000Z
updated_at: 2026-08-23T00:00:00.000Z
evidence_refs:
  - evidence_id: ev_6cbd8f39-65fa-4a9e-9eed-cd0f6cf32b20
    role: supports
  - evidence_id: ev_4c1dc314-adb4-4bf0-a760-c093392a79f8
    role: contradicts
---

# TREM2 may affect anti-PD-1 response through lipid metabolism

## Claim

TREM2-positive macrophages may promote anti-PD-1 resistance
through altered lipid metabolism.

## Reasoning

...

## Evidence Gaps

- No direct perturbation evidence in human tumors.

## Open Questions

- Is the effect macrophage intrinsic?
- Is it tumor-type specific?
```

UI 可以显示便于交流的短标签，但文件名和实体引用始终使用完整 ID，避免多人分支创建相同编号。普通研究人员即使完全不用插件，也能在 GitHub 上打开 Markdown 并理解这个项目。这是非常重要的产品原则。
置信度不使用看似精确的 0–1 小数，而使用 `low | moderate | high` 三档 Confidence Band。它表达当前支持强度，不是统计概率：`low` 表示主要是间接或尚未审核的支持，`moderate` 表示有直接但受限的证据或多项独立间接证据，`high` 表示多项独立、直接且限制已评估的证据。每次调整都必须记录理由和对应 Evidence Assertion / Result。

## 8. Source 与 Evidence Assertion

论文、数据集和附件不直接当 Node 堆进主要 Research Graph。SciFork 把“来源是什么”和“来源具体证明了什么”拆成两个实体。

Source 保存可复查的来源身份和生命周期信息：

```text
sources/
└── src_pmid_12345678.md
```

```markdown
---
schema_version: "0.1"
id: src_pmid_12345678
kind: publication
pmid: "12345678"
doi: "10.0000/example"
title: Paper title
canonical_url: https://pubmed.ncbi.nlm.nih.gov/12345678/
retrieved_at: 2026-08-23T00:00:00.000Z
retraction_status: none
correction_of: null
---
```

Evidence Assertion 保存从一个 Source 中提取、可定位和可审核的具体科研主张。一篇论文可以产生多条 Evidence Assertion，也可以分别支持和反驳不同关系：

```text
evidence/
└── ev_6cbd8f39-65fa-4a9e-9eed-cd0f6cf32b20.md
```

```markdown
---
schema_version: "0.1"
id: ev_6cbd8f39-65fa-4a9e-9eed-cd0f6cf32b20
source_ref: src_pmid_12345678
direction: supports
study_design: in_vivo_perturbation
biological_model: mouse_melanoma
locator:
  kind: abstract_sentence
  value: "3"
review_status: reviewed
reviewed_by: student-a
reviewed_at: 2026-08-23T00:00:00.000Z
extraction_method: llm_assisted
---

## Assertion

TREM2 perturbation changed response to anti-PD-1 in the reported mouse model.

## Limitations

- Mouse model
- Small cohort
```

`review_status` 使用 `candidate | reviewed | rejected`。模型抽取首先只能创建 Candidate；用户审核后，Node 或 Edge 才能通过带 `supports/contradicts` role 的 `evidence_refs` 引用该 Evidence Assertion。Source 和 Evidence Assertion 都不维护“支持了哪些节点”的反向列表，因此证据关系只有一个事实来源，不会双向不同步。

Graph 显示的是 Scientific Claim、Result 和关系，而不是 Paper A、Paper B、Paper C。这是和普通文献图谱非常重要的区别。

## 9. 用户研究结果

团队成员通过 Chat 提供实验描述、分析结果、图表路径或运行环境支持的附件；DSH 读取内容后，由 LLM 生成结构化 Result 草稿并在用户确认后保存：

```text
results/
├── res_512d7a02-a293-41fa-964f-b4a27c37d03d.md
├── res_6a21....md
└── res_71f0....md
```

例如：

```markdown
---
schema_version: "0.1"
id: res_512d7a02-a293-41fa-964f-b4a27c37d03d
kind: experiment
title: TREM2 knockout experiment
actor_ref: local:student-a
status: validated
source_refs:
  - artifacts/figure-1.png
summary_method: llm_assisted
created_at: 2026-08-23T00:00:00.000Z
---

# TREM2 knockout experiment

## Method

...

## Result

TREM2 knockout increased response to anti-PD-1.

## Interpretation

Supports the lipid-mediated TREM2 hypothesis.
```

这个 Result 文件本身直接显示为 Graph 中的 Result 卡片。若它支持某个 Hypothesis，创建一条 `ResultId → HypothesisId` 的 `supports` Edge；不再额外生成内容重复的 Result Node。Result 状态使用 `draft | completed | validated | superseded`；只有 `validated` Result 能满足 Finding/Supported 的支持门槛。

第一版不提供 `Add Result` 按钮或专用表单。例如用户可以在 Chat 中要求：

> 读取 `results/figure-1.png`，总结主要观察，区分观察事实与解释，并把它加入当前假设。

LLM 负责提取 Method、Result 和 Interpretation，保留可用的源文件路径或附件引用，并明确标记自动生成的总结；用户确认后调用 `research_graph_apply(CreateResult)`。保存的 Result 直接投影为 Graph 中的 Result 卡片。SciFork 不复制生成第二个 Node，也不把无法读取、无法追溯或尚未验证的图表总结声明为直接证据。

Agent 随后可以：

```text
Result
  ↓
Evidence analysis
  ↓
Graph update
```

这样研究团队的真实数据自然进入科研图谱。

## 10. 最核心能力：虚拟推演

用户点击一个节点并选择 `Simulate`。

例如：

```text
A → B → C
```

DSH 基于：

- 当前 Research Graph
- PubMed 文献
- 已有 Evidence
- 生物医学知识

推演：

```text
                C
          ┌─────┼─────┐
          ↓     ↓     ↓
         D1?   D2?   D3?
          │
          ↓
         E1?
```

这些节点默认全部为 `hypothesis` 或 `prediction`，而不是事实。

每个假设告诉用户：

```text
Reasoning
Supporting evidence
Contradictory evidence
Evidence gap
Confidence Band
```

所以虚拟推演的本质不是 AI 给一个答案，而是：

> **AI 在现有科学世界的边缘继续往前走几步。**

## 11. Simulate 可以与工作分支组合

当前：

```text
main ── baseline
          \
           users/zhang
                ↓
             A → B → C
```

从 C 开始推演：

```text
sim/c-metabolism
sim/c-epigenetic
sim/c-immune
```

项目初始化后，所有普通研究操作已经位于个人工作分支。值得进一步隔离的候选科研路径可以由 DSH 创建独立 branch，但这不是每次 Simulate 的自动副作用。

```text
              users/zhang
                   C
             ┌─────┼─────┐
             ↓     ↓     ↓
           sim/A sim/B sim/C
```

Agent 先提出 branch 名称和隔离理由，用户明确确认后才由 DSH 调用现有 Git 能力创建。SciFork 在 DSH 切换分支后自动跟随当前工作分支并继续记录本地时间线；是否合并到 `main`、如何解决冲突以及是否删除分支均由使用者指示 DSH 处理。

不需要自己实现复杂科研分支系统，直接利用 Git。

## 12. Graph → Chat

Chat ↔ Graph 双向同步是插件体验的关键。Graph Companion 的 URL fragment 只携带一个短期、一次性 launch token；Host 端记录把它绑定到 `sessionId` 和项目身份，交换后页面立即清除 fragment。页面只通过 Host 校验后的会话上下文工作，不接受调用方或模型传入任意目录。Focus 由 Host 按 session 与项目保存，因此 DSH Chat 与独立页面读取的是同一个状态。

用户点击：

```text
Hypothesis H001
```

插件设置：

```text
current_focus = H001
```

下一条 Chat：

> 有什么反证？

DSH 自动获得：

```text
Current Research Focus:
H001

Current Path:
A → B → H001
```

于是知道用户问的是 H001。

用户也可以完全从 Chat 改变焦点：

> 找到“乳酸影响 CD8 exhaustion”的假设并聚焦它。

DSH 先在 Research Graph 中解析候选实体；若只有一个明确匹配，直接设置 Focus，若存在多个近似匹配，则在 Chat 中列出简短候选供用户选择。Graph 本身不实现第二套搜索体验。

点击 `Simulate` 后，Companion 只发送一个短期、一次性的 DraftRequest ID；session 与项目绑定由 Host 内部记录解析，不信任页面参数。DSH 中的 SciFork Client Bridge 认领请求后，在浏览器侧调用公开的 conversation input 服务写入 composer draft；Host 不直接修改浏览器状态，也不会自动发送消息。若对应 DSH 页面未打开，Companion 保留结构化提示并提供复制，不静默丢失。

用户确认发送后，Agent 完成推演：

```text
write research files
        ↓
Graph 更新
        ↓
Chat 给出解释
```

## 13. Chat → Graph

用户直接在 Chat 输入：

> 把“乳酸可能通过 HDAC 影响 CD8 exhaustion”加入假设。

Agent 调用：

```text
research_graph_apply(CreateNode)
```

生成 Markdown，Graph 在下一次刷新周期出现新节点。

用户继续询问：

> 查一下有没有支持它的直接证据。

Agent：

```text
PubMed search
     ↓
research_graph_apply(CreateSource)
     ↓
Evidence Assertion extraction and review
     ↓
research_graph_apply(CreateEvidenceAssertion)
     ↓
research_graph_apply(UpdateNode)
     ↓
research_graph_apply(CreateEdge)
```

Graph 在下一次刷新周期更新。因此：

> **Chat 是 Research Graph 的自然语言操作界面。**

## 14. 最大限度依赖 DSH

插件本身尽量“不聪明”。真正聪明的是 DSH，插件只提供 Research Graph 的领域能力。

DSH 原生负责：

- Chat
- Session
- Context
- Tool call
- Subagent
- Fork
- Skills
- Git / Shell / Filesystem

插件主要新增：

```text
Research Graph parser
Research Graph Companion
same-origin Graph API
DSH open/draft bridge
Research-specific tools
Research-specific skills
```

仅此而已。

## 15. Agent 设计也要极简

第一版不需要做五六个常驻 Agent。

主 Agent：

```text
DSH Research Agent
```

需要复杂任务时才调用：

```text
Search Subagent
Simulation Subagent
Critic Subagent
```

三个已经足够：

- **Search**：找已有证据。
- **Simulation**：向未知方向进行推演。
- **Critic**：寻找反例、替代解释、逻辑跳跃，以及已经有人做过的研究。

这些可以依赖 DSH Subagent / Fork，而不是插件自己实现 Agent Runtime。

## 16. Plugin Tool 也保持极少

第一版只有三个模型工具：

```text
research_graph_read
research_graph_apply
research_focus
```

- `research_graph_read`：读取项目摘要、焦点、实体、邻域、诊断或 Git 科研时间线。
- `research_graph_apply`：新增或修改科研实体，也承载用户明确要求的 Git `Back`、`Forward` 和指定状态恢复。
- `research_focus`：设置当前研究焦点。

PubMed 检索由 SciFork Host 内置的窄 Entrez adapter 提供确定性文章记录，查询规划与筛选仍由 Skill 负责；它不是独立服务或第三方插件。Git 直接使用 DSH 已有能力。

不要为了“架构漂亮”写二十个工具。

## 17. 团队合作

这是 Git-native 架构的天然优势。

例如一个实验室：

```text
PI
│
├── Student A
│      └── wet lab
│
├── Student B
│      └── RNA-seq
│
└── Student C
       └── computational modeling
```

共享仓库：

```text
github.com/lab/project-x
```

每个成员初始化或接入项目后，SciFork 默认把本地科研操作放在个人工作分支；团队也可以让 DSH 按实验任务创建更具体的分支：

```text
branch/student-a-trem2-exp
branch/student-b-rnaseq
branch/student-c-model
```

SciFork 自动记录各分支上的本地科研变更。何时推送远端、是否创建 Pull Request、如何合并研究结果，由成员或 PI 根据项目情况指示 DSH 完成。

> **GitHub Pull Request 本身就可以成为科研结果审核流程。**

PI 可以 review：

- 新增了什么证据？
- 修改了什么 claim？
- 哪些 Hypothesis 的 Confidence Band 发生变化？

不需要开发专门的团队审批系统。

## 18. Git Diff 可以直接变成科研 Diff

例如：

```text
Previous
A → B → C

Current
A → B → C → D?
        ↘ E
```

系统利用 `git diff` 生成：

> 本次更新：
>
> - 新增 Hypothesis D；
> - 新增 Finding E；
> - 加入 4 篇 PubMed evidence；
> - C→D 的 Confidence Band 从 moderate 调整为 high。

这可以成为团队周会非常有价值的功能。

## 19. 远端 Git 协作不属于插件职责

MVP 第一版不需要 GitHub API，也不提供后台同步。Push、Pull、Fetch、远端分支、Pull Request、Merge、Rebase 和冲突处理全部交给 DSH；SciFork 只管理本地检查点、Timeline 和恢复。

第一版只保证：

> Research Repo 是标准 Git repository。

> 初始化时自动建立 `main` 基线和个人工作分支，每个有效科研操作自动形成本地检查点。

自然就获得 GitHub、GitLab、Gitea、SSH、本地 NAS 等所有能力。

这里需要区分两个范围：SciFork 软件本身通过 GitHub Releases 发布；用户的 Research Repo 不绑定 GitHub，可以使用任意标准 Git 托管或纯本地仓库。

DSH 完成 checkout、pull、merge 或 rebase 后，SciFork 检测当前分支和文件变化并重新加载图谱。如果存在未解决冲突，图谱暂时只读，直到 DSH 完成冲突处理且项目重新通过校验。

## 20. 检索与知识编译

### 20.1 PubMed、MeSH 与 PubTator 的定位

SciFork 不把“访问 PubMed”与“构建研究图谱”混成同一层。第一版使用现有结构化数据能力辅助检索，但不下载或维护完整文章知识图谱：

| 资源 | MVP 决策 | 用途 |
| --- | --- | --- |
| PubMed / Entrez | 使用 | 检索 PMID，获取标题、摘要、作者、日期、文章类型和相关记录 |
| MeSH | 轻量使用 | 术语标准化、同义词扩展和查询构造 |
| PubTator3 | 可选增强，MVP 非必需 | 发现基因、疾病、药物、变异及候选关系 |
| 完整 PubMed Knowledge Graph | 不引入 | 避免大规模同步、额外数据库和把自动抽取关系误当科研事实 |

MeSH 和 PubTator3 只增强发现能力，不成为科研事实源。PubTator3 输出的实体关系默认是 `Candidate relation`，必须带 provider、PMID 和待审查状态；它不能直接创建 `supported` Edge。第一版不在仓库中复制完整 MeSH 或 PubTator 数据，只保存最终被 Research Project 采用的 Source 与 reviewed Evidence Assertion。

- [NLM MeSH](https://www.nlm.nih.gov/mesh/meshhome.html)
- [NCBI Entrez E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [NCBI PubTator3](https://www.ncbi.nlm.nih.gov/research/pubtator3/)

### 20.2 借鉴 LLM Wiki，但不复制 Wiki

SciFork 接受 LLM Wiki 的核心思想：知识不是每次提问时从原始文献重新拼装，而是持续编译成可读、可验证、可累积的长期资产。

| LLM Wiki | SciFork 对应物 |
| --- | --- |
| Raw Sources | Source + Evidence Assertion |
| Wiki pages | Node、Edge 和 Result |
| Schema | Core Schema + Research Skills |
| `index.md` | 可重建的 GraphSnapshot |
| `log.md` | 本地 Git Timeline |
| Ingest | Literature Search Skill |
| Query | DSH Chat + `research_graph_read` |
| Lint | Core Validator + Critique Skill |

值得借鉴的部分包括来源与结论分离、持续更新已有知识、显式记录矛盾和 Evidence Gap、Schema 驱动 Agent 操作，以及结构校验使用确定性程序完成。SciFork 不再创建重复的 `wiki_pages/`、`index.md` 或 `log.md`，不允许 LLM 任意改写文件，也不为 MVP 引入向量数据库。

- [Karpathy: LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

### 20.3 检索链路

```text
用户问题 / 当前 Graph Focus
            ↓
Literature Search Skill 制定检索计划
            ↓
SciFork Host 调用内置 Entrez adapter；可选 Web / PubTator 仅辅助发现
            ↓
确定性工具返回标准文章记录
            ↓
LLM 筛选并输出结构化 Evidence candidates
            ↓
Chat 展示候选、解释纳入排除理由并辅助用户筛选
            ↓
用户确认需要采纳的候选
            ↓
SciFork Core 验证 ResearchCommand
            ↓
写入 Graph + 自动本地检查点
```

Skill 负责查询规划、MeSH/同义词扩展、纳入排除标准和证据抽取规则；它本身不是网络执行器。SciFork Host 的窄 Entrez adapter 负责 ESearch、ESummary/EFetch 与必要的 ELink 调用、限流、重试和响应校验，只输出标准 `RetrievedArticle`，不直接修改 Graph。网络不可用或 NCBI 返回无效记录时明确失败，不允许模型凭参数记忆补造文献。

Entrez adapter 先返回确定性文章数据，例如 PMID、标题、摘要、作者、日期、文章类型、MeSH、版本状态和 source URL。LLM 随后按照 Skill 输出 `RetrievalPlan`、`EvidenceCandidate` 和 `GraphProposal` 等结构化对象，在 Chat 中完成去重、排序、纳入排除解释和候选筛选；只有用户决定采纳的 Source 与审核后的 Evidence Assertion 才通过 typed `research_graph_apply` 参数进入插件。Core 不从自由 Markdown 中猜测持久化数据。

检索、排序和 Evidence Candidate 只存在于 DSH Chat / Tool 结果中，不进入 Graph，不增加候选面板，也不会创建 Git 检查点。只有 Source、Evidence Assertion、Node、Edge、Result 或 manifest 真正发生有效变化时才创建检查点。一次用户操作产生多个单实体命令时，各检查点共享 `actionGroupId`；`research_graph_read(timeline)` 在 Chat 中将其聚合为一项科研操作。

### 20.4 DSH、Skill 与插件的能力边界

| 能力 | 负责层 |
| --- | --- |
| Chat、模型调用、Session、工具循环 | DSH |
| 文件能力、权限、Subagent 和可用外部工具 | DSH |
| Push、Pull、分支切换、Merge、Rebase 和冲突解决 | DSH |
| 确定性 PubMed/Entrez 请求、限流与响应校验 | SciFork Host adapter |
| 查询规划、MeSH 扩展和文献筛选 | Literature Search Skill |
| Claim、研究模型、限制和矛盾抽取 | Literature Search / Critique Skill |
| 科研虚拟推演 | Simulation Skill |
| 语义重复、反例和 Evidence Gap 分析 | Critique Skill |
| Schema、ID、引用完整性和确定性去重 | SciFork Core |
| Source/Evidence Assertion/Node/Edge/Result 受控写入 | SciFork Core + Host |
| Graph Companion、Focus、本地 Timeline 和恢复 | SciFork Host + Companion |

因此第一版不独立实现 Chat、Agent Runtime、Graph 搜索框、检索候选面板、独立 PubMed 服务、PDF 管理、文章知识图谱、向量数据库、RAG 后端或远端 Git 客户端。Entrez adapter 只是随 Host 运行的窄数据端口。

## 21. 插件真正负责的东西只有四块薄能力

最终代码架构应该非常薄：

```text
research-plugin/
├── core/
│   ├── graph-parser
│   └── graph-writer
├── host/
│   ├── dsh-tools-and-web-routes
│   ├── file-focus-and-entrez-adapters
│   └── local-git-timeline
├── web/
│   ├── companion-graph-and-details
│   └── dsh-open-and-draft-bridge
└── skills/
SciFork 可以参考 [DSH-better-sidebar v0.15.2](https://github.com/omdsh-dev/DSH-better-sidebar/releases/tag/v0.15.2) 的 session/cwd 作用域、页面可见性暂停、composer draft 接入、插件生命周期和 mount smoke test；它只作为 MIT 许可的参考实现，不是 dependency、peerDependency 或运行时 provider。SciFork 不复用其 portal、全局布局 CSS、`/sidebar/api`、WebSocket、终端、Git、浏览器或 `node-pty` 能力。若复制具体代码，发布工件必须保留来源和许可证声明。
    ├── literature-search
    ├── scientific-simulation
    └── scientific-critique
```

尽量避免自己实现：

```text
database/
auth/
user-management/
cloud-sync/
collaboration-server/
agent-runtime/
chat-system/
version-control/
```

## 22. MVP 完整用户流程

用户创建新项目：

```text
研究 TREM2 与 anti-PD-1 resistance
```

插件生成 research repo，同时初始化本地 Git、创建 `main` 基线并切换到“我的工作区”。DSH 检索 PubMed 并形成初始 Graph：

```text
TREM2
  ↓
TAM phenotype
  ↓
CD8 dysfunction
  ↓
anti-PD-1 resistance
```

用户选择 `TAM phenotype`，当前研究焦点随之变化。用户要求继续推演，DSH 执行 Simulation：

```text
TAM phenotype
   ├── lipid metabolism?
   ├── hypoxia?
   └── T-cell epigenetics?
```

用户选择深入 lipid metabolism。Agent 建议隔离探索，用户确认后由 DSH 创建 Git branch：

```text
sim/lipid-metabolism
```

系统检索 PubMed 并继续推演。学生完成实验后在 Chat 中提供实验描述或图表，LLM 总结并在用户确认后生成：

```text
results/res_512d7a02-a293-41fa-964f-b4a27c37d03d.md
```

Result 文件直接显示为 Result 卡片，并通过 `supports` Edge 连接 Hypothesis。只有具备经过审核的 Evidence Assertion 或来自 `validated` Result 的支持时，Hypothesis 才能转变为 Supported/Finding；该语义操作完成后，SciFork 自动创建本地检查点：

```text
experiment: support lipid-mediated TREM2 hypothesis
```

用户不满意时点击 `Back`，SciFork 从 Git 恢复上一个科研操作组并创建新的恢复检查点；随后可以点击 `Forward` 重新应用该状态。若撤回后产生新的科研写入，`Forward` 失效，但旧状态仍保留在 Git 历史中，并可通过 Chat 恢复。是否 Push、如何合并到 `main` 以及如何处理冲突不属于 SciFork 闭环，由使用者视情况指示 DSH 完成。

## 23. MVP 明确不做什么

第一版坚决不做：

- 独立 Chat
- 独立用户系统
- 云数据库
- Neo4j
- PostgreSQL
- SaaS 同步服务器
- 自建版本控制
- 自建多人协同
- PDF 文献管理器
- Manuscript writer
- HPC 平台
- 自动实验平台
- 大型知识库
- 复杂 ontology
- 精细权限系统

全部交给 **DSH + Git + 标准 Git 托管 + 文件系统**。

## 24. 产品核心技术哲学

可以最终浓缩成五句话：

> **DSH is the engine.**  
> DSH 是科研 Agent 引擎。

> **Chat is the interface.**  
> Chat 是自然语言交互入口。

> **Repo is the database.**  
> 文本仓库就是科研数据库。

> **Git is the history.**  
> Git 保存科研过程与团队协作历史。

> **Graph is the view.**  
> Graph 展示当前科研世界。

再加上产品真正的核心：

> **Simulation explores the unknown.**  
> 虚拟推演负责探索科学未知区域。

## 25. 最终产品结构

```text
┌────────────────────────┐      ┌────────────────────────────┐
│ DeepSeek Harness Web   │      │ SciFork Graph Companion    │
│ Native Chat / Tools    │      │ Graph / Details / Actions  │
└───────────┬────────────┘      └─────────────┬──────────────┘
            │ tools + draft bridge            │ same-origin API
            └──────────────┬──────────────────┘
                           ↓
                    SciFork Host/Core
             Focus / Entrez / Skills / Timeline
                           │
                           ↓
                    Research Repo
           Markdown + JSON + local Git checkpoints
                           │
                 ┌─────────┴─────────┐
                 ↓                   ↓
              Local Git       Any Git Remote
                                     │
                              Team Collaboration
```

## 26. 最核心的竞争力

最终这个产品的亮点不应该宣传成“AI 帮你搜 PubMed”，也不是“AI 科研知识图谱”，而应该是：

> **基于真实科研证据建立一张可演化的 Research Graph，并允许研究人员和 AI 在图上共同进行虚拟科研推演。**

真正形成闭环的是：

**Reviewed Evidence → Graph → Hypothesis → Simulation → Experiment → New Result / Evidence → Graph Revision**

而 Git 让这个过程：

**可追踪、可分支、可回退、可共享、可协作。**

因此，它最终并不是一个“大型科研软件”。它更像是：

> **给 DeepSeek Harness 加上的一个 Git-native Scientific Reasoning Layer。**

这应该是整个产品最准确、也最轻量的定位。
