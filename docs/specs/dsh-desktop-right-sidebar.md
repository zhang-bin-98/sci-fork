# SciFork DSH 桌面端右侧栏迁移

> 状态：Approved（设计定稿；implementation pending）
> 日期：2026-10-18
> 上位设计：[产品设计 v0.21](../scifork-product-design.md) §1/§3/§11/§13；
> [软件架构 v0.22](../scifork-software-architecture.md) §1/§2/§8/§9/§16 M4
> 同批次调整：[检索外置](./external-retrieval-skills.md)（正交，独立验收）
> 钉住版本：DeepSeek Harness 桌面端 `0.2.1-rc.2`（nightly）＝ 捆绑 DSH runtime
> `0.2.1-rc.2`（2026-10-17 本机安装实测：exe、`@deepseek-ai/dsh`、
> `dsh-client-ui-sidebar-right` 三者版本一致）
> 取代关系：本 spec 取代 [M2 Companion](./m2-companion.md) 中独立窗口表面、
> URL fragment Page Key 交换与 BroadcastChannel 提交通道相关条款；M2 其余行为
> （Main/Evidence 视图、Focus、Details、轮询、安全渲染）继续有效。

## Problem

DeepSeek 官方桌面端已发布：Electron 壳通过 `dsh-app://` 协议加载与 Web 完全
相同的 client bundle 与 Cordis 插件图，桌面与 dsh runtime 版本严格成对发布。
当前 SciFork 的独立浏览器窗口表面（`window.open` + URL fragment key 交换 +
跨窗口 BroadcastChannel 投递）是旧 DSH 没有内嵌表面时的产物；新版 DSH 提供
公开右侧栏扩展面（`sidebar.right`），第三方以最高优先级带 `extension` 注册。

迁移需要：把图谱迁入右侧栏 tab、删除独立窗口路径，同时保持安全模型（loopback、
精确同源、Page Key 能力边界）、科研模型（Core/Skills/Git 不变）和单一 client
bundle 契约不变，并处理桌面 nightly 自动更新带来的基线漂移。

## Goals

1. Graph 作为 DSH `sidebar.right` 的 page-type tab 渲染，桌面端与同版本 Web
   共用同一 bundle。
2. 删除独立窗口路径、`/research open` 命令与全部为跨窗口存在的机制。
3. Page Key 改为响应体铸造 + client 插件内存 + props 传递，不经 URL。
4. Research & Expand 改为 tab body 向同插件 Bridge 的进程内直接调用。
5. 基线钉住 `0.2.1-rc.2`；nightly 漂移以版本警告条暴露，重钉流程脚本化。
6. 布局按 tab pane 容器宽度响应，嵌入样式与 DSH 全局样式隔离。

## Non-goals

- 不保留独立浏览器窗口、OS 窗口或任何第二套页面表面；不做 iframe 嵌入。
- 不自建 pane 分割、浮出、全屏或窗口管理（全部由 DSH docking surface 提供）。
- 不改变 Core、三个工具、Git 检查点、`/scifork/api/*` API 契约与安全模型；检索
  外置（移除 `pubmed-search`、外部 provider 契约与降级阶梯）是同批次的独立调整，
  由[检索外置 spec](./external-retrieval-skills.md)单独规范。
- 不跟随 nightly 每版自动重验；不为未来 DSH 版本预留兼容层。
- 不在 SciFork 包内实现右侧栏 tab 之外的任何 DSH tab 类型。

## Confirmed decisions（2026-10-17/18 与用户逐条确认）

1. **彻底替换**：只保留右侧栏 tab；删除独立窗口与 `/research open`；入口为
   右栏 guide 卡片 + 左栏 footer action。
2. **直接 React 组件嵌入**：body 注册进 `sidebar.right.pane.tab`；
   `keepMounted: false`。
