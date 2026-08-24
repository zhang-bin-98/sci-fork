# SciFork M0 Compatibility Spike

> 状态：Complete；implementation and browser GUI verified
> 日期：2026-08-24
> 上位设计：[软件架构 v0.12](../scifork-software-architecture.md) §16 M0
> 钉住版本：DeepSeek Harness `0.1.1-rc.2`（一次性 profile 实测）

## Problem

架构 §2 的 DSH 集成基线是设计假设，未经验证。M0 必须在开始 Core、Companion
和 Skill 实现之前，钉住本机 DSH 0.1.1-rc.2 的精确公开契约，并证明单 bundle
可加载/卸载。

## Goals

1. 钉住六个 M0 契约的精确签名与语义，记录与架构假设的差异。
2. 搭好 v0.12 §14 要求的单 package 工具链：pnpm、TypeScript strict、Vitest。
3. 编写最小 spike 代码，在真实 DSH 中行使每个契约。
4. 用一次性 profile 冒烟测试验证，并记录结果。

## Non-goals

- 不实现 Core 实体、三个工具、Companion 页面、Page Key、一步恢复（M1/M2）。
- 不注册任何模型工具，不注册人类命令。
- 不在本仓库运行生产 profile 冒烟；冒烟只针对一次性 profile 且需用户批准。
- 不引入架构 §14 之外的运行时依赖（M0 零生产依赖）。

## Pinned contracts (0.1.1-rc.2)

来源路径省略公共前缀
`…\@deepseek-ai\dsh\node_modules\@deepseek-ai\`，行号为本地 .d.ts 行号。

### 1. Bundle 装载与 cordis.patch.yml

- `package.json#dsh.bundle.patch` 指向 `cordis.patch.yml`，内容是
  `- insert: [{ id, name }]` 行。`dsh plugin --profile web add .` 安装本地包。
- 插件入口由包 `main`/`exports["."]` 解析，导出 `name` 与 `apply(ctx)`。
- `dsh --profile <name> --dump-config` 应恰好包含一个 `scifork` loader 行。

### 2. `ctx.webServer` 路由与 disposer

`dsh-host-webserver/lib/types/index.d.ts`（WebServer 类）：

```ts
type WebRouteKind = 'exact' | 'prefix'
interface WebRoute {
  kind: WebRouteKind
  path: string        // 绝对 pathname，无尾斜杠
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
register(route: WebRoute): () => void   // 同 (kind, path) 重复注册抛错；返回 disposer
readonly host: '127.0.0.1' | '0.0.0.0'
```

获取方式：spike 中以 `inject: ['skills', 'webServer', 'subprocess']` 声明
硬依赖，Cordis 在服务就绪后激活 fiber；`ctx.webServer` 直接访问。
所有注册经 `ctx.effect` 挂在插件 fiber 上，卸载时由 disposer 移除。
Host 只在 `webServer.host === '127.0.0.1'` 时激活。

### 3. `shell.overlay` Open action（Client Slot）

`dsh-client-runtime/lib/types/client/slots.d.ts`：`ctx.slots.register`
是 `SlotCore.register` 的 typed face。list slot 注册形态（
`dsh-cordis-client-runner/lib/client.js` 内联示例）：

```ts
ctx.slots.register(
  { name: 'shell.overlay', id: '<id>', order: <number>, label: '<label>' },
  () => React.createElement(...),   // 第二个参数是组件工厂
)
```

`shell.overlay` 是 `{ kind: 'list'; scope: 'root' }` 的 root 级 slot，additive，
点穿直到条目自行接收指针事件（`dsh-client-ui-layout/lib/types/client/index.d.ts`
67-80）。root 级 occupant 收到 `GlobalStandardProps`（`useSessions` 等）。

### 4. scoped `SessionInput.setDraft + submit`

`dsh-client-ui-conversation/lib/types/client/input/contract.d.ts` 与
`…/client/service.d.ts`：

