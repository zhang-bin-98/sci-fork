# SciFork 产品设计 v0.4

> **Fork hypotheses. Connect evidence. Advance research.**

SciFork 是一个运行在 **DeepSeek Harness（DSH）** 内部、以 Git 仓库保存科研状态、基于文献证据进行交互式科研虚拟推演的轻量级生物医学 Research Graph 插件。

> **A Git-native research graph for evidence-grounded scientific simulation inside DeepSeek Harness.**

## 1. 产品定义

SciFork 不重新实现 Chat，不建立复杂科研平台，也不维护独立数据库。

核心思想是：

> **用文本文件保存科研状态，用 Git 保存科研历史，用 Research Graph 展示科研结构，用 DSH 完成检索、推理和虚拟推演。**

产品主要面向生物医学科研团队。

用户可以从一个研究问题开始，通过 PubMed 等证据逐渐构建研究图谱；在已有证据基础上，由 AI 推演新的研究假设；学生或研究人员随后通过实验、计算分析等方式产生新的结果，再将结果加入研究图谱。

因此整个研究项目会逐渐形成一张不断演化的 **Living Research Graph**。

## 2. 核心产品理念

整个系统只坚持五个原则。

### 2.1 Chat 不重做

完全使用 DSH 原生 Chat。

插件只增加一个主要界面：

> **右侧 Research Graph Sidebar**

如果锁定版本的 DSH 右栏扩展契约不安全，v0.1 会使用原生 Conversation Graph Tab。一次发布只实现其中一种，不让用户承担兼容模式选择。

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

用户界面只呈现“已保存”“返回上一步”“恢复到这里”和“查看变化”。其中恢复会创建新的历史记录，而不是删除或重写旧历史。Push、Pull、远端分支、PR、Merge、Rebase 和冲突解决不由 SciFork 设计，统一交给 DSH 在用户要求下处理。

### 2.4 Graph 是科研状态的视图

Graph 本身不是数据库。它只是 Markdown / JSON 文件的可视化结果。

```text
Research files
      ↓
Graph parser
      ↓
Research Graph
```

文件变了，打开的 Graph 会在下一次刷新周期自动更新，也允许用户手动 Refresh；图上进行了科研语义操作，文件随之改变。

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

假设逐渐转变为证据。这是整个产品最核心的科研逻辑。

## 3. 产品一句话定位

> **一个运行在 DeepSeek Harness 中、以 Git 仓库保存科研状态、基于文献证据进行交互式科研虚拟推演的轻量级生物医学 Research Graph 插件。**

更简洁的英文描述：

> **A Git-native research graph for evidence-grounded scientific simulation inside DeepSeek Harness.**

## 4. 用户界面

不设计新的完整 Web App。产品目标布局使用 DSH 的原生 Chat 加一个 Research Graph 视图；下图是右栏扩展契约可用时的首选布局：

```text
┌────────────┬────────────────────────────┬────────────────────────┐
│            │                            │                        │
│ Sessions   │      Native DSH Chat       │    Research Graph      │
│            │                            │                        │
│            │ User: ...                  │        A               │
│            │                            │        │               │
│            │ Assistant: ...             │        B               │
│            │                            │       / \              │
│            │ Tool call ...              │      C   D?            │
│            │                            │                        │
│            │                            │ Explore  Simulate       │
│            │                            │ Challenge Add Result    │
│            │                            │                        │
└────────────┴────────────────────────────┴────────────────────────┘
```

Research Graph 视图尽可能简单，只承担三个功能：

### 看

查看当前 Research Graph。

### 选

选择某个 Node、User Result 或 Edge 作为当前科研焦点。

### 做

针对当前实体显示适用操作：

- Explore
- Simulate
- Challenge
- Add Result

其余所有复杂交互仍然通过 Chat 完成。

## 5. Research Graph 的基本模型

MVP 不做复杂知识图谱 ontology，只保留少量节点类型。

### Finding

已有研究结果。

