# SciFork M1: Core 与 Git

> 状态：Implementation complete；方案 B 自动化检查与一次性 DSH profile smoke 均通过（未含真实模型 tool-call loop）
> 日期：2026-08-29；方案 B 更新：2026-08-27
> 上位设计：[软件架构 v0.12](../scifork-software-architecture.md) §16 M1、[产品设计 v0.11](../scifork-product-design.md)
> 钉住版本：DeepSeek Harness `0.1.1-rc.2`（沿用 M0 一次性 profile）

## Problem

M0 只证明了 bundle 可装载、路由可注册、两个 Skill 可发现、用户点击可走公开
input 事务，以及 argv-only Git probe 可用。Core 目录仍然为空，SciFork 还不
存在任何科研实体、文件格式、校验规则或检查点行为。M1 必须实现架构 §5/§6/§7/§11
的 Core 与 Git 层，并钉住实现所需的 DSH 契约（tools、storageDomain、fs、
commands），使 M2 Companion 与 M3 Research 可以直接消费。

## Goals

1. 实现纯 TypeScript Core：schema、parser、validator、projection、typed
   commands 与 Research Import Draft 校验器。
2. 实现 Host：Project Locator、`research_graph_read` / `research_graph_apply` /
   `research_graph_focus` 三个模型工具、`/research init` / `/research open` /
   `/research validate` 三个人类命令。
3. 实现当前分支受管路径的最小 checkpoint 尝试与失败诊断。
4. 用 DSH `storageDomain` 保存 Focus，不保存 Git undo/redo 状态。
5. 全量 TDD，`pnpm check` 全绿。

## Non-goals

- 不实现 Companion 页面、Page Key、Companion API、Research Expansion BroadcastChannel
  （M2）。
- 不实现 `SciFork Research` / `pubmed-search` 的 Draft 格式化与检索逻辑（M3）。
- 不实现 import 的预览 UI；M1 只实现 `ImportDraftItem` 命令与校验。
- 不引入架构 §14 之外的运行时依赖（新增 zod、gray-matter、js-yaml，均已在
  §14 批准）。
- 不在本仓库运行生产 profile 冒烟；冒烟只针对一次性 profile 且需用户批准。
- 不实现 SciFork-owned Back/Forward、undo/redo 栈或 Git 恢复状态机；历史恢复交给 DSH Chat 或用户。

## 文档修正（2026-08-24 用户确认）

产品设计 v0.11 §5 的 YAML 示例与上位设计 v0.12 的精确类型不一致，按用户确认
以下列方式对齐（v0.11 示例已同步更新）：

1. Node 文件不设 `status` 字段（v0.12 未定义 NodeStatus）；v0.11 示例中的
   `status: plausible` 已删除。
2. Locator kind 使用 v0.12 的 `pubmed_abstract`（v0.11 示例的 `abstract`
   已更正）。
3. PMID 与 DOI 同时存在时，Core 离线只能校验格式并规范化（PMID canonical、
   DOI alias）；两者指向同一文献的一致性由机器审核理由覆盖，Draft 校验报告
   `PMID_DOI_CONSISTENCY_UNVERIFIED` 提示。

## Pinned contracts（0.1.1-rc.2）

