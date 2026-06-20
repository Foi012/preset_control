# 预设控制台 · Preset Control

Native SillyTavern extension for two workflows:

- **Preset console**: turn a flat chat-completion preset into a compact floating console for toggling, grouping, editing, importing, and exporting entries without changing prompt order.
- **Chat export**: turn an active chat or `.jsonl` chat log into cleaned TXT / EPUB output.

## 功能

- 可拖拽的浮动工具箱：打开预设控制台或聊天导出工具。
- 规则感知的预设开关：单选、多选、始终开启、文本输入会自动使用合适控件。
- 虚拟分组：`[NN-NAME]` 空提示词会作为自动分组建议，`NN` 控制建议顺序；编辑模式中的移动不会重排真实 prompt list。
- 模式与快照：保存一组开关状态并一键应用。
- 随预设携带：配置保存在 `preset.extensions.presetEasyToggle`，应跟随同一个 ST account / preset data，而不是只存在浏览器本地。
- 聊天导出：扫描标签、包含 / 排除内容、限制楼层范围、角色分隔线、封面压缩、章节切分、TXT / EPUB 导出。

## Install

1. In SillyTavern, open **Extensions** and click **Install Extension**.
2. Paste the repository URL:

```text
https://github.com/Foi012/preset_control
```

3. Click **Install**, then refresh SillyTavern.

SillyTavern clones this repo into:

```text
data/<user-handle>/extensions/preset_control/
```

The root `manifest.json` loads the built root bundle:

```text
index.js
```

## Build

```sh
pnpm install
pnpm build
```

## Preset Console Notes

- Empty prompt headers named `[NN-NAME]` are parsed as automatic group suggestions.
- Grouping is a virtual overlay. The preset prompt order is not rewritten, because prompt order can affect generation.
- Header export downloads the console config JSON: groups, modes, snapshots, entry metadata, and UI config.
- Header import accepts either that raw config JSON or a full SillyTavern preset export containing `[⚙️CONSOLE-CONFIG]`.
- Use config export/import when moving between accounts, devices, or old Tavern Helper-managed presets.

## Chat Export Notes

1. **来源**: read the active chat or import `.jsonl`; successful reads advance to rules automatically.
2. **规则**: scan paired tags, include / exclude content, include user or hidden floors, limit floor range, and optionally insert role dividers.
3. **预览**: compare original messages with cleaned output.
4. **导出**: set book metadata, optional compressed cover image, chapter splitting, and export TXT / EPUB.

Export details:

- The tag scanner routes each discovered tag to one destination: 不处理, 排除, or 包含.
- Title and body rules can use a tag name or regex.
- Floor range is applied after the include-user / include-hidden filters.
- Consecutive messages from the same role are kept together; the optional role divider is inserted only when the role changes.
- Cover uploads are compressed in-browser before being embedded into EPUB.

## Checks

```sh
pnpm check:parser
pnpm check:config
pnpm check:preset-io
pnpm check:preset-io-native
pnpm check:store
pnpm check:chat-normalize
pnpm check:chat-extract
pnpm check:chat-scan
pnpm check:chat-chapters
pnpm check:chat-render
pnpm check:chat-epub
pnpm build
```

## Source Layout

- `src/extension/preset-control/` is the shipped native SillyTavern extension entry.
- `src/features/preset-console/` contains the preset console feature: parser, config, store, native ST adapter, and console UI.
- `src/features/chat-export/` contains the chat export workflow and parser/render/export checks.
- `src/shared/ui/` is the shared design system used by both tools. Imports use the short `@/ui/*` alias.
- `src/legacy/tavern-helper/` preserves the older Tavern Helper iframe/script runtime. It is excluded from the native TS project and is not the webpack entry.
- `src/env.d.ts` holds app-wide SillyTavern globals.