```ts
interface SessionInput {
  setDraft(text: string): void
  submit(mode?: InputSubmitMode): void   // 空闲启动、运行中按 DSH Queue 模式排队
  notify(level: 'info' | 'error', text: string): void
  readonly state: SnapshotStore<InputState>
}
interface SessionInputResolver { for(actx: ClientContext): SessionInput }
interface IConversation { readonly input: SessionInputResolver /* + send/cancel/… */ }
```

- 服务名：client 侧 `ctx.conversation`（`conversation` 为 root singleton）。
- 当前 Session：`ctx.sessions.list.getSnapshot().current: SessionId | undefined`
  （`dsh-client-runtime/…/contract/sessions.d.ts` 21-22、service.d.ts 67-72）。
- Session scope：`ctx.sessions.scope(id): AgentContext | undefined`，然后
  `ctx.conversation.input.for(actx)`。
- Simulate 只能在真实点击 handler 内调用 setDraft+submit。

### 5. 两个 packaged Skill 的发现与顺序加载

`dsh-skill/lib/types/index.d.ts`（SkillRegistry，259 行）：

```ts
register(skill: SkillRegistration): () => void
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  readonly invocation?: SkillInvocationPolicy
  readonly provider?: string
}
// SkillDefinition 需含：name（kebab-case）、description、content、
// source（'runtime' 等）、可选 whenToUse/path/metadata/resourceBase
```

- 文件系统 provider 不扫描 npm 包；插件包内 Skill 必须在 `apply()` 里逐条
  `ctx.skills.register(...)`（source `'runtime'`）。
- `ctx.skills.list()`/`get(name)` 验证发现；大模型按 name 顺序加载两个 Skill
  （`scifork-research`、`pubmed-search`）。
- 获取方式：`inject: ['skills']` 硬依赖，`ctx.skills.register(...)` 直接访问。

### 6. argv-only Git（`ctx.subprocess`）

`dsh-subprocess/lib/types/types.d.ts`：

```ts
interface SubprocessSpawnSpec {
  argv: readonly string[]      // argv[0] 为程序，从不 shell 解释
  cwd: string
  stdio: SubprocessStdio       // stdin/stdout/stderr 显式声明，无默认值
  graceMs: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}
// stdout/stderr 可用 SubprocessCollect { maxBytes }，settle 后经
// handle.collected.stdout?.readFrom(offset) 读，handle.done: Promise<SubprocessOutcome>
// resolveExecutable(command, env?, signal?): Promise<string> 解析裸名/绝对路径
```

获取方式：目标 DSH Web profile 以 `inject: ['subprocess']` 声明硬依赖，
激活后通过 `ctx.get('subprocess')` 取得。M0 只运行
`git rev-parse --show-toplevel`（argv 数组，无 `-c`、无 shell 字符串），并以
`/scifork/api/spike` 的 200 结果证明真实 DSH subprocess 的
resolve/spawn/collect 路径已被行使；响应不包含本地路径。

### 7. 补充钉住（后续里程碑直接使用）

- `dsh.client` 声明：`package.json#dsh.client` 接受 `platform`（必填 string）、
  `inject`/`external`（可选 string[]）、`immediately`（可选 boolean）；仅
  `platform === 'web'` 时编入 boot graph。`exports["./client"]` 必须解析到已构建
  bundle。client bundle 是 classic script：
  `window.__ModuleLoader__.load({ id, factory: (require) => { …; return module.exports } })`，
  React/Cordis 等 baseline 模块由 shell 播种，无需声明。
- Host 工具执行上下文：`exec.agent.id`（SessionId）、
  `exec.agent.session.header.cwd`（string | undefined）。
- Skill 读取 scope：`scopeOf(exec.agent?.ctx)` 作为 `SkillViewOptions.scope`。

## Behavioral contract（spike 代码）

1. Host 插件把 `skills`、`webServer` 与 `subprocess` 声明为硬依赖
   （`inject`），Cordis 在服务就绪后激活 fiber、服务更新后重新激活；所有注册都经
   `ctx.effect` 挂 fiber，卸载清理。目标 profile 是 DSH Web（三者恒有）。
   Host 只在 `webServer.host === '127.0.0.1'` 时激活；`0.0.0.0` fail closed。