来源路径省略公共前缀
`…\@deepseek-ai\dsh\node_modules\@deepseek-ai\`。SciFork 不新增 DSH 运行时
依赖，以下契约以 `src/host/contracts.ts` 结构化声明钉住（沿用 M0 方式）。

### 1. `ctx.tools`（dsh-tools/lib/types/index.d.ts、schema.d.ts、json-schema.d.ts）

```ts
interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
interface ToolDefinition extends ToolSchema {
  output: { schema: JsonSchemaNode; render(args: unknown, value: unknown): ContentBlock[] }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
}
// ToolRunContext 含 exec.agent（Agent：id、session.header.cwd）、exec.signal（AbortSignal）
register(definition: ToolDefinition): () => void
```

- `parameters` 是 dsh-tools 强制的 JSON Schema 子集（`type`/`properties`/
  `required`/`additionalProperties`/`items`/`enum`/`const`/`oneOf`/描述注解）。
- `output.schema` 直接传给 `ctx.tools.register` 时必须是 raw JSON Schema；
  任意 JSON 的 annotation-only 形式是 `{}`。`{ type: 'json' }` 只适用于
  DSH typed helper 的 author-level schema，不能直接注册。
- `render` 返回 `[{ type: 'text', text }]`。
- 工具执行上下文：`exec.agent.id`（SessionId）、
  `exec.agent.session.header.cwd`（string | undefined）——项目根一律取自该
  cwd，绝不由模型参数或 Companion 提供。

### 2. `ctx.storageDomain`（dsh-storage-domain/lib/types/*.d.ts）

```ts
defineDomain({ name, version, tables: { <t>: domainTable(zodSchema) } })
open(spec): Promise<Domain>      // table(name).get/put/delete/update/entries；close()
```

- 域记录 schema 是 zod（DSH 用 zod ^4，SciFork 与 DSH 保持同一主版本）。
- `open` 是 Promise；close 由调用方以 `ctx.effect` disposer 执行；同名域
  single-open，bundle 重载时 disposer 释放后可重新 open。

### 3. `ctx.fs`（dsh-fs/lib/types/index.d.ts）

```ts
resolve(path, { cwd }?): Promise<FsTarget>     // targetKey 不透明；processPath() 返回绝对路径
stat(target): Promise<FsInfo | undefined>       // { version, type: 'file'|'directory'|'other', size? }
listDir(target): Promise<FsDirEntry[]>          // 稳定名称序，只读元数据
readText(target): Promise<string>
writeText(target, content, expected?, signal?, sandboxPolicy?): Promise<FsWriteOutcome>
contains(parent, child): boolean
```

- 所有项目文件内容读写经 `ctx.fs`（受 DSH 观察/沙箱策略约束），不使用裸
  `node:fs` 读写文件内容；仅 init 时用 `node:fs` mkdir 物化四个空目录。
- mutation 必须从当前公开 DSH Session 解析完整 `sandboxPolicy` 并作为逐调用参数
  传给 `writeText`；`read-only` 或项目根位于 Session workspace root 之外时，必须在
  任何文件、目录或 Git mutation 前返回 `WRITE_DENIED`。详见
  [Session-scoped filesystem writes](session-scoped-filesystem-writes.md)。
- `FsError` 码 `FS_STALE_VERSION`/`FS_NOT_OBSERVED` 映射为 `STALE_TARGET`。
- `FS_SANDBOX_DENIED`/`FS_PERMISSION_DENIED` 映射为 `WRITE_DENIED`，不得误报为
  `INVALID_ENTITY` 或泄露绝对路径。
- 无 delete/rename 能力；研究扩展只为 Core 派生的单个
  Edge/Hypothesis/Prediction 路径增加 argv-only `git rm`，不改变检查点失败时由
  DSH Chat 或用户处理的恢复边界。

### 4. `ctx.commands`（dsh-commands/lib/types/index.d.ts、types.d.ts）

```ts
register({ name, description, input?, handler }): () => void
// handler({ agent, rawInput, signal }) → { kind:'success', text? } | { kind:'error', text }
```

- `invocation.agent.session.header.cwd` 提供命令的项目根上下文。

### 5. 其他沿用 M0

`ctx.webServer`、`ctx.subprocess`、`ctx.skills`、`shell.overlay` 契约沿用
`docs/specs/m0-compatibility-spike.md`。

## Research Project 文件格式

### 目录与命名

```text
<project-root>/
├── research.json
├── nodes/node_<uuid>.md
├── edges/edge_<uuid>.json
├── evidence/ev_<uuid>.md
└── results/res_<uuid>.md
```

- `<uuid>` 为小写十六进制 8-4-4-4-12（`[0-9a-f]{8}-…{12}`）。实体 id 必须
  等于文件名去扩展名部分；不符 → `INVALID_ENTITY`。
- 四个受管目录可不存在（Git 不跟踪空目录，clone 后即为缺失）：缺失视为空集合。
- 受管目录内出现任何不符合命名模式的文件 → `INVALID_ENTITY` 诊断（只读）。
- 项目根的其他文件（数据、笔记等）不属于受管路径：不校验、不检查点。

### research.json（严格对象，拒绝未知键）

```json
{ "schema_version": 1, "project_id": "<uuid>", "name": "<1..200 字符>" }
```

- `schema_version !== 1` → `UNSUPPORTED_SCHEMA_VERSION`。

### Evidence Assertion（evidence/ev_<uuid>.md，front matter + 可选正文）

```yaml
id: ev_<uuid>
publication_ref:            # 至少含 pmid 或 doi 之一
  pmid: "12345678"          # /^[1-9][0-9]{0,7}$/
  doi: "10.xxxx/example"    # 规范化后 /^10\.\d{4,9}\/.+$/（见 §Import Draft）
