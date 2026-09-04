# SciFork 软件架构与实现设计 v0.21

> 状态：Implemented（MVP baseline）
> 日期：2026-09-03
> 上位设计：[SciFork 产品设计 v0.20](./scifork-product-design.md)

## 1. 架构结论

MVP 采用以下决策：

1. Research Project 文件是唯一科研事实源。
2. Graph 是可重建投影，不引入数据库。
3. SciFork 是一个 DSH bundle、一个 package，不建设内部 npm monorepo。
4. Core 保持纯 TypeScript，Host 和 Web 只是适配层。
5. Graph 使用 DSH 同源的独立 Companion 页面，不占用 DSH single slot。
6. DSH Bridge 只提供 Open action 和单步 Research Expansion 自动提交。
7. 页面只有一套响应式布局。
8. Page Key 直接绑定 session/project，不再做两阶段 token exchange。
9. Git 使用当前分支，每次 mutation 仅尝试创建受管路径提交；SciFork 不维护
   undo/redo 或历史恢复状态。
10. MVP 发布一个 SciFork 专用的 `SciFork Research` Skill，以及一个通用的 `pubmed-search` 检索 Skill。
11. 大模型先完成检索 Skill，再使用 `SciFork Research` 格式化 Draft；普通导入与获授权扩展使用同一套自动 Evidence 审核规则，扩展在审核后继续保存明确关系；Skill 之间不互相调用。
12. Companion 按钮只执行一个文献支撑的 Research Expansion Step；Progressive Research Run 只能由用户在当前 Chat 中明确请求，并由大模型每层保存全部合格分支、自动选择一个新 Hypothesis 作为唯一下一层，二者均不逐条等待证据确认。
13. 开放式目标保存为 Research Question；Question 通过非科学 `frames` Framing Link 连接 Hypothesis/Finding。
14. 文献 Evidence 直接保存 PMID/DOI 和最小 Citation Snapshot，不建立 Source 实体；完整元信息、abstract、全文、PDF 和原始响应不进入 SciFork 持久化或缓存。
15. `machine_reviewed` 与人工 `reviewed` 分开；前者可支持低置信探索但不能满足 Finding 或 `basis: literature`。
16. `better-sidebar` 固定参考 v0.15.2，但不是运行依赖。
17. v0.1 只支持 loopback DSH Web，不开放独立端口、CORS、登录或远程访问。

## 2. DSH 集成基线

实现只使用锁定 DSH 版本中已经公开的扩展面：

- `ctx.tools.register()`：注册模型工具。
- `ctx.fs`：受工作区约束的文件访问。
- `ctx.sandboxPolicy`：从当前公开 DSH Session 解析逐调用文件策略；所有科研文件
  mutation 携带该策略，Git/目录 mutation 先执行同一 policy containment 检查。
- `ctx.storageDomain`：保存 Focus 和 Page Key binding；不保存 Git undo/redo 状态。
- `ctx.webServer.register()`：注册 `/scifork/*` 同源 exact/prefix 路由。
- `ctx.subprocess`：用 argv 数组调用本地 Git。
- `ctx.skills`：贡献 package-owned `SciFork Research` 和 `pubmed-search` 两个 Skill，由大模型按步骤加载。
- `sidebar.footer.action`：注册 additive `Open Research Graph` 操作；owner 提供
  `wide`，展开时显示 Graph 图标和标签，折叠时显示图标。
- `conversation.input.for(scope).setDraft()`：写入对应 Session composer。
- `conversation.input.for(scope).submit()`：按 DSH 标准 Queue 模式提交并开始运行。

`SessionInput.submit()` 是公开输入事务：Session 空闲时启动新 turn，运行中时排队。SciFork 不调用私有 React 组件、DOM 点击模拟或未导出的发送函数。

DSH 仍是快速变化的预览接口。发布必须锁定精确 DSH commit 或 prerelease，并用 compatibility smoke test 验证上述 contract。

## 3. 系统上下文

```text
┌─────────────────────────────┐       ┌─────────────────────────────┐
│ DeepSeek Harness Web        │       │ Graph Companion             │
│ Chat / Sessions / Agents    │       │ Graph / Details / Actions   │
│ Open action / DSH Bridge    │       │ One responsive layout       │
└──────────────┬──────────────┘       └──────────────┬──────────────┘
               │ tools / context                     │ /scifork/api/*
               │ Research step submit                │ Page Key
               └─────────────────┬───────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ SciFork Host                                                    │
│ Project Locator | Tools | Web routes | Focus | Git              │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ SciFork Core                                                    │
│ Schema | Validation | Commands | Projection | Import Draft      │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Research Project                                                │
│ research.json + questions/question-links/nodes/edges/           │
│ evidence/results + Git                                          │
└─────────────────────────────────────────────────────────────────┘
```

没有额外服务、数据库、WebSocket、远程账户系统或第三方 UI provider。

## 4. 单 package 结构

```text
SciFork/
├── .github/workflows/release.yml
├── LICENSE
├── README.md
├── README.zh-CN.md
├── package.json
├── cordis.patch.yml
├── index.js
├── src/
│   ├── core/
│   │   ├── schema.ts
│   │   ├── parser.ts
│   │   ├── validator.ts
│   │   ├── commands.ts
│   │   ├── projection.ts
│   │   ├── publication-references.ts
│   │   ├── revision.ts
│   │   └── import-draft.ts
│   ├── host/
│   │   ├── index.ts
│   │   ├── contracts.ts
│   │   ├── project-locator.ts
│   │   ├── research-store.ts
│   │   ├── apply-command.ts
│   │   ├── tools.ts
│   │   ├── commands.ts
│   │   ├── web-routes.ts
│   │   ├── companion-service.ts
│   │   ├── companion-assets.ts
│   │   ├── page-keys.ts
│   │   ├── skills.ts
│   │   ├── labels.ts
│   │   ├── ui-state.ts
│   │   └── git-checkpoints.ts
│   ├── bridge/
│   │   └── client.tsx
│   ├── companion/
│   │   ├── index.tsx
│   │   ├── app.tsx
│   │   ├── api.ts
│   │   ├── graph.ts
│   │   ├── details.tsx
│   │   ├── focus-selection.ts
│   │   ├── page-key.ts
│   │   ├── polling.ts
│   │   ├── research-expansion.ts
│   │   └── styles.css
│   └── shared/
│       ├── companion-contract.ts
│       ├── page-key.ts
│       └── routes.ts
├── scripts/
│   ├── build-client.mjs
│   ├── build-companion.mjs
│   ├── verify-pack.mjs
│   ├── verify-release.mjs
│   └── verify-source-install.mjs
├── skills/
│   ├── pubmed-search/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── pubmed.mjs
│   └── scifork-research/
│       └── SKILL.md
├── tests/
└── dist/
    ├── core/
    ├── host/
    ├── shared/
    ├── client.js
    └── companion/
```

`dist/companion/index.html` 由 `scripts/build-companion.mjs` 生成，不是
`src/companion/` 下的手写源码。

这些目录是源码边界，不是独立 package。根 `package.json` 是唯一依赖图、构建入口和发布单元。