3. **平台范围**：桌面端 + 同版本 Web；基线 `0.2.1-rc.2`。
4. **扩展提交通道**：进程内直接调用；删除 BroadcastChannel、nonce 防重放窗口
   与异步 ack 超时。
5. **基线策略**：钉住 `0.2.1-rc.2`；桌面更新后版本进入未验证状态（警告条 +
   重钉流程），不 fail closed，不逐 nightly 重验。

## Behavioral contract

### 1. Tab 注册与入口

- client 插件在自己的 `ctx.effect` 内注册：
  - `ctx.sidebarRightTabs.register({ id: 'dsh-scifork', kind:
    'scifork.research-graph', title: () => 'Research Graph', guide: [{ id:
    'research-graph', order, title, description, icon }], keepMounted: false })`；
    page type（无 `patterns`、无 `multiple`），`priority` 省略取默认 `extension`。
  - `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-scifork' },
    Body)`。
- 左栏既有 `sidebar.footer.action`（`Research Graph`，展开标签 / 折叠图标 +
  `Open Research Graph` accessible name）点击后调用
  `ctx.sidebarRight.openTab('scifork.research-graph')`；guide 卡片由 DSH 以同
  kind 打开。不使用 `window.open`、私有 React 组件或 DOM 操作。
- 右侧栏表面按 Session 独立；无当前 Session 时无右侧栏，SciFork 不补偿、不
  另建表面。

### 2. 生命周期与 Page Key

```text
tab body 挂载
→ 向同插件 Bridge 请求 Page Key
→ Bridge POST /scifork/api/launch（当前 SessionId）
→ Host 校验 loopback socket、精确同源 Origin、精确 JSON Content-Type、body 上限
→ Host 创建 256-bit random Page Key，绑定 sessionId + project root
→ 响应体返回 { pageKey }（同源 loopback POST，瞬时）
→ Bridge 在 client 插件内存持有 key，经 props 传入 body
```

- 失效条件：Session 关闭、bundle 卸载、DSH 重启、tab body 卸载。
- `keepMounted: false`：隐藏、切换 Session、关闭 tab 即卸载 body 并失效 key；
  重开重新铸造，从 Host storage 恢复 Focus，视图回 Main + Details 默认打开。
- body 收到无效 key 时只显示重新打开提示。
- key 不进入 URL、query、fragment、sessionStorage、日志或仓库。

### 3. 数据与轮询

- API 不变：`snapshot` / `entity` / `focus`，POST + Page Key；Companion API
  仍不接受调用方提供 cwd、project root 或任意 sessionId。
- 轮询条件：`useTabInfo()` 的 `tab.visible` 为 true 且 document 可见时每 5 秒
  snapshot；任一为 false 暂停，恢复可见立即刷新。tab abort signal 仅在 tab 记录
  移除（关闭 tab）或插件卸载时触发，隐藏与切换 Session 保留记录不触发；挂起
  请求的清理由 body 卸载时的 effect cleanup 负责。

### 4. Research & Expand（进程内直接调用）

- 只有 body 内 `Research & Expand` 的真实点击 handler 能发起；tab 加载、轮询、
  模型输出不能触发。
- body 携带 Page Key 直接调用同插件 Bridge；Bridge 以 key 解析绑定的 Session
  scope 后执行 `conversation.input.for(scope).setDraft(prompt)` + `submit()`。
- 同步返回接受或拒绝；key 无效或 Session 已关闭返回
  `RESEARCH_EXPANSION_REJECTED`，body 显示 `Retry` 与 `Copy`。
- 完成语义不变：Bridge 观察捕获 Session running→idle 后复位按钮；idle 启动、
  busy 按 DSH Queue 排队。prompt 按瘦身契约构造：Focus id/摘要 + 目的约束 +
  检索先行指引 + 完整授权边界（最多五条、一层、Focus 不变、不递归、只创建
  machine-reviewed Evidence、禁 Finding）；工作流与格式细则由 `scifork-research`
  正文单一承载，提示不复述（消除 Skill 与提示两份真相）。