locator:                    # 二选一
  kind: pubmed_abstract
  # 或 kind: pdf; page?: 1..99999; section?: 1..500 字符（二者至少其一）
assertion: "<1..4000 字符>"
direction: supports | contradicts | context
review_status: machine_reviewed | reviewed | rejected
limitations:               # 可选，≤20 条，每条 ≤500 字符
```

- 正文可选；`assertion` 即人类可读断言。
- 新建路径统一落为 `machine_reviewed`。状态机：machine_reviewed → reviewed | rejected；reviewed → rejected；rejected 终态。

### Node（nodes/node_<uuid>.md，front matter + 必填正文）

```yaml
id: node_<uuid>
kind: finding | hypothesis | prediction
confidence: low | moderate | high
evidence_refs:             # 可选，≤50 条，无重复
  - id: ev_<uuid>          # 必须指向 reviewed EA
    role: supports | contradicts   # 必须等于该 EA 的 direction（context 不可引用）
```

- 无 `status` 字段（见文档修正 1）。正文（去除 front matter 后）非空，≤64 KiB；正文第一段
  按 Companion 约定写成单句加粗主张，后续内容使用自由 Markdown。

### Edge（edges/edge_<uuid>.json，严格对象）

```json
{
  "id": "edge_<uuid>",
  "from": "<node_… | res_…>",
  "to": "<node_… | res_…>",
  "relation": "supports | contradicts | causes | associated_with",
  "basis": "literature | experiment | ai_inference",
  "evidence_refs": [ { "id": "ev_…", "role": "supports | contradicts" } ],
  "publication_refs": [ { "pmid": "12345678", "doi": "10.xxxx/example" } ],
  "provenance": "…",
  "evidence_gap": "…"
}
```

- `from ≠ to`；两端必须存在且为 node 或 result。
- `basis: literature` 必须带 ≥1 条 reviewed EA 引用（role 与 direction 一致）。
- `basis: ai_inference` 必须带 `provenance`、`evidence_gap`（各 ≤2000 字符）与
  `publication_refs`（1..50 条）；每条至少有 PMID 或规范化 DOI，列表按 Publication
  Reference 去重。这些检索引用不是 Evidence Assertion。
- `publication_refs` 只允许用于 `ai_inference`；literature/experiment Edge 拒绝该字段。
- `evidence_refs` 可选，≤50 条；`from`/`to` 在 UpdateEdge 中不可变。

### Result（results/res_<uuid>.md，front matter + 必填正文）

```yaml
id: res_<uuid>
status: draft | validated | superseded
observed_at: "YYYY-MM-DD"
```

- 正文非空，≤64 KiB；正文第一段按 Companion 约定写成单句加粗观察摘要，后续内容内部
  Method/Result/Interpretation 结构为自由 Markdown，
  Core 不解析。
- 状态机：draft → validated | superseded；validated → superseded；superseded 终态。

### 版本与修订（§5.3）

- `fileVersion(path)` = 该文件内容的 SHA-256 十六进制（64 小写字符），用于
  单文件写保护。
- `projectRevision` = 对全部受管文件按相对路径（`/` 分隔）稳定排序后，
  `sha256(path + '\n' + fileVersion + '\n')` 逐行拼接再整体 sha256。
- 仓库中不保存任何 graphVersion。

## Core（src/core/，纯 TypeScript）

Core 不 import `node:`、DSH、浏览器 API；哈希由调用方注入
`hash(content: string): string`。公开接口（沿用架构 §6）：

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

缺失或非法 `research.json` 时 `manifest` 为 `undefined`，同时会产生
`diagnostics`；这类项目仍可读取，但必须按只读处理。

内部 `LoadedProject extends ResearchProject { files: ReadonlyMap<string, string> }`
供命令校验读取当前文件内容。

### 模块

| 文件 | 职责 |
| --- | --- |
| `schema.ts` | zod 严格 schema 与 TS 类型、id/文件名规则、常量上限 |
| `revision.ts` | fileVersion/projectRevision 计算（注入 hash） |
| `parser.ts` | 文件映射 → LoadedProject（gray-matter 解析 front matter，js-yaml） |
| `validator.ts` | 跨实体不变量 → diagnostics（引用解析、reviewed-only、Finding 门槛、重复/未知文件） |
| `projection.ts` | ResearchProject → 可重建投影（实体 + 边，含 evidence_ref 投影边） |
| `commands.ts` | ResearchCommand 判别联合的 zod schema、parseCommand、planCommand |
| `import-draft.ts` | ResearchImportDraft schema、规范化与逐候选可导入判定 |

### 校验不变量（validator）

1. 所有 `evidence_refs`/边端点解析到存在的实体。
2. 引用只允许 reviewed EA；`role` 必须等于 EA `direction`（context 不可引用）。
3. Finding 支持门槛：≥1 条 reviewed EA 引用（role supports），或 ≥1 条
   validated Result → 该 Finding 的 `supports` 边（basis 不限）。
4. 实体 id 全局唯一且与文件名一致；受管目录无未知文件。
5. 任一诊断非空 → 项目只读（read 可用，apply 拒绝）。

### 命令（ResearchCommand）

判别键 `kind`，一条命令只持久化一个实体；全部载荷经 zod 严格校验。
`research_graph_apply` 的工具参数还要求 `expectedProjectRevision`（架构 §12.1）。

| kind | 载荷（必填/可选） | 规则 |
| --- | --- | --- |
| `create_evidence_assertion` | id、publicationRef?、locator、assertion、direction、citation、machineReviewRationale、limitations?、body? | 落盘 `review_status` 强制 machine_reviewed；命令不接受 reviewStatus；id 不存在 |
| `review_evidence_assertion` | id、expectedFileVersion、reviewStatus: reviewed\|rejected、limitations? | 按状态机转移 |
| `create_node` | id、nodeKind、confidence、evidenceRefs?、body | 创建 finding 须满足门槛 |
| `update_node` | id、expectedFileVersion、nodeKind?、confidence?、evidenceRefs?、body?（至少一项） | 结果态满足门槛 |
| `create_edge` | id、from、to、relation、basis、evidenceRefs?、publicationRefs?、provenance?、evidenceGap? | 端点存在；basis 规则 |
| `update_edge` | id、expectedFileVersion、relation?、basis?、evidenceRefs?、publicationRefs?、provenance?、evidenceGap?（至少一项） | from/to 不可变 |
| `create_result` | id、observedAt、body | 落盘 status 强制 draft |
| `update_result` | id、expectedFileVersion、status?、observedAt?、body?（至少一项） | 按状态机转移 |
| `import_draft_item` | id、draft（完整 ResearchImportDraft）、index | Draft 全量重校验；index 项必须通过机器审核字段校验；转换为 machine_reviewed EA 的单实体命令 |
| `delete_edge` | id、expectedFileVersion | 删除后项目仍须有效，不能使 Finding 失去唯一 Result 支持 |
| `delete_node` | id、expectedFileVersion | 只允许无关联 Edge 的 Hypothesis/Prediction；Finding 不可删除 |

- Create*：目标 id 必须不存在；文件写入用 `createIfAbsent` intent。
- Update*/review：必须携带 `expectedFileVersion`（目标文件当前 SHA-256），
  不符 → `STALE_TARGET`。
- Delete*：同样验证 `expectedFileVersion`，并只计划一个由 id 派生的现有路径。
- `planCommand(project, command)` 为 create/update 输出 `{ path, content }`，
  为 delete 输出 `{ path, writeKind: 'delete' }`；相对路径都由 Core 从实体 id
  构造（绝不接受调用方路径）。
- 所有 create/update/delete 候选计划在返回前应用到临时受管文件映射并执行完整
  parser + validator；会破坏任一跨实体科研不变量的命令必须在 Host 写入前失败。参见
  [invariant-safe typed updates](invariant-safe-updates.md)。
- `import_draft_item` 转换后的 EA：publication_ref、locator、assertion、
  direction、citation、machine_review_rationale、limitations 来自候选项；正文为空。

### Research Import Draft

zod 严格 schema（`schemaVersion: 1` literal；producer 的
`formatterSkill` 必须是 `scifork-research`，`retrievalSkill` 1..100 字符，
`generatedAt` 为可解析 ISO-8601；`evidenceCandidates` 数组；`warnings?`）。

固定上限：Draft 序列化 ≤ 256 KiB；candidates ≤ 50；assertion ≤ 4000；
limitations ≤ 20×500；locator section ≤ 500。

逐候选判定 `evidenceCandidates[i]` 的可导入性：

- 结构错误（断言为空、direction/locator 非法、缺少 locator）→ 不可导入。
- PMID 规范化：去空白，`/^[1-9][0-9]{0,7}$/`，否则无效。
- DOI 规范化：去空白与 `doi:`/`https?://(dx\.)?doi\.org/` 前缀；目录指示符
  `10.xxxx` 转小写，后缀保留原样；`/^10\.\d{4,9}\/.+$/` 否则无效。