```text
Evidence / Finding
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

### User Result

用户自己的实验结果、生信分析、计算结果或模型结果。

```text
User Result
```

第一版在 Graph 上显示四种节点足够。持久化时，Finding、Hypothesis、Prediction 保存于 `nodes/`；User Result 只保存于 `results/`，由 Graph 直接投影，不再复制为第二个 Node 文件。

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
confidence: 0.64
origin: ai
created_at: 2026-08-23T00:00:00.000Z
updated_at: 2026-08-23T00:00:00.000Z
evidence_refs:
  - evidence_id: ev_pmid_12345678
    role: supports
  - evidence_id: ev_pmid_34567890
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

## 8. Evidence

文献不要直接当 Node 堆进主要 Research Graph。文献属于 Evidence。

```text
evidence/
└── ev_pmid_12345678.md
```

内容：

```markdown
---
schema_version: "0.1"
id: ev_pmid_12345678
kind: publication
pmid: "12345678"
title: Paper title
---

# Paper title

## Finding

...

## Model

Mouse melanoma

## Limitations

- Mouse model
- Small cohort
```

Evidence 文件不维护“支持了哪些节点”的反向列表。Node 或 Edge 使用带 `supports/contradicts` role 的 `evidence_refs` 指向 Evidence，因此证据关系只有一个事实来源，不会双向不同步。

Graph 显示的是：

```text
Scientific Claim
```

而不是：

```text
Paper A
Paper B
Paper C
```

这是和普通文献图谱非常重要的区别。

## 9. 用户研究结果

团队成员产生的实验结果直接保存：

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
author: student-a
status: completed
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

这个 Result 文件本身直接显示为 Graph 中的 User Result。若它支持某个 Hypothesis，创建一条 `ResultId → HypothesisId` 的 `supports` Edge；不再额外生成内容重复的 User Result Node。

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
Confidence
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

Chat ↔ Graph 双向同步是插件体验的关键。

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

点击 `Simulate` 后，插件调用 DSH Agent。Agent 完成推演之后：

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
Evidence extraction
     ↓
research_graph_apply(CreateEvidence)
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
Research Graph sidebar
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

- `research_graph_read`：读取项目摘要、焦点、实体、邻域或诊断。
- `research_graph_apply`：通过一个语义命令新增或修改 node、edge、evidence 或 result。
- `research_focus`：设置当前研究焦点。

PubMed 检索本身可以作为独立 Skill / Tool；Git 直接使用已有 Git 能力。

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
- 哪些 hypothesis confidence 发生变化？

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
> - C→D confidence 从 0.52 升至 0.71。

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

MeSH 和 PubTator3 只增强发现能力，不成为科研事实源。PubTator3 输出的实体关系默认是 `Candidate relation`，必须带 provider、PMID 和待审查状态；它不能直接创建 `supported` Edge。第一版不在仓库中复制完整 MeSH 或 PubTator 数据，只保存最终被研究项目采用的 Evidence 和必要来源标识。

- [NLM MeSH](https://www.nlm.nih.gov/mesh/meshhome.html)
- [NCBI Entrez E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [NCBI PubTator3](https://www.ncbi.nlm.nih.gov/research/pubtator3/)

### 20.2 借鉴 LLM Wiki，但不复制 Wiki

SciFork 接受 LLM Wiki 的核心思想：知识不是每次提问时从原始文献重新拼装，而是持续编译成可读、可验证、可累积的长期资产。

| LLM Wiki | SciFork 对应物 |
| --- | --- |
| Raw Sources | PubMed/PMC 来源及 Evidence |
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
DSH 调用可用的 Entrez / Web / PubTator 工具
            ↓
确定性工具返回标准文章记录
            ↓
LLM 筛选并输出结构化 Evidence candidates
            ↓
SciFork Core 验证 ResearchCommand
            ↓
写入 Graph + 自动本地检查点
```

Skill 负责查询规划、MeSH/同义词扩展、纳入排除标准和证据抽取规则；它本身不是网络执行器。实际数据访问由 DSH 中可用的 Tool、API connector 或现有 NCBI 能力完成。若环境没有合适检索能力，Skill 应明确报告不可用，而不是由模型凭参数记忆补造文献。