### 5. 布局与样式

- 响应式断点为作用在 tab pane 容器上的 container queries，数值沿用
  `sm=640px`、`md=768px`、`xl=1280px`；不监听视口宽度，不新增阈值。不得直接
  使用 Tailwind v4 容器变体的默认档位（`@sm/@md/@xl` = 384/448/576 px）：以
  `@min-[640px]` 等任意值变体实现，或在 `@theme` 覆盖 `--container-*`（注意
  连带影响 `max-w-*`），二选一由 spike 定。normal 窄面板通常处于 `<md`（TB 图 +
  Details 下方），全屏呈现处于宽区间（LR + Details 并列）；两种呈现共享内容树。
- body 填充 DSH 提供的 pane 盒模型；顶栏、Details 两行 header 与正文滚动边界
  按架构 §8.4，无 `100dvh` 或视口级假设。
- 样式交付：构建把 CSS 内联进 client bundle、挂载时注入 `<style>`
  （documentpreview 的 JS-only 发布形态），Host 不注册静态样式路由。
- 样式隔离：不包含 Tailwind Preflight（当前源码本就未引入，仅分开导入
  theme/utilities）；工具类经 v4 官方隔离手段限定在 SciFork 容器根（如
  `.scifork-root`）内——整包 `@import 'tailwindcss' prefix(sf)` 或部分导入 +
  `variant()` 作用域变体，二选一（已知坑：`prefix()` 对分开导入的
  `utilities.css`/`theme.css` 不生效），以 spike 实测为准；手写 base 归一化
  （原 `:root`/`html, body` 规则）改挂容器根选择器；React Flow、Markdown
  pseudo-element、卡片展开的手写 CSS 同样以容器为作用域。

### 6. 版本守卫

- Host 启动时读取运行时 DSH 版本（公开面，spike 钉住具体途径），与钉住的
  `0.2.1-rc.2` 比对。
- 不符时 Companion 顶栏显示 `Unverified DSH version: <ver>` 警告条；不 fail
  closed、不阻断读写（版本差异是兼容性风险，不是安全边界）。

### 7. 删除清单

- `/scifork` SPA 入口与 `/scifork/*` 静态资源路由、`scripts/build-companion.mjs`、
  `dist/companion/` 产物与打包清单条目。
- `/research open` 人类命令。
- BroadcastChannel 监听、nonce FIFO、异步 ack 与超时、URL fragment /
  sessionStorage key 交换、`about:blank` 同步开窗。

## Constraints and interfaces

- 钉住契约（`0.2.1-rc.2`；右侧栏三件与 footer action 已在本机安装构建中验证
  存在，精确签名由 spike 补齐并回写契约声明）：
  - `ctx.sidebarRightTabs.register(SidebarRightTabDefinition)`
  - `ctx.slots.register({ name: 'sidebar.right.pane.tab', key }, Body)` 与
    `useTabInfo()`
  - `ctx.sidebarRight.openTab(kind, options?)`
  - `sidebar.footer.action`（master 契约 `packages/client/ui-sidebar/src/client/
    contract/slots.ts` 确认仍在：root list slot，owner props 仅 `wide`，
    `wide=false` 为 56 px rail）
  - `SessionInput` 冻结面与 `SessionInputResolver.for(actx)`（master
    `packages/client/ui-conversation/src/client/contract/input.ts` 确认仍在：
    `setDraft(text: string)` / `submit(mode?)` / `notify` / `state`）
  - `dsh.client` 声明（`platform: 'web'`、`inject` 包名边、`exports["./client"]`）；
    接入右侧栏需在 `inject` 声明 `@deepseek-ai/dsh-client-ui-sidebar-right`
    （factory 到达边；参照 documentpreview 的 inject 清单确定最小集合）
  - M0 全部既有契约（webServer、subprocess、skills、sandboxPolicy、
    client module 装载）在新版本上重钉；client 装载机制已从 M0 钉住的
    单 classic script 演化为 `__DSH_BOOT__` 图 + `/plugins` combo scripts +
    lazy-CJS 模块表，`__ModuleLoader__.load` 形状以 spike 实测为准。