2. 注册 `GET /scifork/api/spike`（exact）；它通过真实 DSH subprocess 对
   package checkout 运行 Git probe，成功后返回固定 JSON `{ok:true, stage:'m0'}`，
   Git 不可用或 probe 失败时返回不含本地路径的稳定 503 错误。
   注册 `POST /scifork/api/launch`（exact）校验 Host 为 loopback、socket remote
   address 为 loopback，且 Origin 必须与 Host 精确同源；Content-Type 必须精确为
   大小写不敏感的 `application/json`（可带参数）。64 KiB 体积上限超限时
   返回 413 JSON 后再关闭/丢弃请求体，不先销毁 socket。成功返回
   `{url:'/scifork/'}`。重复 (kind,path) 由 DSH 抛错，spike 不自行容错。
3. 两个 Skill 从包内 `skills/<name>/SKILL.md` 读取正文，apply 时注册；
   卸载时 disposer 移除注册。读取失败只抛稳定的 skill-name 错误，不暴露
   package 或本地绝对路径。
4. `gitShowToplevel` 只构造 argv 数组（`['git','rev-parse','--show-toplevel']`），
   用 collect 模式读 stdout，非零退出、输出不唯一或路径不是绝对路径时返回 undefined。
5. Client 在 `shell.overlay` 注册两个 spike 条目（真实按钮）：
   - `Open Research Graph`：点击后 POST `/scifork/api/launch`（携带当前
     SessionId）并 `window.open` 返回的 URL；
   - `SciFork Spike: Simulate`：点击后经
     `ctx.sessions.scope(current)` → `ctx.conversation.input.for(actx)`
     执行 `setDraft(...)` + `submit()`。仅 click handler 触发，无任何
     加载/轮询路径调用。

## Constraints

- Core 目录在 M0 为空（架构 §6 要求 Core 纯 TypeScript；M0 无 Core 逻辑）。
- Host 适配层可 import `node:` 模块；客户端不得 import `node:`。
- `@deepseek-ai/cordis@^4.0.1` 仅作 devDependency（类型用），M0 生产依赖为零。
- 其余 DSH 类型以 `src/host/contracts.ts` 结构化声明钉住，注释标注来源路径。

## Acceptance criteria

- [x] `pnpm check`（typecheck + 46 项 Vitest + build）全绿；
      `node --check index.js` 与 `git diff --check` 干净。
- [x] clean checkout 的 `pnpm pack --dry-run` 会先构建，且 `dist/host`、
      `dist/client.js`、两个 SKILL.md 进入发布文件列表。
- [x] 单元/路由集成测试覆盖：argv 构造与拒绝、`rev-parse` 绝对路径解析、
      Skill 目录加载与无路径错误、路由路径守卫、fail-closed WebServer host、
      exact same-origin + socket loopback、精确 JSON Content-Type、超限请求的 413 JSON。
- [x] 一次性 profile 冒烟（2026-08-24 获用户批准）：
      `dsh plugin --profile scifork-m0-smoke add .`、
      `--dump-config` 恰好一个 `scifork` 行；spike/launch 路由行为全部符合预期；
      `GET /spike` 200 证明真实 Git subprocess probe；client row 进入 boot graph 且
      bundle 端点 200；运行中卸载/重载无残留注册。
- [x] 浏览器 GUI 交互验证：shell.overlay 出现两个按钮、两个 Skill 在
      catalog 中可顺序加载、Simulate 按钮把文本写入对应 Session 并提交。
- [x] 本文件记录最终冒烟结果与全部契约差异。

## Final automated and runtime smoke results（2026-08-24）

1. `pnpm check` 全绿：5 个测试文件、46 项测试通过；Host 与 Client 均完成构建。
   `node --check index.js`、`git diff --check` 通过。
2. clean archive 的 `pnpm pack --dry-run` 自动执行 `prepack`，发布清单包含
   `dist/client.js`、全部 `dist/host`/`dist/shared` 文件和两个 SKILL.md。
3. 一次性 profile 固定使用 DSH `0.1.1-rc.2`；本地 package link 装入后，
   `--dump-config` 只有一个 `scifork`，boot graph 只有一个 `dsh-scifork`
   client entry，Client bundle 为 200（3399 字节）。
