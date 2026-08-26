# SciFork 软件架构与实现设计 v0.12

> 状态：Proposed（MVP 精简版）
> 日期：2026-08-24
> 上位设计：[SciFork 产品设计 v0.11](./scifork-product-design.md)

## 1. 架构结论

MVP 采用以下决策：

1. Research Project 文件是唯一科研事实源。
2. Graph 是可重建投影，不引入数据库。
3. SciFork 是一个 DSH bundle、一个 package，不建设内部 npm monorepo。
4. Core 保持纯 TypeScript，Host 和 Web 只是适配层。
5. Graph 使用 DSH 同源的独立 Companion 页面，不占用 DSH single slot。
6. DSH Bridge 只提供 Open action 和 Simulate 自动提交。
7. 页面只有一套响应式布局。
8. Page Key 直接绑定 session/project，不再做两阶段 token exchange。
9. Git 使用当前分支，每次 mutation 仅尝试创建受管路径提交；SciFork 不维护
   undo/redo 或历史恢复状态。
10. MVP 发布一个 SciFork 专用的 `SciFork Research` Skill，以及一个通用的 `pubmed-search` 检索 Skill。
11. 大模型先使用检索 Skill，再使用 `SciFork Research` 格式化 `Research Import Draft`；Skill 之间不互相调用。
12. 文献 Evidence 直接保存 PMID/DOI，不建立 Source 实体；任何检索结果都必须经过 Draft 格式化与 SciFork 校验。
13. `better-sidebar` 固定参考 v0.15.2，但不是运行依赖。
14. v0.1 只支持 loopback DSH Web，不开放独立端口、CORS、登录或远程访问。

## 2. DSH 集成基线

实现只使用锁定 DSH 版本中已经公开的扩展面：

- `ctx.tools.register()`：注册模型工具。
- `ctx.fs`：受工作区约束的文件访问。
- `ctx.storageDomain`：保存 Focus 和 Page Key binding；不保存 Git undo/redo 状态。
- `ctx.webServer.register()`：注册 `/scifork/*` 同源 exact/prefix 路由。
- `ctx.subprocess`：用 argv 数组调用本地 Git。
- `ctx.skills`：贡献 package-owned `SciFork Research` 和 `pubmed-search` 两个 Skill，由大模型按步骤加载。
- `shell.overlay`：注册 additive `Open Research Graph` 操作。
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
               │ Simulate submit                     │ Page Key
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
│ research.json + nodes/edges/evidence/results + Git              │
└─────────────────────────────────────────────────────────────────┘
```

没有额外服务、数据库、WebSocket、远程账户系统或第三方 UI provider。

## 4. 单 package 结构

```text
SciFork/
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
│   │   └── import-draft.ts
│   ├── host/
│   │   ├── index.ts
│   │   ├── project-locator.ts
│   │   ├── tools.ts
│   │   ├── web-routes.ts
│   │   ├── ui-state.ts
│   │   └── git-checkpoints.ts
│   ├── bridge/
│   │   └── client.tsx
│   └── companion/
│       ├── index.html
│       ├── app.tsx
│       ├── api.ts
│       ├── graph.tsx
│       ├── details.tsx
│       └── styles.css
├── skills/
│   ├── pubmed-search/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── pubmed.mjs
│   └── scifork-research/
│       └── SKILL.md
├── tests/
└── dist/
    ├── host.js
    ├── client.js
    └── companion/
```

这些目录是源码边界，不是独立 package。根 `package.json` 是唯一依赖图、构建入口和发布单元。

Release 只交付一个预构建 `dsh-scifork-<version>.tgz`。tarball 包含 Host、Bridge、Companion assets、`SciFork Research` 与 `pubmed-search` 两个 Skill、README 和许可证，不包含 `workspace:*` 或第三方 DSH 插件依赖。

## 5. Research Project 格式

### 5.1 目录

```text
research-project/
├── research.json
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
type EvidenceReview = 'candidate' | 'reviewed' | 'rejected'
type ResultStatus = 'draft' | 'validated' | 'superseded'
type Relation = 'supports' | 'contradicts' | 'causes' | 'associated_with'
type EdgeBasis = 'literature' | 'experiment' | 'ai_inference'