- 单 client bundle：Bridge 与 Companion 组件由 `scripts/build-client.mjs` 打包
  进 `dist/client.js`（classic script，shell 播种 React/Cordis 基线模块）。构建
  开启 minify；React/React-DOM 等 shell 播种模块声明为 external，不重复打包
  （当前 companion app bundle 约 622 KB 且携带 React，迁移后消除）。
- 安全边界沿用架构 §12.2 修订版：loopback-only、精确同源（桌面 `dsh-app://`
  Origin 语义由 spike 钉住，不满足即 fail closed）、Page Key 只在 Host 内存、
  launch 响应体与 client 插件内存出现、Host 无静态路由。
- 不新增生产依赖；`@xyflow/react`、`react-markdown`、`@dagrejs/dagre` 必须与
  shell 播种的 React 版本兼容（spike 钉住；不满足即停下与用户重评）。

## Spike plan（M4 前置；一次性 profile 冒烟需用户批准）

**Web 冒烟结果（2026-10-18，用户批准；disposable `E:/scifork-smoke-home` + 捆绑 0.2.1-rc.2 CLI，验证后清理）**：

- 安装/引导：tarball 经 CLI 装入一次性 profile；干净 profile 秒起。**发现并修复两个真实缺陷**：① `@deepseek-ai/cordis` 误为 devDependency，profile 内无法解析，已移入 dependencies；② `webServer` 由 web app 在引导后创建，硬 inject 死锁引导，已改为 `ctx.inject(['webServer'])` 运行时等待（dsh-client-modules 同款）。修复后带插件引导正常。
- API：403（无 Origin）/ SESSION_UNAVAILABLE（正确 Origin + 无会话）/ 415 / 401 / 404（旧 SPA 入口）全部符合契约。
- GUI：footer action 渲染并可点击；guide 卡片（标题+描述）渲染；Research Graph tab 打开、body 挂载、无会话时正确进入 unavailable 态。
- CSS：`style[data-scifork]` 注入（42 KB），三条 `@container (min-width: 640/768/1280px)` 全部生效。
- Boot 图含 `dsh-scifork`；`__DSH_BOOT__.release.version === "0.2.1-rc.2"`——**版本守卫读取面钉住**。
- HMR：修改已安装 bundle 后 stat-poll 自动换载（标记样式出现、旧样式清理、页面无 reload）——esbuild 单文件产物可被官方 HMR 检测，开发主循环成立。
- 桌面实测（2026-10-18，真实 desktop profile + 一次性诊断包：client 引导时自动
  探针 launch、Host 记录请求面；测毕卸载并恢复 profile，与备份逐字节一致）：渲染
  进程 loopback fetch 的 `Host` 正确、**不携带 `Origin` 头**。据此
  `isAllowedJsonRequest` 放行"Origin 缺失 + 其余校验不变"，浏览器错误 `Origin`
  仍 403。
- 未决：shell React 精确版本未直接读取（documentpreview 以 react ^18.2 编译，推断
  18.x，本包依赖均兼容 18/19，非阻塞）。

原计划项：

