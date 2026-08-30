# SciFork 产品设计 v0.11

> 状态：Proposed（MVP 精简版）
> 日期：2026-08-24

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

- Graph 在 DSH 同源的独立浏览器页面打开，不占用 `sidebar`、`conversation` 或 `details`。
- 页面只有一套响应式布局；窄窗口适合悬放，宽窗口适合系统分屏。
- 浏览器不承诺系统级“始终置顶”，悬浮和并列由操作系统窗口管理。
- SciFork 不依赖 `dsh-better-sidebar` 或其他第三方 DSH 插件。
- 点击 `Simulate` 后，提示自动提交到对应 DSH Chat；Chat 空闲时立即开始，运行中则进入 Queue。
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
│ Sessions / Chat / Tools      │  │ Focus graph + Details        │
│                              │  │                              │
│ [Open Research Graph]        │  │ Simulate Details             │
└──────────────────────────────┘  └──────────────────────────────┘
```

页面只包含以 Focus 为中心的局部图、当前路径和一层邻居、只读 Details，以及
`Simulate`、`Details` 两个英语操作。Git 历史恢复通过对应 DSH Chat 完成。

页面按宽度自动调整：

- 窄窗口把 Details 放到图下方或临时覆盖层。
- 宽窗口把 Graph 与 Details 并列。
- 不提供 Compact/Workspace 模式开关。
- 不保存第二套布局状态或节点坐标。

### Git 历史

SciFork 不提供 Back/Forward，也不维护 undo 状态。用户需要恢复历史时，
直接在 DSH Chat 中请求 Git 操作或使用现有 Git 工具；SciFork 在后续读取时
检测外部 HEAD 或分支变化并重新解析项目。

### Simulate

```text
用户点击 Simulate
→ Companion 根据 Focus 生成结构化提示
→ DSH Bridge 写入对应 Session composer
→ DSH Bridge 调用公开 submit
→ Chat 空闲：立即开始
→ Chat 运行中：进入 Queue
→ Companion 显示 Started 或 Queued
```

自动运行只能由真实用户点击触发，不能由页面加载、轮询、模型输出或后台事件触发。

若 DSH 页面、Session 或 Bridge 不可用，Companion 保留提示并显示 `Retry` 和 `Copy`，不能静默丢失，也不能另建 Session 或发送到其他 Chat。

### Details

Companion 只读渲染受管 Markdown。禁用 raw HTML、脚本和自动远程资源加载；附件路径必须位于 Research Project 根目录。

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

### Edge

MVP 只保留 `supports`、`contradicts`、`causes`、`associated_with` 四类科学关系。

`ai_inference` 是来源标记，不是科学关系：

```text
basis: literature | experiment | ai_inference
```

### Focus

用户当前讨论和查看的 Node、Result 或 Edge。Focus 只影响页面和 Chat context，不修改科研文件。

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
→ SciFork Research Skill 形成 typed proposal
→ 用户确认
→ Core 校验
→ 写入实体
→ 创建本地检查点
→ Companion 刷新
```

### 6.3 Graph → Chat

点击实体更新 Focus。点击 `Simulate` 后，Companion 生成包含实体 ID、Claim、现有支持、反对和 Evidence Gap 的提示，并自动提交到启动该页面的 DSH Session。

## 7. SciFork Research Skill

MVP 只发布一个 SciFork 专用的 `SciFork Research` Skill：

- **Retrieval guidance**：根据 Focus 建议检索式和需要补齐的信息。
- **Import formatting**：把当前 Chat 中的检索或 PDF 解析结果格式化为 Research Import Draft。
- **Simulation**：生成 Hypothesis、Prediction、机制路径和下一步实验建议。
- **Critique**：检查矛盾、Evidence Gap、过度推断、重复实体和缺失 locator。

Skill 负责推理、格式化和提案，不联网检索，也不直接写文件。持久化仍通过 SciFork typed tools 和用户确认。

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

大模型先加载并完成一个检索 Skill；默认可以选择 `pubmed-search`，也可以选择其他数据库检索或 PDF 解析 Skill。检索结果进入当前 Chat context 后，大模型再加载 `SciFork Research`，由它把当前结果格式化为 Research Import Draft。不得在检索尚未执行时预先或同时加载两个 packaged Skill；若 `SciFork Research` 被过早加载，它必须等待真实检索上下文，不能补造 Draft。

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

Page Key 同时派生不可猜测的浏览器 channel 名称，使 Companion 只能把 Simulate 交给启动它的 DSH Bridge；不再使用二次 DraftRequest、bridge secret 或 Host claim。

## 12. 职责边界

| 能力 | 负责人 |
| --- | --- |
| Chat、Session、Agent、通用文件读取 | DSH |
| Graph schema 与科研规则 | SciFork Core |
| 三个模型工具与项目定位 | SciFork Host |
| 同源独立页面与 Details | SciFork Companion |
| 自动提交 Simulate | SciFork DSH Bridge |
| 检索建议、Draft 格式化、推演和批判 | SciFork Research Skill |
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
9. Companion 显示 Focus 局部图
10. 用户点击 Simulate
11. 对应 DSH Chat 自动开始或进入 Queue
12. 用户确认新的 Hypothesis、Prediction 或 Result
13. SciFork 写入文件并创建本地检查点
14. 用户在需要时通过 DSH Chat 或现有 Git 工具恢复历史
```

## 15. MVP 完成标准

- 无第三方 DSH 插件即可打开独立 Companion。
- 页面能窄窗悬放，也能系统并列，并自动响应宽度。
- Graph、文件、Focus 和 DSH Chat context 一致。
- 点击 Simulate 后对应 Chat 自动开始；运行中正确进入 Queue。
- 提交失败时 Retry/Copy 可恢复。
- 统一 SciFork Research Skill 能完成检索建议、Draft 格式化、推演和批判。
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
