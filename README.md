# Preset Control

Native SillyTavern UI extension for toggling and arranging preset prompt entries
(port of the `preset-easy-toggle` Tavern Helper script).

## Repo layout

The **repository root is the installable extension** (same model as most native
ST extensions, e.g. Titania Theater): SillyTavern clones this repo into
`extensions/third-party/` and loads `manifest.json` → `index.js` directly. There
is no build step on ST's side, so the built `index.js` is committed.

```
manifest.json            # extension manifest, "js": "index.js"
index.js                 # built bundle (committed; produced by `pnpm build`)
src/preset-easy-toggle/  # source: Vue UI + Pinia store + native mount entry
  native.ts              # webpack entry — mounts the floating console
  App.vue, components/   # UI
  store.ts, parser.ts, config.ts, preset-io-native.ts …
  DESIGN.md              # design spec / decision log
  *.check.ts             # ad-hoc dev assertions (not shipped)
webpack.config.js        # bundles src/preset-easy-toggle/native.ts → ./index.js
```

## Build

```sh
pnpm build        # production → ./index.js
pnpm build:dev    # development build
```

The build emits a single ESM bundle (`index.js`) at the repo root with CSS
inlined. Commit the rebuilt `index.js` so installs pick up the change.

## Install from GitHub

1. In SillyTavern, open **Extensions** → **Install Extension**.
2. Paste the repository URL:

   ```text
   https://github.com/Foi012/preset_control
   ```

3. Click **Install**, then refresh the page.

SillyTavern clones the repo and loads the root `manifest.json`, which points at
the committed `index.js`.

## Manual install

Copy the whole repository folder into your user extensions directory:

```text
data/<user-handle>/extensions/preset_control/
```

(Only `manifest.json` and `index.js` are needed at runtime; the rest is source.)

## Checks

```sh
pnpm check:parser
pnpm check:config
pnpm check:preset-io
pnpm check:preset-io-native
pnpm check:store
```

## Native port notes

- `src/preset-easy-toggle/` is the shared parser/config/store/UI carried over from the Tavern Helper prototype.
- `src/preset-easy-toggle/preset-io-native.ts` adapts native SillyTavern OpenAI presets to the existing `PresetGateway`.
- Prompt definitions come from `chatCompletionSettings.prompts`; enabled state and order come from OpenAI `prompt_order`.
- The console config is stored in `preset.extensions.presetEasyToggle`, surfaced to the existing config reader as virtual config entries.
- `src/preset-easy-toggle/native.ts` mounts the app into a Shadow DOM host and keeps the existing draggable trigger/panel behavior.
- Header export downloads only the console config JSON: groups, modes, snapshots, entry metadata, and UI config.
- Header import accepts either that raw config JSON or a full SillyTavern preset export containing `[⚙️CONSOLE-CONFIG]`.