- 至少一个有效标识才可持久化；两者都有效时提示
  `PMID_DOI_CONSISTENCY_UNVERIFIED`（一致性必须由机器审核解析，见文档修正 3）。
- Draft 声明 `review_status`、Finding/Edge/Result、受管路径、Git 参数或 UI
  状态字段 → 结构错误（zod strict 拒绝未知键）。

`ImportDraftItem` 只接受判定为可导入且具备 Citation Snapshot 与机器审核理由的候选；
不可导入或校验失败条目不进入仓库。

### 投影（projection）

```ts
interface ProjectionEntity { id; type: 'node'|'evidence'|'result'; /* 各实体字段 */ }
interface ProjectionEdge {
  from; to; relation: Relation
  source: 'edge' | 'evidence_ref'
  basis?: EdgeBasis; id?: string
}
```

- Edge 文件直接投影；每条 node `evidence_refs` 投影为 `source: 'evidence_ref'`
  的边（EA → Node，relation = role）。
- 反向关系不落盘，由投影重建（架构 §5.2）。

## Host（src/host/）

### Project Locator（project-locator.ts）

输入：`fs`、`sessionCwd`（绝对路径字符串）、`gitShowToplevel`。规则（架构 §7.1）：

1. `sessionCwd` 缺失或非绝对路径 → `SESSION_UNAVAILABLE`。
2. 从 cwd 逐级向上查找 `research.json`；到达文件系统根停止。未找到 →
   `PROJECT_NOT_INITIALIZED`。