Release 只交付一个预构建 `dsh-scifork-<version>.tgz` 及其 SHA-256 checksum；同时，默认分支通过根 package 的 `prepare` 生命周期支持 DSH/pnpm 从 GitHub 源码安装，安装时从受 Git 跟踪的源码生成未入库的 `dist/`。发布门禁在隔离的本地 Git consumer 中验证该源码安装及公共入口可导入，再验证 dry-run 与真实 archive。GitHub Actions 只接受默认分支提交上的精确 `v<package.json version>` tag，并在完整检查通过后创建不可覆盖的 GitHub Release；GitHub 仓库必须另设 active `v*` tag ruleset，将 tag 创建、更新、删除和 bypass 限于 release maintainers，因为 tag-push workflow 来自 tagged commit，workflow 自身校验不能替代服务端权限边界。发布过程先创建 draft、上传两个资产，再发布；失败时只在 GitHub 明确返回仍为 draft 时尝试删除，而不删除 tag，未知或已发布状态保留供检查。它不修改版本、创建 tag、发布 npm 或隐式运行 DSH E2E。tarball 包含 Host、Bridge、Companion assets、`SciFork Research` 与 `pubmed-search` 两个 Skill、英文和中文版 README 以及 MIT 许可证，不包含 `workspace:*` 或第三方 DSH 插件依赖。软件代码使用 MIT；Research Project 数据的所有权和共享许可由项目所有者决定。

## 5. Research Project 格式

### 5.1 目录

```text
research-project/
├── research.json
├── questions/
│   └── question_<uuid>.md
├── question-links/
│   └── qlink_<uuid>.json
├── nodes/
│   └── node_<uuid>.md
├── edges/
│   └── edge_<uuid>.json
├── evidence/
│   └── ev_<uuid>.md
└── results/
    └── res_<uuid>.md
```

`research.json` 只包含：

```ts
interface ResearchManifest {
  schema_version: 1
  project_id: string
  name: string
}
```

不保存实体索引、计数器、Graph 坐标、Focus、Page Key 或 Git 状态。

### 5.2 核心实体

```ts
type NodeKind = 'finding' | 'hypothesis' | 'prediction'
type ConfidenceBand = 'low' | 'moderate' | 'high'
type EvidenceReview = 'machine_reviewed' | 'reviewed' | 'rejected'
type ResultStatus = 'draft' | 'validated' | 'superseded'
type Relation = 'supports' | 'contradicts' | 'causes' | 'associated_with' | 'predicts'
type EdgeBasis = 'literature' | 'experiment' | 'ai_inference'

interface PublicationReference {
  pmid?: string
  doi?: string
}

interface CitationSnapshot {
  title: string
  journal?: string
  year?: number
}

interface ResearchQuestion {
  id: `question_${string}`
  question: string
  scopeAssumptions: readonly string[]
  body: string
}

interface FramingLink {
  id: `qlink_${string}`
  from: string
  to: string
  relation: 'frames'
}
```

关键规则：

- Finding 至少有一个人工 `reviewed` supporting Evidence Assertion，或一个 validated Result 的 supporting Edge。
- Hypothesis/Prediction 不得伪装为 Finding。
- Research Question 是无 confidence 和支持门槛的开放式询问，不是 Node。
- Framing Link 只能从 Research Question 指向 Hypothesis/Finding，不携带科学 Edge 字段，
  不参与 Finding 支持、方向邻居读取或文献计数。
- Evidence Assertion 必须直接包含 Publication Reference 和精确 locator；Publication Reference 至少有 PMID 或规范化 DOI。
- PMID 与 DOI 同时存在时必须指向同一篇文献，并以 PMID 为 canonical、DOI 为 alias。
- 不建立 publication/Source entity；同一文献可以对应多条 Evidence Assertion。
- Hypothesis/Prediction 和 `ai_inference` Edge 可正向引用 `machine_reviewed` 或人工
  `reviewed` Evidence；Finding 支持与 `basis: literature` 只接受人工 `reviewed` Evidence。
- `rejected` Evidence 不得被活动 Node 或 Edge 引用；拒绝 Evidence 前必须
  先删除所有活动引用，`rejected` 为终态。
- 新建 `machine_reviewed` Evidence 必须有 Citation Snapshot、非空机器审核理由、有效
  Publication Reference 与 abstract/PDF locator；title-only 或 metadata-only 记录不得通过。
- Result 直接投影为 Graph entity，不创建 Evidence 或 Node 包装。
- Confidence Band 是支持强度，不是统计概率。
- 任何 `ai_inference` 都必须保留 provenance、Evidence Gap 和一至五十条结构化
  `publication_refs`；这些检索引用不等于 Evidence Assertion 或 reviewed evidence。
- `predicts` 只能从 Finding/Hypothesis 指向 Prediction。
- Evidence Assertion 和 Result 不物理删除，分别使用 rejected 或 superseded；Finding 和
  Research Question 也不可物理删除。
- 无关联科学 Edge 和 Framing Link 的 Hypothesis/Prediction 可以通过 typed command
  删除；两类关系均可删除，但删除后项目仍须满足全部科研不变量。

### 5.3 版本

- `fileVersion`：目标文件内容 SHA-256，用于单文件写保护。
- `projectRevision`：按稳定路径排序后的全部受管文件 SHA-256，用于 snapshot 缓存和跨实体前提校验。

不在仓库中保存 graphVersion。

## 6. Core

Core 不依赖 DSH、Node 文件 API、Git 或浏览器。

```ts
interface ResearchProject {
  manifest: ResearchManifest | undefined
  questions: ReadonlyMap<string, ResearchQuestion>
  framingLinks: ReadonlyMap<string, FramingLink>
  nodes: ReadonlyMap<string, ResearchNode>
  edges: ReadonlyMap<string, ResearchEdge>
  evidenceAssertions: ReadonlyMap<string, EvidenceAssertion>
  results: ReadonlyMap<string, ResearchResult>
  projectRevision: string
  diagnostics: readonly Diagnostic[]
}
```

Core 遇到缺失或当前 schema 下非法的 `research.json` 时，`manifest` 为
`undefined`，并通过非空 `diagnostics` 表示只读诊断；读取仍可用于修复提示，
写入必须拒绝。明确声明不受支持的 schema 版本仍由 Host 拒绝，旧版本实现不猜测
新格式。

### 6.1 命令

```ts
type ResearchCommand =
  | CreateQuestion
  | UpdateQuestion
  | CreateFramingLink
  | DeleteFramingLink
  | CreateEvidenceAssertion
  | ReviewEvidenceAssertion
  | CreateNode
  | UpdateNode
  | CreateEdge
  | UpdateEdge
  | CreateResult
  | UpdateResult
  | ImportDraftItem
  | DeleteEdge
  | DeleteNode
```

每条命令只创建、修改或删除一个实体。`ImportDraftItem` 只能转换已经通过整体校验与机器审核字段校验的一个 Evidence Candidate。
`CreateEvidenceAssertion` 与 `ImportDraftItem` 均创建 `machine_reviewed`；命令必须满足
Citation Snapshot/审核理由/locator 约束。`CreateEvidenceAssertion` 不接受 review state，
因为创建后的唯一合法状态就是 `machine_reviewed`。
`ReviewEvidenceAssertion` 实现规范中的单向状态机；在活动引用仍存在时拒绝转为
`rejected`。`DeleteFramingLink`、`DeleteEdge` 和 `DeleteNode` 都需要目标
`expectedFileVersion`；`DeleteNode` 只接受无关联科学 Edge 和 Framing Link 的
Hypothesis/Prediction。删除 Question、Finding、Evidence Assertion 或 Result 不在工具契约中。
每个候选 create/update/delete 计划在返回前还必须应用到临时受管文件映射并运行完整
Core parser + validator；任何会破坏 Finding 支持、`predicts` 端点或其他跨实体不变量的
计划都在 Host 写入前拒绝。详细回归契约见
[invariant-safe typed updates](specs/invariant-safe-updates.md)。