检索工具先返回确定性文章数据，例如 PMID、标题、摘要、作者、日期、文章类型、MeSH 和 source URL。LLM 随后按照 Skill 输出 `RetrievalPlan`、`EvidenceCandidate` 和 `GraphProposal` 等结构化对象，并通过 typed `research_graph_apply` 参数进入插件；Core 不从自由 Markdown 中猜测持久化数据。

检索、排序和临时候选不会创建 Git 检查点。只有 Evidence、Node、Edge、Result 或 manifest 真正发生有效变化时才创建检查点。一次用户操作产生多个单实体命令时，各检查点共享 `actionGroupId`，Timeline 对用户聚合显示为一项科研操作。

### 20.4 DSH、Skill 与插件的能力边界

| 能力 | 负责层 |
| --- | --- |
| Chat、模型调用、Session、工具循环 | DSH |
| 文件能力、权限、Subagent 和可用外部工具 | DSH |
| Push、Pull、分支切换、Merge、Rebase 和冲突解决 | DSH |
| 查询规划、MeSH 扩展和文献筛选 | Literature Search Skill |
| Claim、研究模型、限制和矛盾抽取 | Literature Search / Critique Skill |
| 科研虚拟推演 | Simulation Skill |
| 语义重复、反例和 Evidence Gap 分析 | Critique Skill |
| Schema、ID、引用完整性和确定性去重 | SciFork Core |
| Evidence/Node/Edge/Result 受控写入 | SciFork Core + Host |
| Graph、Focus、本地 Timeline 和恢复 | SciFork Plugin |

因此第一版不独立实现 Chat、Agent Runtime、PubMed 搜索服务器、PDF 管理、文章知识图谱、向量数据库、RAG 后端或远端 Git 客户端。

## 21. 插件真正负责的东西只有四块薄能力

最终代码架构应该非常薄：

```text
research-plugin/
├── core/
│   ├── graph-parser
│   └── graph-writer
├── host/
│   ├── dsh-tools-and-remote
│   ├── file-and-focus-adapters
│   └── local-git-timeline
├── client/
│   ├── ResearchGraphView
│   └── TimelineView
└── skills/
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

系统检索 PubMed 并继续推演。学生完成实验后添加：

```text
results/res_512d7a02-a293-41fa-964f-b4a27c37d03d.md
```

Result 文件直接显示为 User Result，并通过 `supports` Edge 连接 Hypothesis。只有具备支持 Evidence 或 User Result 时，Hypothesis 才能转变为 Supported；该语义操作完成后，SciFork 自动创建本地检查点：

```text
experiment: support lipid-mediated TREM2 hypothesis
```

用户不满意时可以“返回上一步”，SciFork 通过新的恢复检查点回到此前状态并保留完整历史。是否 Push、如何合并到 `main` 以及如何处理冲突不属于 SciFork 闭环，由使用者视情况指示 DSH 完成。

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
                    DeepSeek Harness
                           │
              ┌────────────┴────────────┐
              │                         │
         Native Chat              Research Graph
              │                 Selected DSH View
              │                         │
              └──────────┬──────────────┘
                         ↓
                   Research Skills
                         │
            ┌────────────┼────────────┐
            ↓            ↓            ↓
         Search       Simulation    Critic
            │            │            │
            └────────────┼────────────┘
                         ↓
                   Research Repo
                  Markdown + JSON
                         │
                         ↓
                        Git
                  ┌──────┴──────┐
                  ↓             ↓
             Git Remote      Local
                  │
             Team Collaboration
```

## 26. 最核心的竞争力

最终这个产品的亮点不应该宣传成“AI 帮你搜 PubMed”，也不是“AI 科研知识图谱”，而应该是：

> **基于真实科研证据建立一张可演化的 Research Graph，并允许研究人员和 AI 在图上共同进行虚拟科研推演。**

真正形成闭环的是：

**Evidence → Graph → Hypothesis → Simulation → Experiment → New Evidence → Graph Revision**

而 Git 让这个过程：

**可追踪、可分支、可回退、可共享、可协作。**

因此，它最终并不是一个“大型科研软件”。它更像是：

> **给 DeepSeek Harness 加上的一个 Git-native Scientific Reasoning Layer。**

这应该是整个产品最准确、也最轻量的定位。