3. 找到 regular-file marker 后即锚定项目根；当前版本 manifest 内容非法时由 Core
   返回只读诊断，明确的未来 `schema_version` → `UNSUPPORTED_SCHEMA_VERSION`；
   marker 非普通文件、不可读或 containment 失败 → `INVALID_ENTITY`。
4. 若项目根在 Git 仓库中：`git rev-parse --show-toplevel` 必须等于项目根
   （比较时忽略大小写差异），否则 `PROJECT_REPOSITORY_MISMATCH`。无 Git 时
   允许只读操作；mutation 在检查点阶段报 `GIT_UNAVAILABLE`。
5. 所有实体文件路径一律由 Core 从实体 id 构造，再以 `fs.contains(root, file)`
   做 containment 断言（不信任外部路径）。

### 三个工具（tools.ts）

全部输出 `{ ok: true, …payload }` 或 `{ ok: false, code, message, recoverable, hint?, entityId? }`
（架构 §13 错误码；直接注册的 raw output schema 为 `{}`）。Git/fs 调用转发
`exec.signal`；`research_graph_apply` 声明 `timeoutMs: 30000`，read/focus 声明
`timeoutMs: 15000`。所有工具把 `isConcurrencySafe` 设为 false（mutation 经
内存队列；读操作与写入并发时依赖 revision 校验）。

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `research_graph_read` | operation: summary\|focus\|entity\|neighbors\|find\|checkpoint、entityId?、direction?、query?、limit?（1..50） | 只读；返回投影/实体/方向邻居/焦点/当前 Git 状态 |
| `research_graph_apply` | command（判别联合 JSON Schema 描述 + Core 校验）、expectedProjectRevision | mutation 流水线（见下） |
| `research_graph_focus` | focusEntityId?: string \| null、pathIds?: string[]（≤32 项，每项必须存在） | 只写 focus sidecar，不写科研文件/Git |