4. 真实 HTTP 与 Git：`GET /scifork/api/spike` 通过 DSH subprocess 执行
   `git rev-parse --show-toplevel` 后返回 200 `{"ok":true,"stage":"m0"}`；
   valid launch 为 200；缺失或错配 Origin 为 403；大小写 JSON 为 200；
   `application/jsonp` 为 415；缺 sessionId 为 400；超限 body 返回完整 413 JSON，
   连接未被提前 reset。
5. DSH 公开 `session.create` + `skill.list` 返回恰好两个 SciFork runtime Skill，
   catalog 顺序为 `pubmed-search`、`scifork-research`，均为 model-invocable。
6. 公开 profile HMR 热禁用时，inventory 为 `enabled:false`/`fiberPhase:null`，
   spike 为 404、Client entry 为 0、SciFork Skill 为 0；恢复后 inventory 为
   `enabled:true`/`active`，对应计数恢复为 200、1、2。profile patch 已恢复原始 `[]`。
7. CLI 卸载后 dependency/bundle/config 均为 0，重启后 spike 为 404 且无 Client；
   重新安装后 config 和 Client entry 均恰好为 1，spike 与 bundle 恢复 200。
8. Codex 支持的 Windows 与内置浏览器控制器均在连接页面前因桌面沙箱初始化失败
   退出；用户随后在实际浏览器 GUI 中确认两个 overlay 按钮可见、普通 Session 的
   `/` catalog 可发现并顺序提交 `pubmed-search` 与 `scifork-research`，且 Simulate
   将固定文本提交到所选的同一 Session。只读 `session.list`/`session.history` 亦确认
   固定文本已进入该普通 Session。验证完成后一次性 profile 已停止并删除。

## Superseded initial findings

以下为首次 spike 暴露的问题；当前契约与结果以上文 Behavioral contract 和 Final
smoke results 为准。

1. 服务就绪顺序最初只注入 `skills`/`webServer`；最终 hard inject 为
   `skills`、`webServer`、`subprocess`，并对非 `127.0.0.1` listener fail closed。
2. Client bundle 最初未进入 boot graph；导出 `./package.json` 后，
   client-modules 可读取 package metadata。
3. Origin 最初只验证“存在时为 loopback”；最终要求 mandatory exact HTTP
   Origin/Host、numeric loopback socket，并精确验证 JSON media type。
4. 超限 body 最初在响应前 destroy socket；最终会有界排空并返回 413 JSON。
5. 缺失 Skill 的原始读取错误会泄露安装路径，Git parser 会接受相对路径；
   最终均 fail closed，并返回稳定、无路径错误。
6. clean archive 最初不会生成 `dist/`；新增 `prepack` 后可独立构建发布清单。

## Test plan

- 单元：`tests/host/*.test.ts` 与 `tests/bridge/*.test.ts`（Vitest，node 环境）。
- 路由集成：使用临时 loopback HTTP server 执行完整 handler，覆盖响应状态、
  Content-Type 和超限 body，不只测 pure helper。
- 冒烟：一次性 DSH profile，手动/脚本化验证上述清单，结果写入本文档。

## 与架构假设的差异（截止 2026-08-24）

| 架构假设 | 实际契约 |
| --- | --- |
| `ctx.storageDomain` 直接保存 focus | 需 `open(defineDomain({name,version,tables}))`，zod schema（M1 再用） |
| `conversation.input.for(scope)` | client 服务 `ctx.conversation.input`，`for(actx: ClientContext)`，actx 由 `ctx.sessions.scope(id)` 取得 |
| `shell.overlay` 注册 additive action | 是 root 级 list Slot，`ctx.slots.register({name,id,order,label}, factory)` |
| 两个 Skill 由 `ctx.skills` 贡献 | `apply()` 内逐条 `ctx.skills.register`，文件系统 provider 不扫描 npm 包 |
| `ctx.subprocess` 调 Git | `resolveExecutable` + `spawn({argv,cwd,stdio,graceMs})`，collect 模式读输出 |
