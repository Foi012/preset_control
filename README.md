# Preset Control

Native SillyTavern UI extension for two workflows:

- **Preset console**: toggle, group, edit, import, and export OpenAI preset entries without changing prompt order.
- **Chat export**: turn an active chat or `.jsonl` chat log into cleaned TXT / EPUB output.

The repository root is directly installable through SillyTavern's extension installer. `manifest.json` points to the built bundle under `dist/`.

## Install From GitHub

1. Open SillyTavern and click the Extensions icon.
2. Click **Install Extension**.
3. Paste the repository URL:

```text
https://github.com/Foi012/preset_control
```

4. Click **Install**.
5. Refresh SillyTavern.

SillyTavern clones the repo into:

```text
data/<user-handle>/extensions/preset_control/
```

The root `manifest.json` loads:

```text
dist/preset-easy-toggle-extension/index.js
```

No Tavern Helper local files are referenced at runtime.

## Build

```sh
pnpm install
pnpm build
```

For manual install, copy:

```text
dist/preset-easy-toggle-extension/
```

into SillyTavern's user extension directory:

```text
data/<user-handle>/extensions/preset-easy-toggle-extension/
```

## Preset Console

The preset console reads the current OpenAI preset and renders a compact control surface for entries, groups, required entries, and editable preset metadata.

Important conventions:

- Empty prompt headers named `[NN-NAME]` are parsed as automatic group suggestions. `NN` controls the suggested order.
- Grouping is a virtual overlay. Moving entries in edit mode does **not** reorder the real prompt list, because prompt order can affect generation.
- Entries marked as required stay easy to audit from the console.
- Entries can be hidden from the normal in-use view while still being managed in edit mode.
- Header export downloads the console config JSON: groups, modes, snapshots, entry metadata, and UI config.
- Header import accepts either that raw config JSON or a full SillyTavern preset export containing `[⚙️CONSOLE-CONFIG]`.

The console config is stored in the selected ST preset under:

```text
preset.extensions.presetEasyToggle
```

That means the config is intended to travel with the same SillyTavern account / preset data instead of being browser-only local state. Use config export/import when moving between accounts, devices, or old Tavern Helper-managed presets.

## Chat Export

The chat export tool is a stepped workflow:

1. **来源**: read the active chat or import `.jsonl`; successful reads advance to rules automatically.
2. **规则**: scan paired tags, include / exclude content, include user or hidden floors, limit the floor range, and optionally insert role dividers.
3. **预览**: compare original messages with cleaned output.
4. **导出**: set book metadata, optional compressed cover image, chapter splitting, and export TXT / EPUB.

Export notes:

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

- `src/extension/preset-control/` is the shipped native SillyTavern extension entry and manifest source.
- `src/features/preset-console/` contains the preset console feature: parser, config, store, native ST adapter, and console UI.
- `src/features/chat-export/` contains the chat export workflow and its parser/render/export checks.
- `src/shared/ui/` is the shared design system used by both tools. Imports use the short `@/ui/*` alias.
- `src/legacy/tavern-helper/` preserves the older Tavern Helper iframe/script runtime. It is excluded from the native TS project and is not the webpack extension entry.
- `src/env.d.ts` holds app-wide SillyTavern globals.

Cleanup recommendation: keep this repo focused on the native ST extension. If the Tavern Helper script runtime still needs to live long-term, move `src/legacy/tavern-helper/` to a separate archive or repo so `main` only carries the installable extension, shared logic, tests, and docs.