`command` 参数的 JSON Schema 手写为判别联合子集（kind/必填键/enum 精确，
嵌套对象开放），权威校验在 Core zod。

### 人类命令（commands.ts）

| 命令 | 行为 |
| --- | --- |
| `/research init` | 在当前 session cwd 初始化：目录内及祖先无 research.json；cwd 无 Git 则 `git init`，有 Git 但 toplevel ≠ cwd 则 `PROJECT_REPOSITORY_MISMATCH`；写入前要求 HEAD 在分支上，并拒绝 detached、unmerged 或受管路径 dirty（新建仓库的 unborn branch 例外）；git identity（user.name/user.email 任一缺失）→ 报错不写；写 research.json（project_id = `crypto.randomUUID()`，name = 目录 basename）、mkdir 四个受管目录、基线检查点（message `scifork: init`） |
| `/research open` | 返回 Companion URL 文本（M2 替换为 Page Key 流程） |
| `/research validate` | 解析 + 校验当前项目，报告 diagnostics 摘要与 revision |

### Mutation 流水线（apply-command.ts，research_graph_apply 与 ImportDraftItem 共用）

```text
从 exec.agent 的真实 Session 解析 sandbox policy；缺失 Session/cwd 或 read-only
→ SESSION_UNAVAILABLE / WRITE_DENIED
→ 定位项目（cwd 只来自 session.header.cwd）
→ workspace-write 要求项目根位于 policy workspace root 内；越界 → WRITE_DENIED
→ 读取全部受管文件（ctx.fs listDir + readText）
→ parse + validate：诊断非空 → INVALID_ENTITY（只读）
→ expectedProjectRevision 校验 → STALE_REVISION
→ git 前置检查（项目处于 Git 仓库且 toplevel 等于项目根、symbolic-ref 分支、
  全仓库 `ls-files -u` 无未合并、受管路径 status --porcelain 为空）
  → GIT_STATE_UNSUPPORTED / READ_ONLY_CONFLICT
→ Core parseCommand / planCommand → INVALID_ENTITY
→ ctx.fs writeText（createIfAbsent / replaceIfVersion + fileVersion 双保险 + per-call policy）
→ 重读全部受管文件并要求等于“初始快照 + plan.path 新内容”（不等则返回 STALE_REVISION 诊断，不做破坏性回滚）
→ create/update: git add -- <plan.path>; deletion: retain the exact-path git rm staging
→ git commit --only <plan.path> -m "scifork: <kind> <entityId>"
→ 返回 { ok, entityId, revision, checkpointId }
```

- 同一 project root 的 mutation 经 Host 内存队列串行（架构 §12.1）。
- 初始快照与写后文件集校验防止外部编辑被误纳入本次 mutation；不一致时返回
  `STALE_REVISION`，保留文件写入并让 DSH Chat/用户重新读取和决定如何处理。
  跨进程 Git/编辑器在 preflight 与 commit 之间的 HEAD 变化属于诊断边界。
- 检查点失败（`CHECKPOINT_FAILED`）只报告提交失败或提交状态不确定，不执行
  `git checkout`、`git rm`、`git clean` 等破坏性补偿；需要恢复时交给 DSH Chat
  或用户使用 Git。
- commit 用 `--only <paths>`：不改变无关 staged files，绝不 `git add .`。
- 真实 Git 验证的路径语义：`git commit --only` 的 pathspec 必须命中 index，
  因此 create/update 先 `git add -- <paths>` 再 `commit --only`；deletion 已由
  `git rm -- <path>` 从 index 移除并暂存，直接进入同一个 `commit --only`，不得
  对已不存在的 path 再执行 `git add`。普通 mutation 的 paths 只取 Core 计划
  出的单实体 `plan.path`，初始化只提交 `research.json`。

### Git 检查点边界（git-checkpoints.ts）

SciFork 不提供 Back/Forward，不维护 checkpoint 栈、undo storage 或恢复状态机。
每次成功 mutation 只尝试用 argv-only Git 为受管路径创建一次当前分支提交；
提交失败返回 `CHECKPOINT_FAILED` 诊断，不执行复杂的破坏性补偿。历史恢复、
分支、远端、merge、rebase 和冲突解决由 DSH Chat 或用户完成。