1. 桌面端（disposable desktop profile；完全退出应用后经 CLI 安装、验证后恢复）：
   - `dsh-app://` 渲染进程 fetch `/scifork/api/*` 的实际 Origin/Host；同源校验
     原样成立或确定桌面特定行为（不允许放宽校验迁就）。预期结果：桌面转发器
     Origin 为固定值，实测后加入精确允许集合；Web 保持 Origin 与 Host 精确一致。
   - client bundle 装载、tab 类型注册、guide 卡片、footer action → `openTab`、
     `keepMounted: false` 卸载/重挂行为。
   - Tailwind v4 隔离方案实测：整包 `prefix(sf)` 与部分导入 + `variant()` 作用域
     二选一，验证零泄漏且不被宿主样式命中；容器查询档位（`@min-[...]` 任意值
     变体或 `--container-*` 覆盖）同场验证。
   - shell 播种的 React 版本；`@xyflow/react` / `react-markdown` / `@dagrejs/dagre`
     在该 React 下的运行验证。初步证据：官方范例 documentpreview 以
     `react ^18.2.0` devDependency 编译，shell 播种 React 大概率为 18.x，
     与本仓库 devDeps 的 React 19 需要对齐评估。
   - Host 读取运行时 DSH 版本的公开面。候选：client boot 图的
     `WebBootGraph.release.version`（Host release identity，含 version 与
     可选 commit）；Host 侧等价面由 spike 确认。
2. 同版本 Web（优先用桌面捆绑 CLI `resources/runtime/cli/bin/dsh.cmd` 起一次性
   profile；不可独立运行则按钉住版本 npm 安装）：
   - 同一清单回归；浏览器环境同源与轮询行为。
   - 开发迭代（HMR）链路：重建 `dist/client.js` 后 `dsh-client-hmr` 的 stat-poll
     能否检测 esbuild 单文件产物（对照 tsdown shared preset 的 stamp 约定）并
     自动换载；换载期间 session 布局中已打开的 SciFork tab 在 kind 重注册后由
     新 body 接管；Host 侧代码重建后的模块新鲜度（必要时经 HMR 开关重新启用
     插件）。桌面端无 SSE 热重载路径且配置改动要求退出应用，因此 Web 是开发
     主循环，桌面端做里程碑验证。
3. 结果回写本 spec 与 `src/host/contracts.ts`（及 client 侧契约声明）；可脚本化
   的冒烟步骤（版本读取、config 计数、路由探活、契约探针）沉淀为脚本，GUI 部分
   保留人工清单。

## Acceptance criteria

- [ ] Spike 全部项钉住并记录；契约差异回写 spec 与契约声明。
- [ ] 桌面端 disposable profile E2E 通过架构 §15.4 清单；同版本 Web profile
      回归通过。
- [ ] guide 卡片与 footer action 均可打开 Research Graph tab；仓库内无
      `window.open` 路径残留。
- [ ] key 生命周期（铸造/失效/重开恢复 Focus）、`tab.visible` 轮询暂停恢复、
      未验证版本警告条按契约工作。
- [ ] Research & Expand 直接调用全流程：idle 启动、busy 排队、同步拒绝显示
      Retry/Copy、running→idle 复位。
- [ ] 容器断点两侧布局符合 §8.4；嵌入样式不影响 DSH 全局（产物无 Preflight、
      作用域断言）。
- [ ] `pnpm check` 全绿；`pnpm pack --dry-run` 清单不再含 `dist/companion/`；
      `pnpm verify:source` 通过。
- [ ] 实现落地时 README/AGENTS.md 状态描述同步更新。

## Test plan

- 单元/集成（Vitest，node 环境）：
  - tab 注册参数（id/kind/guide/keepMounted）、footer action 联动 `openTab`
    （mock registry/slot 面）。
  - key 生命周期状态机：铸造、卸载失效、重开重铸。
  - 轮询联合可见性条件与 abort。
  - 直接调用提交：接受、无效 key、Session 关闭；Retry/Copy 数据。
  - 版本比对与警告条数据。
  - 构建产物断言：单一 client bundle、无 Preflight、utilities 作用域。
- 组件级（jsdom / container 宽度注入）：`sm/md/xl` 断点两侧的 TB/LR 与 Details
  bottom/side 切换、顶栏单行、正文内部滚动。
- E2E：架构 §15.4（desktop 主、同版本 web 回归），一次性 profile + 用户批准。
