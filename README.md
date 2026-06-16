# 预设控制台 · Preset Control

A native SillyTavern extension that turns a chat-completion preset's flat prompt
list into a clean, floating console for toggling and arranging entries — a
friendlier layer over ST's built-in prompt manager.

## Features

- **Floating, draggable console** — a small trigger you can drop anywhere; it opens
  into a panel with two modes: **使用 (In-use)** to operate and **编辑 (Edit)** to
  configure. No settings drawer to dig through.
- **Rule-aware toggles** — each entry renders the right control automatically:
  single-select (radio), multi-select (checkbox), 📍 always-on (locked), and
  ✍️ input (text box). Changes apply to SillyTavern live and save to the preset.
- **Virtual grouping** — create and rename groups, move entries between them, and
  nest up to two levels. Your preset is never reordered; the grouping is an overlay
  stored in config.
- **Modes & Snapshots** — define named **Modes (模式)** that scope and arrange a
  subset of groups, and save ON/OFF combinations as **Snapshots (快照)** you apply
  in one click.
- **Required groups & cleanup** — mark a group 必开 (must keep one entry on) and it
  self-enforces; hide noise; pin important groups to the top.
- **Travels with the preset** — all config lives inside the preset, so it survives
  ST edits and preset switches. Export / import to back it up or move it to another
  preset.
- **Theme & mobile** — light/dark toggle and a responsive layout for phones.

## Use cases

- You keep **one large preset** with many modular entries (POV, persona, styles,
  plot blocks, model-specific COT tails) and ST's flat prompt manager is painful to
  operate. Group them once, then flip them like a control panel.
- You switch between **setups** constantly — claude / gpt / gemini profiles, or
  写作 / 总结 / 大纲 — and want them one tap away as Snapshots instead of
  re-checking a dozen boxes every time.
- You want toggles that **stick**: every change writes to the live preset and to
  disk, so your selections survive leaving and returning.

## Installation

1. In SillyTavern, open the **Extensions** menu and click **Install Extension**.
2. Paste the repository URL:
   ```
   https://github.com/Foi012/preset_control
   ```
3. Click **Install**, then **refresh** the page.
4. Select a chat-completion preset that contains a `⚙️CUSTOMIZATION_START / _END`
   region — the console trigger then appears on screen.

SillyTavern clones the repo into `data/<user>/extensions/preset_control/` and loads
`manifest.json` → `index.js`.

## Development

The repository root is the installable extension; the source lives in
`src/preset-easy-toggle/` (Vue 3 + Pinia, bundled by webpack). Rebuild the committed
`index.js` after changing source:

```sh
pnpm install
pnpm build      # production bundle → ./index.js
```