### Focus 与存储（ui-state.ts）

storageDomain 域 `scifork_ui_state_v1`，version 1，表：

```ts
focus: key `<sessionId>:<projectId>` → { focusEntityId: string, pathIds: string[] }
```

- open 在 apply 内 await 完成后激活；close 挂 `ctx.effect` disposer。
- Focus 写入不触碰科研文件与 Git（架构 §7.4）。

## 错误码（沿用架构 §13，M1 实际使用）

`PROJECT_NOT_INITIALIZED`、`PROJECT_REPOSITORY_MISMATCH`、
`UNSUPPORTED_SCHEMA_VERSION`、`INVALID_ENTITY`、`INVALID_IMPORT_DRAFT`、
`STALE_REVISION`、`STALE_TARGET`、`WRITE_DENIED`、`READ_ONLY_CONFLICT`、`GIT_UNAVAILABLE`、
`GIT_STATE_UNSUPPORTED`、`CHECKPOINT_FAILED`、`SESSION_UNAVAILABLE`。
payload 一律 `{ code, message, recoverable, hint?, entityId? }`，不含 Page Key、
本地绝对路径或科研正文。

## Constraints

- Core 纯 TypeScript：不 import `node:`、DSH、Git、浏览器 API；哈希注入。
- Host 适配层可 import `node:`（仅 init 的 mkdir、crypto SHA-256 与 randomUUID）。
- 运行时依赖新增仅限架构 §14 已批准项：`zod@^4`（与 DSH 同主版本）、
  `gray-matter`、`js-yaml`；DSH 类型仍以结构化声明钉住（`src/host/contracts.ts`）。
- 模型参数绝不携带项目路径、Git argv 或文件正文路径；cwd 只来自 exec/agent。
- 日志不记录 prompt、Draft 正文、断言内容、Page Key 或本地绝对路径。

## Acceptance criteria

- [x] `docs/specs/m1-core-git.md` 存在且与本文件一致；v0.11 §5 示例已按
      文档修正同步；README 状态段提及 M1。
- [x] `pnpm check`（typecheck + Vitest + build）全绿；`node --check index.js`
      与 `git diff --check` 干净。
- [x] Core 测试覆盖：全部实体 schema 成败 fixture；Markdown round-trip 与
      Publication Reference 规范化/PMID-DOI 一致提示；projectRevision 精确公式/
      fileVersion；
      Finding 支持门槛；Draft schema/标识/locator/上限/禁止字段；每条命令的
      validate/render 成败与单实体边界。
- [x] Host 测试覆盖：Project Locator containment 与 Git root equality；三个
      工具注册/卸载/参数上限/read 各 operation；非法 manifest 只读诊断；
      mutation 流水线（fake fs +
      fake subprocess）的 stale revision/target、只读冲突、检查点失败诊断；
      checkpoint 只提交受管路径且不改变无关 staged files；全仓库 unmerged
      与单实体 checkpoint 路径；写后外部 managed 文件变化的 stale 诊断；
      init 的 Git 状态预检（detached/unborn/dirty）
      、git init/identity/基线检查点。
- [x] Focus 记录经 storageDomain 契约测试（fake Domain）；Git undo/redo 不进入存储。
- [x] 真实 Git 最小验证：临时仓库验证 pathspec commit 语义、无关 staged
      files 不受影响、非仓库错误分类和全仓库 unmerged 预检；历史恢复不属于 M1。
- [x] 一次性 profile 冒烟（用户已批准；方案 B 精简后于 2026-08-29 重跑）：
      工具/命令/Skill 可发现，`/research init` 在临时目录完成，
      `/research validate` 返回有效项目；公开 `ctx.tools` 服务执行一次
      `research_graph_read` 与一次 `research_graph_apply`，创建单个 Result
      并生成当前分支检查点。未经过模型 prompt，不覆盖历史恢复或失败诊断。

## Final results（方案 B，2026-08-27）

1. 方案 B 精简后 `pnpm check` 干净；19 个测试文件、233 项 Vitest 全绿，
   `pnpm build` 已重新生成 Host 与 `dist/client.js`。
2. 真实 Git 集成测试（系统 Git，临时仓库）确认：`git add + commit --only
   <paths>` 只提交受管路径且不动无关 staged files（含 unborn HEAD 根提交）；
   历史恢复不由 SciFork 执行。