interface PublicationReference {
  pmid?: string
  doi?: string
}
```

关键规则：

- Finding 至少有一个 reviewed supporting Evidence Assertion，或一个 validated Result 的 supporting Edge。
- Hypothesis/Prediction 不得伪装为 Finding。
- Evidence Assertion 必须直接包含 Publication Reference 和精确 locator；Publication Reference 至少有 PMID 或规范化 DOI。
- PMID 与 DOI 同时存在时必须指向同一篇文献，并以 PMID 为 canonical、DOI 为 alias。
- 不建立 publication/Source entity；同一文献可以对应多条 Evidence Assertion。
- Node/Edge 只正向引用 reviewed Evidence Assertion。
- Result 直接投影为 Graph entity，不创建 Evidence 或 Node 包装。
- Confidence Band 是支持强度，不是统计概率。
- 任何 `ai_inference` 都必须保留 provenance 和 Evidence Gap。
- 不物理删除；使用 rejected 或 superseded。

### 5.3 版本

- `fileVersion`：目标文件内容 SHA-256，用于单文件写保护。
- `projectRevision`：按稳定路径排序后的全部受管文件 SHA-256，用于 snapshot 缓存和跨实体前提校验。

不在仓库中保存 graphVersion。

## 6. Core

Core 不依赖 DSH、Node 文件 API、Git 或浏览器。

```ts
interface ResearchProject {
  manifest: ResearchManifest | undefined
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
  | CreateEvidenceAssertion
  | ReviewEvidenceAssertion
  | CreateNode
  | UpdateNode
  | CreateEdge
  | UpdateEdge
  | CreateResult
  | UpdateResult
  | ImportDraftItem
```

每条命令只持久化一个实体。`ImportDraftItem` 只能转换已经通过整体校验且被用户选择的一个 Evidence Candidate。

写入顺序：

```text
parse current project
→ verify expectedProjectRevision / expectedFileVersion
→ validate command
→ render one target file
→ atomic replace
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
- Draft 中的 review state 只能是 candidate。
- Finding、Edge、Result、受管路径、Git 参数和 UI 状态不是 Draft 字段。
- 整个 Draft 先做 schema 校验；用户只能选择通过标识与 locator 校验的候选，再逐项转换为普通单实体命令。
- 未选择、不可导入或校验失败的条目不进入仓库。
- 同一 Publication Reference 可以用于多条不同 Evidence Assertion；不创建或合并文献实体。

Research Import Draft 是瞬时交互对象，不写入 Research Project 或 Git。

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

`research_graph_read` 支持 summary、focus、entity、neighborhood、find 和简短 checkpoint 状态。

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

Focus 保存 `focusEntityId` 和当前路径。Git 历史状态由 DSH 或用户通过 Git 管理。

不保存多级导航栈、窗口模式或 Graph 坐标。

## 8. Companion 与 Page Key

### 8.1 路由

Host 使用 `ctx.webServer.register()` 注册：

```text
/scifork/              Companion static assets
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
→ 返回 /scifork/#key=<page-key>
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

- 窄宽度：Graph 主区，Details 在下方或覆盖层。
- 宽宽度：Graph 与 Details 并列。
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

## 9. Simulate 自动运行

Open action 创建 Page Key 时，Bridge 同时记住该 key 对应的 Session scope，并监听由 Page Key 派生的不可猜测 BroadcastChannel 名称。

```text
Companion user click
→ build bounded SimulationPrompt from current Focus snapshot
→ broadcast { nonce, prompt }
→ matching DSH Bridge receives
→ conversation.input.for(scope).setDraft(prompt)
→ conversation.input.for(scope).submit()
→ Bridge returns acknowledgement
```

约束：

- 只有 click handler 能发送，页面加载和后台刷新不能发送。
- prompt 有字节上限，只包含当前 Focus、邻域摘要和明确任务。
- Bridge 只接受自己打开的 Page Key channel。
- nonce 在页面内只使用一次，重复消息被丢弃。
- Session 空闲时 submit 启动；运行中使用 DSH 默认 Queue，不执行 steer 或 cancel。
- Bridge ack 只表示已交给 DSH input transaction；发送拒绝由 DSH 在对应 composer 中显示并保留 draft。
- Companion 未收到 Bridge ack 时显示 `Retry` 和 `Copy`。
- 不再使用 DraftRequest、bridge secret、Host claim 或把科研正文存入 Host 临时队列。

## 10. 大模型编排的 Skills

### 10.1 编排原则

大模型是唯一编排者：

```text
load selected retrieval Skill
→ run search / lookup / PDF parsing
→ keep retrieval results in current Chat context
→ load scifork-research
→ format Research Import Draft
→ SciFork validates
→ user reviews
→ persist selected Evidence Assertions
```

Skill 不直接调用另一个 Skill，也不共享 provider 生命周期或私有中间协议。检索结果不是 Draft；只有大模型加载 `scifork-research` 后生成的结构才是 Research Import Draft。

### 10.2 SciFork Research Skill

Bundle 通过 `ctx.skills` 贡献 package-owned `scifork-research`：

- Retrieval guidance。
- Research Import Draft formatting。
- Simulation。
- Critique。
- SciFork typed tools 调用规则。

它读取当前 Chat context 中已有的检索结果，负责格式化、推理和提案；不拥有网络客户端，不直接写文件，也不绕过用户确认。

### 10.3 PubMed Search Skill

Bundle 同时贡献通用 `pubmed-search` Skill。其 `SKILL.md` 指导大模型使用随 Skill 打包的轻量辅助脚本：

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

脚本输出有界 JSON 到当前 Chat context，不生成 Draft，也不调用 SciFork tools。它不自动扩展 MeSH，不实现 PubTator、全文下载、缓存、RAG 或文章知识图谱。检索失败作为 Skill 执行结果显示，不进入 SciForkError。

### 10.4 其他检索 Skills

大模型可以改用其他数据库检索或 PDF 解析 Skill。它们只需把结果留在当前 Chat context，不需要理解 SciFork schema。随后大模型加载 `scifork-research` 完成统一格式化，并在 Draft provenance 中记录实际使用的检索 Skill。

SciFork Core 只信任最终 Draft：它校验 schema、Publication Reference、locator、数量和大小；没有 PMID/DOI 的候选不可持久化。用户选择后，SciFork 才逐项写入 Evidence Assertion。

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
- 只包含 `research.json`、`nodes/`、`edges/`、`evidence/`、`results/`。
- 不使用 `git add .`。
- 不改变不相关 staged files。
- mutation 前若受管路径已有外部 dirty change，则返回 stale/只读诊断。

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
- 日志不记录 Page Key、prompt、abstract、Draft 正文或本地绝对路径。
- API 不接收模型提供的路径或 Git argv。

### 12.3 Research data

检索 Skill 输出、PDF 解析结果、Research Import Draft 和项目 Markdown 都是不可信数据：

- 不作为系统指令。
- 不执行其中命令或脚本。
- 进入持久化前经过 schema、Publication Reference 与 locator 校验。
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
READ_ONLY_CONFLICT
GIT_UNAVAILABLE
GIT_STATE_UNSUPPORTED
CHECKPOINT_FAILED
PAGE_KEY_INVALID
SESSION_UNAVAILABLE
SIMULATE_BRIDGE_UNAVAILABLE
```

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
| Web API | DSH `ctx.webServer.register` + typed JSON POST |
| Simulate | scoped BroadcastChannel + public SessionInput |
| Git | DSH `ctx.subprocess` + system Git |
| PubMed | packaged Skill helper + NCBI Entrez E-utilities |
| Hash | Node crypto SHA-256 |

MVP 不引入 Express、Next.js、SQLite、Neo4j、Redis、Zustand、simple-git 或 GitHub SDK。

## 15. 精简测试

### 15.1 Core

- 所有实体 schema 的成功与失败 fixture。
- Evidence Assertion、Result、Finding 支持门槛。
- Markdown round-trip 与 Publication Reference 规范化、PMID/DOI 一致性。
- projectRevision/fileVersion guard。
- Research Import Draft schema、标识准入、locator 和禁止字段。
- 单实体命令失败不写文件。

### 15.2 Host / Git / Skills

- Project Locator containment 和 Git root equality。
- 三个工具注册、卸载与参数上限。
- 两个 packaged Skill 的发现、加载与卸载。
- PubMed helper 的完整查询、300 条分页、lookup、空结果、超时和无效响应 fixture。
- checkpoint 只提交受管路径且不改变无关 staged files；失败只返回结构化诊断。
- 当前分支初始化，不创建或切换分支。
- 不提供 SciFork-owned Back/Forward；历史恢复由 DSH Chat 或用户完成。
- conflict、external dirty 和 stale revision 进入只读或拒绝写入。

### 15.3 Companion / Bridge

- Open action 不占用 single slot。
- Page Key 绑定、fragment 清除、失效和错误项目访问。
- 一套响应式布局在窄/宽 viewport 可用。
- 页面隐藏暂停 snapshot polling。
- Details 阻止 raw HTML、脚本、远程资源和路径逃逸。
- Simulate 真实点击后调用 `setDraft + submit`。
- idle Session 启动、busy Session 排队。
- 错误 Session/channel 不发送，ack timeout 显示 Retry/Copy。
- 重复 nonce 不重复提交。

### 15.4 E2E

```text
fresh DSH profile
→ install one tarball
→ /research init on current branch
→ open standalone Companion
→ model loads pubmed-search
→ full PubMed query with paged metadata
→ PMID/DOI lookup
→ model loads scifork-research
→ format Research Import Draft
→ review Evidence Candidate
→ create Hypothesis
→ click Simulate
→ verify corresponding Chat starts or queues
→ repeat with one alternative retrieval/PDF Skill
→ load scifork-research and import one formatted Draft item
→ create validated Result and support Edge
→ ask the corresponding DSH Chat for Git history recovery
→ reload Companion
→ uninstall bundle
→ Research Project and DSH Session remain readable
```

不为 Post-MVP 能力建立阻塞测试。

## 16. 实现里程碑

### M0：Compatibility

- 单 bundle load/unload。
- `ctx.webServer` route/disposer。
- `shell.overlay` Open action。
- scoped `SessionInput.setDraft + submit`。
- 两个 packaged Skill 的发现与顺序加载。
- argv-only Git 和 fresh-profile smoke。

### M1：Core 与 Git

- schema、parser、validator、projection。
- typed commands 与 Research Import Draft validator。
- Project Locator、三个工具。
- 当前分支受管路径 checkpoint 与失败诊断，不包含 SciFork-owned 历史恢复。

### M2：Companion

- Page Key 和同源 API。
- Focus graph、响应式布局和安全 Details。
- visible-only polling。
- Simulate BroadcastChannel 与自动 Chat submit。

### M3：Research

- `SciFork Research` Draft 格式化、推演与批判。
- `pubmed-search` helper、300 条分页和 PMID/DOI lookup。
- 其他检索 Skill 结果的统一 Draft 格式化。
- E2E、release tarball、README/SECURITY。

没有独立 SF 编号清单；实现任务从这四个里程碑拆 issue 即可。

## 17. 主要风险

| 风险 | 应对 |
| --- | --- |
| DSH preview API 变化 | 锁定版本、薄 Bridge、M0 smoke |
| 浏览器阻止新窗口 | 同步打开空窗口，失败时提供 `/research open` 链接 |
| Simulate 发送到错误 Session | Page Key 绑定 scope，Bridge 只监听自己打开的 channel |
| Bridge 不可用 | ack timeout，保留 Retry/Copy |
| 两窗口 stale write | project queue + expectedProjectRevision |
| PubMed 限流或格式变化 | 300 条分页、官方速率、POST/History、超时和响应校验 |
| 检索 Skill 输出不可信 | 大模型再加载格式化 Skill，Draft 边界、PMID/DOI、locator、用户选择 |
| Git 外部变化或冲突 | 当前分支检测、结构化诊断、只读模式 |
| Markdown 注入 | raw HTML off、CSP、路径 containment |
| 敏感数据进入 Git | README/SECURITY 提示，绝不自动远端同步 |

## 18. MVP 完成定义

- 单 package 构建为一个可安装 tarball。
- 无第三方 DSH 插件即可打开独立 Companion。
- 页面在窄窗和宽窗下使用同一响应式布局。
- Graph、文件、Focus 和 Chat context 一致。
- Simulate 点击后自动提交到对应 Chat；idle 启动、busy 排队。
- Page Key 无二阶段交换，且不会暴露 cwd 或跨项目访问。
- Publication Reference/Evidence Assertion/Result/Finding 边界通过 Core 校验。
- `SciFork Research` 与 `pubmed-search` 两个 Skill 可被发现、顺序加载和卸载。
- PubMed Skill 支持完整查询、单批 300 条分页与 PMID/DOI lookup。
- 大模型能先使用任一检索 Skill，再使用 `scifork-research` 格式化 Research Import Draft。
- 当前分支自动尝试受管路径 checkpoint；Git 历史恢复由 DSH Chat 或用户完成。
- 不实现自动分支、远端 Git、多级 timeline、自动 MeSH 扩展、PubTator、全文、缓存或 RAG。
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
