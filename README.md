# Preset Control

Native SillyTavern UI extension port of `preset-easy-toggle`.

## Build

```sh
pnpm build
```

The repository root is directly installable through SillyTavern's extension installer.
`manifest.json` at the root points to the built bundle under `dist/`.

## Install From GitHub

1. 打开 SillyTavern，点击顶部的 扩展 (Extensions) 图标。
2. 点击 "Install Extension" (安装扩展)。
3. 粘贴仓库地址：

```text
https://github.com/Foi012/preset_control
```

4. 点击 "Install"。
5. 刷新网页即可生效。

SillyTavern will clone this repository into:

```text
data/<user-handle>/extensions/preset_control/
```

The root `manifest.json` loads the bundled extension from:

```text
dist/preset-easy-toggle-extension/index.js
```

No Tavern Helper local files are referenced at runtime.

## Manual Install

For manual install, copy the emitted extension folder:

```text
dist/preset-easy-toggle-extension/
```

Copy that folder into SillyTavern's user extension directory:

```text
data/<user-handle>/extensions/preset-easy-toggle-extension/
```

## Checks

```sh
pnpm check:parser
pnpm check:config
pnpm check:preset-io
pnpm check:preset-io-native
pnpm check:store
```

## Native Port Notes

- `src/preset-easy-toggle/` is the shared parser/config/store/UI copied from the Tavern Helper prototype.
- `src/preset-easy-toggle/preset-io-native.ts` adapts native SillyTavern OpenAI presets to the existing `PresetGateway`.
- Prompt definitions come from `chatCompletionSettings.prompts`; enabled state and order come from OpenAI `prompt_order`.
- The console config is stored in `preset.extensions.presetEasyToggle`, surfaced to the existing config reader as virtual config entries.
- `src/preset-easy-toggle/native.ts` mounts the app into a Shadow DOM host and keeps the existing draggable trigger/panel behavior.
- Header export downloads only the console config JSON: groups, modes, snapshots, entry metadata, and UI config.
- Header import accepts either that raw config JSON or a full SillyTavern preset export containing `[⚙️CONSOLE-CONFIG]`.