写入顺序：

```text
parse current project
→ verify expectedProjectRevision / expectedFileVersion
→ validate command
→ render one target file or plan one exact deletion
→ guarded create/replace, or argv-only `git rm -- <core-derived-path>`
→ parse and validate again
→ create Git checkpoint
```

失败不得留下半写文件，也不得把失败状态显示为 `Saved`。

### 6.2 Research Import Draft

```ts
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

验证规则：

- `retrievalSkill` 记录实际使用的检索 Skill，`formatterSkill` 必须是 `scifork-research`。
- Draft 有固定总字节和 Evidence Candidate 数上限。
- Draft schema 允许尚未补齐 Publication Reference 的候选，但该候选不可被接受或持久化。
- 可持久化 Evidence Candidate 必须至少有有效 PMID 或规范化 DOI；两者都有时必须解析为同一篇文献。
- locator 对 PDF 使用页码或章节，对 PubMed abstract 使用明确字段。
- 没有 PMID/DOI 的 PDF 候选只能留在 Chat 或 Draft，补齐标识前不进入 Research Project。
- Draft 不携带 review state；SciFork 对通过自动审核字段校验的条目统一赋值为 `machine_reviewed`。
- Finding、Edge、Result、受管路径、Git 参数和 UI 状态不是 Draft 字段。
- 整个 Draft 先做 schema 校验；通过标识、locator、Citation Snapshot 与机器审核理由校验的候选再逐项转换为普通单实体命令。
- 不可导入或校验失败的条目不进入仓库。
- 同一 Publication Reference 可以用于多条不同 Evidence Assertion；不创建或合并文献实体。

Research Import Draft 是瞬时交互对象，不写入 Research Project 或 Git。自动扩展也不
持久化 Draft 或检索响应；它只逐项写入通过 Core 校验的最小 Evidence Assertion。

## 7. Host

### 7.1 Project Locator

项目根来自当前 DSH Session cwd，不来自模型或 Companion 参数。

查找规则：

1. 从 session cwd 向上查找最近的 `research.json`。
2. 解析真实路径并验证实体路径 containment；存在但格式非法的当前版本 marker
   仍锚定项目根，由 Core 以只读诊断暴露给 DSH。
3. 如果项目使用 Git，`git rev-parse --show-toplevel` 必须等于 Research Project 根。
4. 不把研究子目录自动提交进意外的父级代码仓库。
5. 项目未初始化时，只允许显式 `/research init` 创建结构。

### 7.2 工具

MVP 注册三个工具：

```text
research_graph_read
research_graph_apply
research_graph_focus
```

`research_graph_read` 支持 summary、focus、entity、neighbors、find 和简短
checkpoint 状态；entity 读取同时返回目标文件的 `fileVersion`，供 update/delete 使用。
`neighbors` 按 incoming/outgoing/both 返回 incident scientific Edge 与紧凑相邻实体
卡片，不内联相邻正文；模型按需再用 entity 读取完整内容。它接受 Node、Result 或投影
中的 Evidence endpoint；Edge Focus 先用 entity 读取 from/to，再对选定 endpoint 调用
neighbors。Question 的 entity 读取单独返回 `framedEntities` 和 Framing
Links，不把 `frames` 混入科学方向邻居；Framing Link entity 返回 Question 与 framed claim。

`research_graph_apply` 只接受 discriminated typed command；模型不能提供任意路径、文件正文或 Git argv。

`research_graph_focus` 只更新 sidecar Focus，不写科研文件或 Git。

### 7.3 人类命令

```text
/research init
/research open
/research validate
```

不增加 branch、merge、timeline、search 或 import 专用命令；这些行为通过已有工具或 Chat 完成。

### 7.4 Focus 状态

DSH storage domain 只保存 Focus：

```text
scifork_ui_state_v1
└── focus key: <sessionId>:<projectId>
```

Focus 保存 `focusEntityId` 和当前路径，允许 Research Question、Framing Link、Node、
Result、Evidence Assertion 或科学 Edge。Git 历史状态由 DSH 或用户通过 Git 管理。

不保存多级导航栈、窗口模式或 Graph 坐标。

## 8. Companion 与 Page Key

### 8.1 路由

Host 使用 `ctx.webServer.register()` 注册：

```text
/scifork               Companion SPA entry
/scifork/*             Companion static assets
/scifork/api/launch    create Page Key
/scifork/api/snapshot  read projection
/scifork/api/entity    read Details
/scifork/api/focus     update Focus
```

所有 JSON API 使用 POST。Host 通过 Cordis effect 注册路由，并在 bundle 卸载时调用 disposer。

### 8.2 打开页面

```text
用户点击 Open Research Graph
→ Bridge 同步 window.open('about:blank')
→ POST /scifork/api/launch with current session
→ Host 验证 session / project / loopback socket / exact same-origin Origin
→ Host 创建 256-bit random Page Key
→ 返回 /scifork#key=<page-key>
→ 新窗口导航
→ Companion 把 key 放入 sessionStorage
→ history.replaceState 清除 fragment
```

Page Key 直接绑定 sessionId、project root 和过期条件。没有 exchange token、第二个 bearer、refresh token 或独立登录。

Page Key 在 Session 关闭、bundle 卸载或 DSH 重启时失效。页面收到无效 key 后只显示 `Reopen from DSH`。

### 8.3 API

Companion API 只接受 Page Key，不接受调用方提供 cwd、project root 或任意 sessionId。

```ts
interface CompanionApi {
  snapshot(sinceProjectRevision?: string): Promise<SnapshotResponse>
  entity(entityId: string): Promise<EntityDocument>
  setFocus(entityId: string): Promise<FocusState>
}
```

Graph 可见时每 5 秒请求轻量 snapshot；页面隐藏时暂停，重新可见时立即刷新。MVP 不引入 WebSocket 或 SSE。

### 8.4 响应式页面

一个 React tree、一套状态和一套路由：

- Companion 只使用 Tailwind 默认 viewport breakpoints：`sm=40rem/640px`、
  `md=48rem/768px`、`xl=80rem/1280px`，不得再引入任意 viewport media threshold。
- mobile/base（`<sm`）使用紧凑顶栏、下方失败恢复条与单列 Edge Details；`sm` 及以上
  显示分支 chip 并恢复顶栏恢复操作，`md` 及以上再显示项目名。
- Graph 的 Dagre `rankdir` 在 `<md` 为 TB，在 `md` 及以上为 LR。
- Details 在 `<xl` 位于 Graph 下方并使用横向拉手/上下箭头，在 `xl` 及以上与 Graph
  并列并使用竖向拉手/左右箭头。
- Details 默认打开；关闭后分别保留右侧竖向拉手或图下方横向拉手。该状态只存在于
  当前 React tree，刷新后恢复打开，不进入 storage。
- 页面保持 `100dvh`；单行顶栏位于滚动区域之外，Details 两行 header 固定且正文
  独立滚动；没有可见的 `Details` 大标题，也不允许实体正文改变页面整体高度。
- 通用布局、颜色、字号、间距、边框、圆角、阴影、按钮状态和响应式组合由 Tailwind
  utilities 与 `@theme` token 表达。语义 class 可保留为测试/第三方选择器 hook，但不得
  在手写 CSS 中再实现一套通用视觉系统。
- 项目名、分支 chip 和操作处于同一顶栏；窄窗口不得把分支元数据换到第二行。
- `Research & Expand` 使用 semantic warm-surface 背景与 accent-green 文字，不使用填充
  accent 背景；hover、focus 和 disabled 状态仍由 Tailwind theme tokens 表达。
- 不渲染独立 Focus 面包屑栏；Focus path 仍用于图内路径高亮。
- snapshot 始终包含完整投影；Companion 只在当前 React tree 中派生互斥的 `main | evidence`
  视图，不写 storage 或项目。Main 保留所有非 Evidence entity 及端点均可见的关系；
  Evidence 只保留锁定锚点、其直接引用且实际存在的 Evidence entity，以及对应
  `evidence_ref`。科学 Edge Details 中的 `evidenceRefs` 不参与该子图。
- 只有当前 Host-confirmed Focus 是至少一条有效 `evidence_ref` 的非 Evidence 实体且没有
  待确认 Focus 时，才能进入 Evidence。锚点在进入时锁定；点击 Evidence 可更新 Focus
  和 Details，但不改变视图成员。返回 Main 通过串行 Focus queue 恢复锚点，确认前禁用
  新选择；失败时停留 Evidence，锚点已消失时直接返回 Main。
- 视图切换使用一个显示目标视图的上下文按钮：Main 中显示 `Evidence`，Evidence 中显示
  `Main`；不可进入或恢复期间保持 disabled，并通过 `aria-busy` 暴露恢复状态。
- Main 和 Evidence 子图共享通用确定性 Dagre LR/TB 布局，不保留混合图专用的
  Evidence barrier、rank 或合成关系。
- 初始视口适配当前 Main 或 Evidence 图；Focus 变化时保持当前缩放，把对应实体中心或 Edge 中点
  移到视图中心并更新高亮与 Details。
- React Flow 临时 `selected` 状态不代表 Focus。只有 Host `setFocus` 成功后才显示正式
  Focus 高亮；请求期间显示独立 pending 反馈，连续点击串行收敛到最后一次目标。
- 截断实体标签在 hover/focus 时由卡片本体向下展开，完整文本位于卡片内；为保持
  画布稳定，不因 hover 重新运行 Dagre，极长标签在有界卡片内部滚动。
- 卡片使用颜色圆点与文字共同表达精确实体类型，Question 使用中性样式。Node 卡片以
  紧凑标签显示 `publicationCount`、`machineReviewedEvidenceCount` 与
  `humanReviewedEvidenceCount`（如 `Low · 1 pub · 1 machine · 0 human`）；Details
  仍显示完整术语。Framing Link 和 Question 自身不贡献这些计数。颜色不得成为唯一类型信息。
- 不提供 density preference。
- Focus 与 selected entity 是唯一 UI 导航状态。
- 节点位置由确定性布局重建，不持久化。

### 8.5 Details

Host 只返回受管实体文档。Companion 使用随 bundle 打包的 Markdown renderer：

- raw HTML disabled。
- 不执行脚本。
- 不自动加载远程图片、iframe 或嵌入内容。
- 本地附件必须经过 Project Locator containment。
- 外链需要真实用户点击。

Details 使用固定的两行 header。第一行对 Research Question、Framing Link、Node、Result、
Evidence Assertion 和科学 Edge 显示精确类型、适用的 publication/machine-reviewed/
human-reviewed 计数、Focus 状态和方向正确的抽屉操作；
第二行是无背景、无边框的原生 button，完整等宽 ID 文本本身是复制目标，支持 click、
Enter 和 Space。复制成功或失败以短暂、无布局位移的可见文字和 polite live region
反馈，不增加第三行。Node 不显示笼统的 `NODE`，而显示 Finding、Hypothesis 或
Prediction；Evidence Assertion 显示 `EVIDENCE`。可见的 `Details` 标题移除，但 `<h2>`
仍以 visually-hidden 方式保留无障碍结构，收起拉手继续显示 `Details`。这些显示值只
来自已解析的 projection/entity 响应，不接受浏览器构造的路径或标识。publication 与
Evidence 状态计数使用无歧义英语标签。

`publicationCount` 合并 Node 自身 `evidence_refs` 以及 incident stored Edge 上的结构化
`publication_refs`/`evidence_refs`，按 PMID 优先、否则规范化 DOI 去重；两个 Evidence
计数分别统计 `machine_reviewed` 与人工 `reviewed` Assertion，不把同一篇文献的不同
Assertion 混成一个审核动作。Question Details 通过 framed entities 聚合文献覆盖与
状态计数，但不暗示 Question 本身被证据支持。

Companion wire 只返回 `publicationCount`、`machineReviewedEvidenceCount` 和
`humanReviewedEvidenceCount` 三个无歧义字段；三者均为必填，不保留旧计数字段或回退路径。

Host entity response 为 Node 和已保存科学 Edge 增加只读 `literature` 投影，按人工
reviewed、machine-reviewed、rejected 和 retrieval-only Publication
References 分组。每个 Evidence item 只返回项目中已持久化的 Citation Snapshot、
PMID/DOI、assertion、locator、direction、limitations、机器审核理由和 review state；
Companion 不从浏览器远程补全元信息。rejected 组默认收起。

## 9. Research Expansion 单步自动运行

Open action 创建 Page Key 时，Bridge 同时记住该 key 对应的 Session scope，并监听由 Page Key 派生的不可猜测 BroadcastChannel 名称。

```text
Companion `Research & Expand` user click
→ build bounded ResearchExpansionPrompt from the current Focus id/summary
→ broadcast { nonce, prompt }
→ matching DSH Bridge receives
→ conversation.input.for(scope).setDraft(prompt)
→ conversation.input.for(scope).submit()
→ Bridge returns acknowledgement
→ Bridge observes the captured Session running and then idle
→ Bridge returns completion
```

约束：

- 只有 click handler 能发送，页面加载和后台刷新不能发送。
- prompt 有字节上限，只包含当前 Focus id/摘要、当前 Chat 研究目的约束、单步任务和
  明确授权；不内联 Focus 邻域或完整图谱正文。
- prompt 明确要求先完成默认 PubMed 检索和高价值记录 lookup，再读取 Question 的
  `framedEntities` 或普通 Focus 的方向邻居；检索不足时不得用无依据猜测代替。
- prompt 明确要求每个保留分支先从真实 abstract 或用户提供的有界 PDF 文字创建
  machine-reviewed Evidence，title-only/metadata-only 不合格；只保存最小 Citation
  Snapshot，不保存原始检索材料。
- prompt 明确说明本次真实点击只授权保存当前步全部有效直接分支；每步最多五条、
  深度一层、Focus 不变且不得递归。Question Focus 只创建 Hypothesis + Framing Link，
  其他锚点使用科学 Edge；任何路径均不得创建 Finding。
- Bridge 只接受自己打开的 Page Key channel。
- 每个 channel 保留最近 256 个已接受 nonce 的有限 FIFO 窗口，窗口内的重复消息被丢弃；
  被淘汰的旧 nonce 理论上可能再次被接受，这是有限内存占用与严格防重放窗口之间的明确取舍。
- Session 空闲时 submit 启动；运行中使用 DSH 默认 Queue，不执行 steer 或 cancel。
- Bridge ack 只表示已交给 DSH input transaction；发送拒绝由 DSH 在对应 composer 中显示并保留 draft。
- 从发送到完成期间 Companion 只显示禁用的无文字转圈按钮，不显示 Started/Queued/Study。
  Bridge 只轮询其捕获的原始 Session；预提交已 running 或提交后观察到 running 后，首次
  观察到 `running=false` 即发送 completion 并使按钮复位。DSH 没有 per-turn 完成事件，
  因此同一 Session 的其他 Queue 工作可以延迟这一 Session 级完成信号。
- Companion 未收到 Bridge ack 时显示 `Retry` 和 `Copy`。
- 不再使用 DraftRequest、bridge secret、Host claim 或把科研正文存入 Host 临时队列。
- Bridge 只负责提交；检索、分支数量/类型/关系、上下文选择和错误恢复由对应 Chat
  中的大模型按 Skill 决定。

## 10. 大模型编排的 Skills

### 10.1 编排原则

大模型是唯一编排者：

```text
ordinary import:
load selected retrieval Skill
→ run search / lookup / PDF parsing
→ keep retrieval results in current Chat context
→ load scifork-research
→ format Research Import Draft
→ SciFork validates identity, locator, Citation Snapshot, and review rationale
→ persist qualifying machine-reviewed Evidence Assertions

authorized expansion:
load selected retrieval Skill
→ run search / lookup / PDF parsing
→ keep retrieval material in current Chat context
→ load scifork-research
→ extract + machine-review bounded Evidence Assertions
→ persist Evidence before each dependent branch
→ discard retrieval material from SciFork-owned state
```

Skill 不直接调用另一个 Skill，也不共享 provider 生命周期或私有中间协议。检索结果不是 Draft；只有大模型加载 `scifork-research` 后生成的结构才是 Research Import Draft。

同一自动审核顺序用于研究扩展。按钮提交只授权一次
“检索阶段 → Evidence 自动审核 → 图谱阶段”；用户在 Chat
中明确请求 Progressive Research Run 时，大模型才维护一个当前 continuation 和
visited state 并重复该顺序。每层保存全部合格分支，但只选择一个新 Hypothesis 继续。
每个检索阶段必须完成并把真实结果留在当前 Chat context，随后才加载
`scifork-research` 判断可保存关系。按钮、Skill 或已保存节点不能自行触发下一轮。

### 10.2 SciFork Research Skill

Bundle 通过 `ctx.skills` 贡献 package-owned `scifork-research`。它的 catalog description 明确说明：
初始问题 intake 可在用户消息提交后直接加载；证据格式化和扩展路径只有真实检索或 PDF 结果
已存在于当前 Chat context 后才继续；它不执行检索，也不配置 `resourceBase`：

- Retrieval guidance。
- Research Import Draft formatting。
- Research Question framing 与 Framing Link workflow。
- Automatic Evidence extraction and machine review。
- Research Expansion Step。
- Progressive Research Run。
- Critique。
- SciFork typed tools 调用规则。

它在证据导入时读取当前 Chat context 中已有的检索结果，在已有 Research Graph 上
也可独立执行研究扩展和批判。Skill 不拥有网络客户端或文件写权限；它描述常见流程，
由大模型选择三个 SciFork tools 完成读取、逐实体写入和 Focus 管理。

`Research & Expand` 单步工作流：

```text
read current Chat objective + Focus
→ for Question read framedEntities; otherwise read directional neighbors
→ choose an endpoint anchor when Focus is an Edge
→ complete pubmed-search search + lookup
→ deduplicate against the graph with neighbors/entity/find
→ omit records without a real abstract/user-provided PDF passage
→ extract and create one or more machine-reviewed Evidence Assertions per retained branch
→ propose at most five direct low-confidence Hypothesis/Prediction branches
→ Question: create Hypothesis, then create Question → Hypothesis frames Framing Link
→ other anchors: create Node, then immediately create an Edge from the existing Node/Result anchor to the new Node
→ use predicts for Finding/Hypothesis → Prediction; otherwise choose the narrowest valid relation
→ on relationship failure, re-read/retry or delete the orphan Node after its relations are clear
→ re-read and report the exact persisted ids
```

一次真实点击授权保存该步所有通过 Core 校验的直接分支，不需要逐条确认，也不授权
多轮或递归。单步结束不更新 Focus。若当前 Chat 研究目的不清楚、Evidence Assertion
是 Focus 且没有可用 Node/Result 锚点，或检索不能提供真实来源文字并支持明确关系，
Skill 不创建孤立分支。自动扩展不得创建 Finding，所有新 Node 使用 `low` confidence，所有
`ai_inference` Edge 必须带检索 provenance、Evidence Gap 与结构化
`publication_refs`。机器审核记录必须带最小 Citation Snapshot 和审核理由，且只作为
`machine_reviewed`；只有用户事后接受才能成为人工 `reviewed`。

Progressive Research Run 工作流只接受当前 Chat 中的明确用户请求。模型先陈述用户
目标和有界计划，维护一个 current continuation 与 visited state，按“读取当前
Question/Hypothesis 和方向邻居 → 完成一个检索 Skill → 读取高价值来源文字 → 加载
`scifork-research` → machine-review Evidence → 保存本层全部合格连接 → 自动选择一个
新 Hypothesis 作为唯一下一层”逐轮执行。未选择的 Hypothesis 与全部 Prediction 保留为
本次运行的终止旁支；不存在可继续的新 Hypothesis 时停止。默认检索 provider 是
packaged PubMed Skill，也允许用户指定其他数据库、PDF Skill 或已有可靠 Chat 材料。
模型达到用户范围、耗尽计划、遇到不可恢复错误或需要改变目标时停止并汇报；不逐层
请求确认，不得转为后台任务或静默扩大目标。

Evidence 拒绝工作流先读取引用它的 Node/Edge，逐条移除活动引用并报告受影响分支，
再执行 guarded review transition。删除分支工作流先读取目标、Focus 和关系，必要时清理
Focus，再逐条 `delete_framing_link` 与 `delete_edge`，最后按叶到根顺序 `delete_node`。
工具拒绝仍有关联关系的 Node、Finding 或删除后
使 Finding 失去支持的 Edge；大模型根据结构化错误重新读取并决定是否继续。

### 10.3 PubMed Search Skill

Bundle 同时贡献通用 `pubmed-search` Skill。Host 只为它注册 directory `resourceBase`，精确指向 package-owned `skills/pubmed-search` 目录；`SKILL.md` 显式引用相对资源 `helper.mjs`，DSH 在模型加载 Skill 时提供基目录并要求按需解析，不列举目录。模型不得扫描安装目录、猜测包位置、把 helper 复制进 Research Project，或创建中间请求文件。

它的 catalog description 明确说明这是紧凑的 PubMed search/PMID-or-DOI lookup Skill，必须在对应检索阶段完成实际检索，随后才加载 `scifork-research`；检索未完成时不得同时加载二者。Progressive Research Run 可以由大模型为下一 Hypothesis continuation 重复该顺序，但 Skill 之间仍不互相调用。该描述借鉴通用生命科学检索 Skill 的路由原则：描述先限定适用任务，所有请求使用随包脚本，默认返回紧凑结构而非原始上游响应，失败明确且不合成记录。

辅助脚本请求为：

```ts
type PubMedSkillRequest =
  | { operation: 'search'; query: string; retstart?: number; retmax?: number }
  | { operation: 'lookup'; identifier: { pmid?: string; doi?: string } }
```

Search：

- `query` 原样使用 PubMed/Entrez 查询语法。
- 默认 `retmax=20`，单批最大 300；返回总数和下一页位置，不限制可分页检索的总数。
- 返回 PMID、DOI、title、journal、year、简化 authors 和 publication type。

Lookup：

- 返回一篇确定性记录，可包含可用 abstract。
- 保留 canonical URL 和 retrieval time。

辅助脚本直接调用 NCBI Entrez E-utilities，设置 `tool`、`email`、超时、User-Agent 和有界重试。无 API Key 时最多 3 requests/second，有用户配置的 API Key 时最多 10 requests/second；超过约 200 个 PMID 的批量元数据请求使用 POST 或 Entrez History。

脚本默认从 stdin 接收紧凑 JSON，也允许不支持管道的 Host 传入一个 JSON 参数。脚本输出有界紧凑 JSON 到当前 Chat context，不保存文件或原始响应，不生成 Draft，也不调用 SciFork tools。它不自动扩展 MeSH，不实现 PubTator、全文下载、缓存、RAG 或文章知识图谱。完整输出可能由 DSH Chat 保留；SciFork 没有公开契约删除该历史。检索失败作为 Skill 执行结果显示，不进入 SciForkError。

### 10.4 其他检索 Skills

大模型可以改用其他数据库检索或 PDF 解析 Skill。它们只需把结果留在当前 Chat context，不需要理解 SciFork schema。随后大模型加载 `scifork-research`：普通导入完成统一 Draft 格式化并记录实际 retrieval Skill；普通导入与获授权扩展都只把通过同一自动审核规则的最小 Evidence Assertion 通过 typed command 持久化。

SciFork Core 只信任最终 Draft 或 typed command：它校验 schema、Publication Reference、
locator、数量和大小；没有 PMID/DOI 的候选不可持久化。普通导入与扩展都必须校验
Citation Snapshot 和审核理由并逐项写入 `machine_reviewed`。Core
不接收 abstract、全文、PDF、解析文本、authors、publication types、retrieval URL/time
或 raw provider response 字段。

## 11. Git 检查点

### 11.1 初始化

`/research init` 是显式用户操作：

- 创建缺失的受管目录和 manifest。
- 项目根没有 `.git` 时执行普通 `git init`，使用用户现有默认分支策略。
- 不创建 `main`、个人分支或 repository-local branch 配置。
- 使用现有 Git identity；缺失时返回提示，不修改全局配置。
- 在当前分支创建基线检查点。

detached HEAD、unmerged entries 或 Git root 与项目根不一致时拒绝 mutation。

### 11.2 Mutation

每个成功 ResearchCommand 产生一个检查点：

- cwd 固定为项目根。
- 使用 argv 数组调用固定 Git executable。
- 只包含 `research.json`、`questions/`、`question-links/`、`nodes/`、`edges/`、
  `evidence/`、`results/`。
- 不使用 `git add .`。
- 不改变不相关 staged files。
- mutation 前若受管路径已有外部 dirty change，则返回 stale/只读诊断。
- create/update 的内容访问继续通过 `ctx.fs`。由于 pinned DSH filesystem contract
  没有 delete，Core 校验后的单文件删除使用固定 Git executable 和 argv-only
  `git rm -- <core-derived-managed-path>`；该命令已暂存删除，因此删除检查点直接
  对同一精确 path 执行 `git commit --only`，不再对已不存在的 path 执行
  create/update 的 `git add`。模型不能提供路径或 Git argv。

### 11.3 Git 历史边界

SciFork 不提供 Back/Forward，不维护 checkpoint 栈、undo storage 或恢复状态机。
它只在 mutation 成功后，尝试用 argv-only Git 为受管路径创建一次当前分支提交。
提交失败返回 `CHECKPOINT_FAILED` 诊断，不执行复杂的破坏性补偿；若提交状态不
确定，返回需要人工检查的不可恢复诊断。历史恢复、分支、远端、merge、rebase
和冲突解决由 DSH Chat 或用户完成。SciFork 只在后续读取时检测外部 HEAD/分支
变化并重新解析项目。

## 12. 一致性与安全

### 12.1 并发

- 同一 project root 的 mutation 经过一个 Host 内存队列。
- 写前验证 `expectedProjectRevision`；更新已有实体时再验证 `expectedFileVersion`。
- 一个窗口成功写入后，其他窗口的旧请求返回 `STALE_REVISION`。
- branch 或 HEAD 外部变化触发重新解析；不维护恢复状态。
- unmerged entries 或 schema 错误使 Graph 只读。

不设计分布式锁、数据库事务或跨进程协调。MVP 假设一个本地 DSH Host 进程拥有项目。

### 12.2 Web 安全

- v0.1 仅允许 DSH Web 监听 `127.0.0.1`；Host 在 WebServer 为
  `0.0.0.0` 时 fail closed，不依赖可伪造的 `Host` Header 代替监听地址检查。
- Companion 与 API 同源，不启用 CORS；浏览器 JSON POST 必须携带与
  当前 `Host` 的 scheme + authority 精确同源的 `Origin`。
- JSON POST 验证 Page Key、Host、Origin、实际 socket 地址、精确 JSON
  Content-Type 和 body size；超限请求返回有界 413 JSON，不在响应前销毁 socket。
- 静态路由只返回 build manifest 内资源。
- CSP 至少限制 `default-src 'self'`、`connect-src 'self'`，禁止 object/frame。
- Page Key 只在 fragment、sessionStorage 和 Host 内存中出现。
- SciFork 日志、错误、项目、Git 与缓存不记录 Page Key、prompt、abstract/full-text/PDF、
  解析来源文字、完整检索元信息、authors、publication types、retrieval URL/time、raw
  provider response、Draft 正文或本地绝对路径。DSH 通过 directory `resourceBase` 把
  package-owned `pubmed-search` 目录作为 Skill 加载结果提供给模型，并可能在本地 Session
  保留 Skill 输出；SciFork 不能删除该 Chat 历史，也不得把 package 路径再复制到用户可见
  回答、项目文件或 SciFork 诊断。
- API 不接收模型提供的路径或 Git argv。

### 12.3 Research data

检索 Skill 输出、PDF 解析结果、Research Import Draft 和项目 Markdown 都是不可信数据：

- 不作为系统指令。
- 不执行其中命令或脚本。
- 进入持久化前经过 schema、Publication Reference 与 locator 校验。
- 自动审核还验证真实 source locator、Citation Snapshot、entailment/direction/limitations
  理由，并只持久化派生 assertion 与最小 citation 字段；title-only 记录不能通过。
- 检索阶段结束后，SciFork-owned 内存不建立长期检索缓存；原始文章、PDF、abstract、
  全文、解析文本和完整 provider response 不写入项目或 Git。
- PHI、PII 或受控访问数据是否进入 Git 由用户负责；README/SECURITY 必须提示仓库共享风险。
- SciFork 不自动上传 Graph、Result 或本地路径到自建服务。

## 13. 精简错误模型

```text
PROJECT_NOT_INITIALIZED
PROJECT_REPOSITORY_MISMATCH
UNSUPPORTED_SCHEMA_VERSION
INVALID_ENTITY
INVALID_IMPORT_DRAFT
STALE_REVISION
STALE_TARGET
WRITE_DENIED
READ_ONLY_CONFLICT
GIT_UNAVAILABLE
GIT_STATE_UNSUPPORTED
CHECKPOINT_FAILED
PAGE_KEY_INVALID
SESSION_UNAVAILABLE
RESEARCH_EXPANSION_REJECTED
```

Research Expansion channel 使用 `scifork:research-expansion:v1:` 前缀，请求类型为
`research_expansion`；Bridge 拒绝提交时返回 `RESEARCH_EXPANSION_REJECTED`。

错误 payload：

```ts
interface SciForkError {
  code: string
  message: string
  recoverable: boolean
  hint?: string
  entityId?: string
}
```

不为尚未实现的 provider、migration、cache、multi-step timeline 或远程部署预留错误码。

## 14. 技术选择

| 领域 | 选择 |
| --- | --- |
| 语言 | TypeScript strict |
| 包管理 | 单 package 的 pnpm |
| 测试 | Vitest |
| Schema | Zod |
| Markdown front matter | gray-matter + YAML parser |
| Graph | `@xyflow/react` |
| Layout | `@dagrejs/dagre` |
| Details | `react-markdown` + `remark-gfm`，raw HTML disabled |
| Companion styling | Tailwind CSS build-time utilities + SciFork theme tokens 负责全部通用 UI；无浏览器 runtime，手写 CSS 仅保留 Preflight 禁用所需的最小文档基础归一化、React Flow 外部选择器、卡片展开和必要 Markdown pseudo-element |
| Web API | DSH `ctx.webServer.register` + typed JSON POST |
| Research Expansion submit | scoped BroadcastChannel + public SessionInput |
| Git | DSH `ctx.subprocess` + system Git |
| PubMed | packaged Skill helper + NCBI Entrez E-utilities |
| Hash | Node crypto SHA-256 |

MVP 不引入 Express、Next.js、SQLite、Neo4j、Redis、Zustand、simple-git 或 GitHub SDK。

## 15. 精简测试

### 15.1 Core

- 所有实体 schema 的成功与失败 fixture。
- Research Question/Framing Link schema、端点、`frames` 唯一关系与依赖删除保护。
- Evidence 状态机、machine-review 必填字段、活动引用拒绝保护、Result 与 Finding 支持门槛。
- Markdown round-trip 与 Publication Reference 规范化、PMID/DOI 一致性。
- projectRevision/fileVersion guard。
- Research Import Draft schema、标识准入、locator 和禁止字段。
- `predicts` 端点约束、machine Evidence 不满足 literature/Finding、删除版本保护、关联
  Edge/Framing Link 阻止 Node 删除，以及删除后 Finding 支持门槛。
- 单实体命令失败不写入或删除文件。

### 15.2 Host / Git / Skills

- Project Locator containment 和 Git root equality。
- 三个工具注册、卸载与参数上限。
- directional neighbors 读取 incoming/outgoing/both Edge 与紧凑相邻实体卡片，且不返回
  相邻正文或本地路径。
- Question 读取返回 framed entities，Framing Link 不混入 scientific neighbors；所有实体均可合法 Focus。
- entity read 返回 `fileVersion`；apply 暴露 Question/Framing Link commands 与
  `delete_edge`/`delete_node`，删除只使用 Core 派生的受管路径。
- 两个 packaged Skill 的发现、加载与卸载。
- PubMed helper 的完整查询、300 条分页、lookup、空结果、超时和无效响应 fixture。
- checkpoint 包含两个新增受管目录且不改变无关 staged files；失败只返回结构化诊断。
- Skills 要求真实 abstract/PDF 文字、先 Evidence 后分支、最小 Citation Snapshot，并且不请求持久化原始检索材料。
- 当前分支初始化，不创建或切换分支。
- 不提供 SciFork-owned Back/Forward；历史恢复由 DSH Chat 或用户完成。
- conflict、external dirty 和 stale revision 进入只读或拒绝写入。

### 15.3 Companion / Bridge

- Open action 不占用 single slot。
- Page Key 绑定、fragment 清除、失效和错误项目访问。
- 一套响应式布局在 Tailwind 默认 `sm/md/xl` 边界两侧可用；Graph 的 TB/LR 与 Details
  的 bottom/side 切换分别严格对齐 `md` 和 `xl`。
- Focus 正式高亮只来自 Host 确认状态，连续实体点击不会被丢弃或与模型可读 Focus 分叉。
- 实体完整 ID 可见，ID 本身可通过 click/Enter/Space 复制并提供轻量状态反馈；Details
  两行固定头部突出精确类型并合并引用/Focus 元数据；
  卡片 hover/focus 本体展开完整标签并保持全图布局稳定。
- 精确实体类型用文字和颜色圆点共同显示；Question 使用中性卡片，Framing Link 与科学 Edge 可区分。
- 默认 Main 隐藏全部 Evidence；只有有效锚点可进入锁定的 Evidence 子图，返回 Main
  恢复锚点 Focus。Node 卡片与 Details 的 publication、machine-reviewed、human-reviewed
  计数和结构化引用一致。
- Node/Edge Literature Details 按审核状态及 retrieval-only 分组显示最小 citation 字段，
  rejected 默认收起且不触发远程请求。
- Tailwind utilities 覆盖页面骨架、顶栏、按钮、通知、卡片、Details、排版和响应式布局，
  手写 CSS 不重复这些通用样式。
- Details 抽屉默认打开、页面内可收起；`<xl` bottom、`xl+` side、固定单行顶栏和内部
  正文滚动在全部默认 breakpoint 边界都不产生页面撑高或重叠。
- `Research & Expand` 的计算样式为暖白 surface 与绿色 accent 文字，不是实心绿色 CTA。
- 页面隐藏暂停 snapshot polling。
- Details 阻止 raw HTML、脚本、远程资源和路径逃逸。
- Research & Expand 真实点击后调用 `setDraft + submit`；prompt 使用 Focus id/摘要，要求
  先检索真实来源文字、先保存 machine-reviewed Evidence，再保存最多五条直接分支，
  区分 Question/普通 Focus、保持 Focus 且不递归。
- idle Session 启动、busy Session 排队。
- 错误 Session/channel 不发送，ack timeout 显示 Retry/Copy。
- 最近 256 个 nonce 内重复 nonce 不重复提交；更早 nonce 被淘汰后不再提供永久去重保证。

### 15.4 E2E

```text
fresh DSH profile
→ install one tarball
→ /research init on current branch
→ open standalone Companion
→ persist and focus an open Research Question
→ verify Main view excludes Evidence by default
→ model loads pubmed-search
→ full PubMed query with paged metadata
→ PMID/DOI lookup
→ model loads scifork-research
→ state the Question objective and click Research & Expand
→ verify corresponding Chat starts or queues
→ verify PubMed search/lookup precedes mutation
→ verify machine-reviewed Evidence precedes each retained Hypothesis and each frames the Question's scope
→ verify title-only records are omitted and Focus is unchanged
→ explicitly ask Chat for a bounded Progressive Research Run across at least two levels
→ verify every retained node is connected, no machine Evidence creates a Finding, and the run stops
→ accept one Evidence item and reject another after unlinking active references
→ select a rejected branch, ask Chat to delete the current Focus, verify the reported id, then delete Framing Link/Edge before Node
→ focus an entity with direct Evidence, enter its locked Evidence view, and verify citation Details without remote fetch
→ repeat with one alternative retrieval/PDF Skill
→ separately format Research Import Draft and import a qualifying machine-reviewed item through the ordinary flow
→ load scifork-research and import one formatted Draft item
→ create validated Result and support Edge
→ ask the corresponding DSH Chat for Git history recovery
→ reload Companion
→ uninstall bundle
→ Research Project and DSH Session remain readable
```

最终检查还扫描 Research Project、Git diff、SciFork logs/errors/cache，确认没有 abstract、
全文、PDF、解析文字、完整检索元信息或 raw provider response。

不为 Post-MVP 能力建立阻塞测试。

## 16. 实现里程碑

### M0：Compatibility

- 单 bundle load/unload。
- `ctx.webServer` route/disposer。
- `sidebar.footer.action` Open action 和 `wide` 折叠语义。
- scoped `SessionInput.setDraft + submit`。
- 两个 packaged Skill 的发现与顺序加载。
- argv-only Git 和 fresh-profile smoke。

### M1：Core 与 Git

- Question/Framing Link/Evidence schema、parser、validator、projection 与审核状态机。
- typed commands 与 Research Import Draft validator。
- Project Locator、三个工具。
- 当前分支受管路径 checkpoint 与失败诊断，不包含 SciFork-owned 历史恢复。

### M2：Companion

- Page Key 和同源 API。
- 默认排除 Evidence 的 Main 主图、锁定锚点的 Evidence 子图、Question/Framing Link、
  Focus 居中高亮、单一上下文视图切换按钮、
  分组 Literature Details、响应式布局和安全渲染。
- visible-only polling。
- Research Expansion BroadcastChannel 与单步自动 Chat submit。

### M3：Research

- `SciFork Research` Question framing、Draft 格式化、Evidence 自动审核、单步/递进研究与批判。
- `pubmed-search` helper、300 条分页和 PMID/DOI lookup。
- 其他检索 Skill 结果的统一 Draft 格式化。
- v0.0.1 follow-up：文献支撑的单步扩展、Chat 授权的递进研究、`predicts`、typed Edge/Node 删除流程。
- E2E、release tarball、README/SECURITY。

没有独立 SF 编号清单；实现任务从这四个里程碑拆 issue 即可。

## 17. 主要风险

| 风险 | 应对 |
| --- | --- |
| DSH preview API 变化 | 锁定版本、薄 Bridge、M0 smoke |
| 浏览器阻止新窗口 | 同步打开空窗口，失败时提供 `/research open` 链接 |
| Research Expansion 发送到错误 Session | Page Key 绑定 scope，Bridge 只监听自己打开的 channel |
| Bridge 不可用 | ack timeout，保留 Retry/Copy |
| 两窗口 stale write | project queue + expectedProjectRevision |
| PubMed 限流或格式变化 | 300 条分页、官方速率、POST/History、超时和响应校验 |
| 检索 Skill 输出不可信 | 普通导入与扩展都只从真实来源文字生成有 locator、Citation Snapshot 和审核理由的 machine Evidence |
| 自动审核被误解为人工接受 | 独立 `machine_reviewed` 状态、UI 分开计数、Finding/literature 只接受人工 reviewed |
| 自动扩展污染 Graph | 先检索和 Evidence、真实点击只授权单层最多五条、低置信、去重、每条必须有科学 Edge 或 Framing Link |
| 检索材料泄漏到项目/Git | Core 拒绝原文字段、helper 不落盘、只保存最小 Citation Snapshot、最终扫描 |
| 递进研究失控或偏离目标 | 只接受明确 Chat 请求、声明有界计划、维护单一 continuation/visited、达到停止条件即汇报 |
| Git 外部变化或冲突 | 当前分支检测、结构化诊断、只读模式 |
| Markdown 注入 | raw HTML off、CSP、路径 containment |
| 敏感数据进入 Git | README/SECURITY 提示，绝不自动远端同步 |

## 18. MVP 完成定义

- 单 package 构建为一个可安装 tarball。
- 无第三方 DSH 插件即可打开独立 Companion。
- 页面在窄窗和宽窗下使用同一响应式布局。
- Companion snapshot 保留完整投影，页面默认显示非 Evidence Main，并可从有效 Focus
  进入锁定锚点的 Evidence 子图；Focus 继续决定视图中心、高亮与 Details。
- Graph、文件、Focus 和 Chat context 一致。
- Research & Expand 点击后自动提交到对应 Chat；idle 启动、busy 排队，并在先完成
  PubMed 检索和 machine Evidence 后默认保存最多五条有科学 Edge 或 Framing Link 的
  直接低置信分支，Focus 保持不变。
- 用户可在 Chat 中明确请求 provider-neutral Progressive Research Run；按钮和已保存
  节点不会自动递归。
- Page Key 无二阶段交换，且不会暴露 cwd 或跨项目访问。
- Research Question/Framing Link/Publication Reference/Evidence Assertion/Result/Finding 边界通过 Core 校验。
- `machine_reviewed` 可连续支撑探索分支但不能满足 Finding 或 literature Edge；用户可事后接受/拒绝。
- `SciFork Research` 与 `pubmed-search` 两个 Skill 可被发现、顺序加载和卸载。
- PubMed Skill 支持完整查询、单批 300 条分页与 PMID/DOI lookup。
- 大模型能先使用任一检索 Skill，再使用 `scifork-research` 格式化 Research Import Draft。
- 当前分支自动尝试受管路径 checkpoint；Git 历史恢复由 DSH Chat 或用户完成。
- 不实现自动分支、远端 Git、多级 timeline、自动 MeSH 扩展、PubTator、全文、缓存或 RAG；
  项目、Git、日志与缓存不保留完整检索元信息、abstract、PDF、全文、解析文字或原始响应。
- 冲突、stale write 和无效 Draft 由 SciFork 明确提示；PubMed 失败由检索 Skill 明确显示。
- 卸载后 Research Project 与 DSH Session 仍可读取。

## 19. 参考

- [DeepSeek Harness Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [HTTP Server subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md)
- [Host WebServer contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/webserver/README.md)
- [Filesystem subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/filesystem.md)
- [Storage subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/storage.md)
- [Skills subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)
- [Client modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md)
- [UI layout source](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/src/client/index.ts)
- [Conversation Input contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/input/contract.ts)
- [Conversation InputHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/input/hub.ts)
- [Subprocess service](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subprocess/README.md)
- [NCBI E-utilities parameters and limits](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [DSH-better-sidebar v0.15.2](https://github.com/omdsh-dev/DSH-better-sidebar/releases/tag/v0.15.2)
- [DSH-better-sidebar MIT License](https://github.com/omdsh-dev/DSH-better-sidebar/blob/v0.15.2/LICENSE)