3. 实现期间的契约修正（已回写本文档）：① `commit --only` pathspec 需先
   `git add`（pathspec 必须命中 index）；② front matter 解析/渲染统一使用
   js-yaml v4（YAML 1.2）引擎，替换
   gray-matter 内置的 js-yaml v3，保证 round-trip 不被 YAML 1.1 布尔规则改写；
   ③ Windows 上 Git `/` 与 DSH fs `\\` 路径比较统一为同一分隔符；④ parser 对
   `publication_ref: null`、非对象 front matter/`research.json` fail-closed 为诊断，
   不抛异常；init 目录创建失败返回结构化错误；⑤ `projectRevision` 严格按逐文件
   record hash 后再整体 hash 的公开公式计算。
4. 环境说明：本会话 pnpm 依赖安装需 full-access 沙箱（esbuild 生命周期脚本
   spawn 子进程）；安装本身对仓库无影响（node_modules/.pnpm-store 均被
   gitignore）。
5. 方案 B 精简后的一次性 DSH `0.1.1-rc.2` profile smoke（2026-08-29）通过：在仓库外
   disposable 项目中，SciFork bundle 正常启动，`commands/list` 发现 `/research`，
   `skill.list` 发现两个 SciFork Skills，`/research init` 生成基线（message
   `scifork: init`），`/research validate` 返回有效项目。公开 `ctx.tools` 注册服务
   随后执行 `research_graph_read` 与 `research_graph_apply`，创建单个 Result 并生成
   当前分支受管路径检查点。写入未经过模型 prompt（profile 无 API key）；历史恢复和
   检查点失败诊断仍由方案 B 的 Host 自动化测试覆盖。
6. 初始化与 mutation 的 Git 预检已补齐：非 Git 目录的 mutation 返回
   `GIT_UNAVAILABLE`；detached HEAD 在任何 `mkdir`/文件写入/commit
   前返回 `GIT_STATE_UNSUPPORTED`；unborn branch 仍可创建首次 `scifork: init`
   基线；全仓库 unmerged 与 managed path dirty 状态在写入前拒绝；初始化失败
   会保留文件并返回结构化失败。普通 mutation 的 checkpoint 只提交单个目标文件，
   写后快照不一致返回 `STALE_REVISION`，不做破坏性回滚。Locator 遇到最近的 malformed
   当前版本 `research.json` 时锚定项目并提供只读诊断，遇到非常规/不可读 marker
   仍 fail-closed；Git subprocess 输出标记为 lossy 时拒绝继续状态判断或提交。

## Test plan

- 单元：`tests/core/*.test.ts`（Vitest，node 环境，注入 SHA-256 哈希）。
- Host 单元/集成：`tests/host/*.test.ts`，用结构性 fake Fs/Subprocess/Storage
  端口驱动完整流水线，不做网络或真实 Git 依赖。命令初始化测试也通过现有
  `mkdirs` 替身隔离目录创建；禁止调用真实 `mkdirSync` 时，`/research init`
  仍须成功、向替身传入当前项目根，并在 fake Fs 中写入有效 manifest。
- 真实 Git 最小验证：`tests/host/git-real.test.ts` 在临时目录用系统 Git
  执行 init/checkpoint 的 argv 行为（无 Git 时自动跳过）。
- 冒烟：方案 B 精简后已执行一次性 DSH profile，验证工具/命令/Skill、初始化、校验与
  单实体检查点，并将结果写入本文档；不含真实模型 tool-call loop。

### 命令测试隔离回归（2026-09-04）

- Release CI 暴露命令 fixture 遗漏 `mkdirs` 替身，导致 fake 项目初始化尝试在
  真实文件系统创建目录。测试现以抛错替身禁止原生 `mkdirSync`，复现初始化
  返回 error 而非 success 的失败（Red）。
- 补齐现有 `mkdirs` 注入点并核对其项目根参数，保留全部原有断言；命令测试
  7 项与全量 391 项通过（Green）。不修改生产代码，不引入额外抽象。
- 本地验证：`corepack pnpm check`、入口语法、81 文件打包清单、`v0.0.1`
  发布预检及 `git diff --check` 均通过；未新增 DSH profile 冒烟。
