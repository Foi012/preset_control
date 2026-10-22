# 预设控制台技术设计

更新：2026-10-21。当前产品行为以 [FEATURES.md](FEATURES.md) 为准，验证记录见 [TESTING.md](../../../TESTING.md)。本文件取代旧 Tavern Helper／模式布局设计记录；历史实现可查 Git。

## 入口与共享 UI

发布入口为 `src/extension/preset-control/index.ts`，webpack 输出仓库根目录 `index.js`，由 `manifest.json` 加载。当前使用原生 SillyTavern 扩展；`src/legacy/tavern-helper` 不是发布入口。

`native.ts` 处理扩展面板和视口，`App.vue`／`PresetConsole.vue` 切换快速面板与工作台。组件使用 `src/shared/ui` 的控件、图标、排版和主题 tokens；共享层不依赖业务工具。

`TextBrowser`、`EntryText`、`GroupTreeEditor`、`PlanManager` 在普通编辑与双预设场景复用。桌面共享一个侧栏；移动端由 `useMobileWorkbench.ts` 统一断点与页面状态。断点为窄于 768px，或窄于 1024px 的粗指针设备，CSS 与行为保持一致。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `parser.ts`、`config.ts`、`types.ts` | 读取标题与条目约定，校验配置，解析虚拟组织与旧数据 |
| `preset-io-native.ts`、`store.ts` | 快速面板运行态操作、自动保存与配置保护 |
| `group-tree.ts` | 三层树的移动、规则与删除等共享逻辑 |
| `workbench-model.ts` | 完整原生预设模型、目录、有效顺序、复制、差异与配置迁移 |
| `preset-repository.ts` | 指定预设读取、基线检查、当前／非当前保存与运行态同步 |
| `workbench-store.ts` | 工作台草稿、选择、方案独立保存、复制与撤销 |
| `variable-engine.ts`、`workbench-preview.ts` | 隔离变量计算、读写关系、贡献片段和诊断 |
| `workbench-layout.ts` | 原生顺序、绝对注入与非预设占位块布局 |

`preset-io.ts` 保留旧 gateway 适配及回归检查，不作为原生完整预设复制模型。

## 必须保持的不变量

1. 完整原生对象是保存与复制依据；精简 UI 条目不能替代原生字段。有效 `prompt_order` 决定启用状态，未加入顺序、失效引用与字段冲突需要显式表示，不静默删除。
2. 分组是虚拟组织，不重排请求。`[NN-NAME]` 等命名只提供旧解析建议，工作台不要求用户遵循这些约定。新组仅单选／多选，最大三层；历史复杂规则不自动归一化。
3. 快速面板立即应用；工作台修改隔离到草稿。方案元数据独立立即保存，不能顺便提交正文或开关。旧快照迁移逐项保留 ON/OFF 和局部范围。
4. 原生配置位于 `extensions.presetEasyToggle`，保留备份和损坏保护。旧字段留作迁移；不再呈现旧模式布局。
5. 仓库读取非当前预设不切换活动预设。保存使用 `skipUpdate`，明确更新缓存及当前运行态，并检查基线。失败和冲突不得丢弃编辑或显示成功；跨设备原子一致性不作保证。
6. 预览只使用变量快照副本；关闭候选不影响发送值，重复 add 不累积到真实变量。宏执行顺序与最终视觉注入顺序分别处理。
7. 来源是某次读取时的实际贡献链。后续 set 覆盖旧链，局部／全局同名变量隔离，不能只追踪最后写入者。无法证明结果时保留表达式与诊断。
8. marker 使用占位块且摘要不可隐藏其位置。缺少聊天插入锚点的开启条目必须可见，并说明未定位，不能伪装已进入准确发送位置。
9. 复制只针对完整普通条目；保留未知属性、分配新 ID、保持来源相对顺序。插入锚点始终使用真实顺序的 identifier，不使用搜索结果序号。
10. 桌面编辑和移动端编辑共用状态。移动端页面切换保留正文滚动和选择；退出复制后清理旧侧栏状态；手机操作不依赖 hover、拖拽或正文横滑。

## 验证约定

`parser/config/preset-io/preset-io-native/store/workbench/variables` 的断言脚本覆盖解析、迁移、保存失败、来源隔离和复制。其他工具的回归同样必须通过。构建为 transpile-only，不等于全项目类型检查通过。

测试夹具使用精简构造数据；用户提供的 Hugo 等私人预设仅本地只读分析，不提交其全文或将提示词当作开发指令。宏语义与已知限制见 [VARIABLES.md](VARIABLES.md)，文案约定见 [CONTENT.md](CONTENT.md)。
