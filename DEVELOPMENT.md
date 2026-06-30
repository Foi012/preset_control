# Development

Dev/build notes for 生鱼片工具箱. For the user-facing overview, see [`README.md`](README.md).
The authoritative design spec for each tool lives in its own `DESIGN.md` — those are the source of
truth for behaviour and locked decisions:

- `src/features/preset-console/DESIGN.md` — 预设控制台
- `src/features/connection-profiles/DESIGN.md` — 连接档案
- `src/features/chat-export/DESIGN.md` — 聊天导出
- `src/features/story-memory/DESIGN.md` — 故事记忆 (**planned** — spec only, not yet built)

## Install location

SillyTavern clones the repo into:

```text
data/<user-handle>/extensions/preset_control/
```

The root `manifest.json` loads the built root bundle `index.js`.

## Build

```sh
pnpm install
pnpm build
```

## Checks

The repo uses no test runner — each pure/impure module has one assertion script instead:

```sh
pnpm check:parser            # 预设解析
pnpm check:config            # 配置读写与校验
pnpm check:preset-io         # 预设 I/O（Tavern Helper）
pnpm check:preset-io-native  # 预设 I/O（原生扩展）
pnpm check:store             # Pinia store
pnpm check:chat-normalize    # 聊天归一化
pnpm check:chat-extract      # 提取 / 排除规则
pnpm check:chat-scan         # 标签扫描
pnpm check:chat-st-regex     # ST 正则导入映射
pnpm check:chat-chapters     # 章节切分
pnpm check:chat-render       # XHTML 渲染
pnpm check:chat-style        # 排版样式（预设 + 自定义规则/CSS）
pnpm check:chat-epub         # EPUB 打包
pnpm check:conn-favorites    # 连接档案：机位收藏模型
pnpm check:conn-policy       # 连接档案：参数 apply plan
pnpm build
```

## Source layout

- `src/extension/preset-control/` — the shipped native SillyTavern extension entry.
- `src/features/preset-console/` — the preset console: parser, config, store, native ST adapter, and UI.
- `src/features/connection-profiles/` — 连接档案: favorites model, `/profile` gateway, param policy, UI.
- `src/features/chat-export/` — the chat-export workflow and parser / render / export checks.
- `src/features/story-memory/` — 故事记忆: **planned** (currently `DESIGN.md` only, no code yet).
- `src/shared/ui/` — the design system shared by all tools, imported via the `@/ui/*` alias.
- `src/legacy/tavern-helper/` — the older Tavern Helper iframe/script runtime; excluded from the native
  TS project and not the webpack entry.
- `src/env.d.ts` — app-wide SillyTavern global types.

## Implementation notes

- **EPUB packaging** uses a dependency-free store-method ZIP writer (`chat-export/epub.ts`, no JSZip):
  CRC32 + OCF layout, validated with `unzip` / `xmllint`.
- **Preset config storage** lives in `preset.extensions.presetEasyToggle` (the internal field name is a
  legacy key — renaming it would orphan existing users' saved configs), with a mirrored backup entry and
  a corruption guard.
