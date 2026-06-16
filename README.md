# 预设控制台 · Preset Control

一款原生的 SillyTavern 扩展，将聊天补全预设中扁平的提示词列表，变成一个清爽的浮动控制台，用于切换和整理条目——为 ST 内置的提示词管理器提供更友好的交互层。

A native SillyTavern extension that turns a chat-completion preset's flat prompt
list into a clean, floating console for toggling and arranging entries — a
friendlier layer over ST's built-in prompt manager.

## 功能/Features

- 可拖拽的浮动控制台 — 一个可以随意放置的小触发按钮；点击后展开面板，提供两种模式：使用（In-use） 进行操作，编辑（Edit） 进行配置。无需翻找设置抽屉。
- 规则感知的开关 — 每个条目会自动渲染出正确的控件：单选（radio）、多选（checkbox）、📍 始终开启（锁定）和 ✍️ 文本输入（文本框）。修改会实时应用到 SillyTavern 并保存到预设中。
- 虚拟分组 — 创建和重命名分组，在分组间移动条目，最多支持两级嵌套。你的预设本身不会被重新排序；分组只是一个叠加层，存储在配置中。
- 模式与快照 — 定义命名的 模式（Modes），圈定并排列一组分组子集；将开关组合保存为 快照（Snapshots），一键即可应用。
- 必开分组与整理 — 将分组标记为 必开（组内至少保留一项开启），它会自行强制执行；可隐藏无关条目；将重要分组置顶。
- 随预设携带 — 所有配置都保存在预设内部，因此能经受 ST 编辑和预设切换而保留。支持导出/导入以备份或迁移至其他预设。
- 主题与移动端 — 浅色/深色切换开关，以及适配手机的响应式布局。
---
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

## 使用场景/Use cases

- 你维护一个大型预设，内含大量模块化条目（视角、人设、风格、情节块、模型专属的 COT 尾句），而 ST 的扁平提示词管理器操作起来十分痛苦。一次性分组后，像控制面板一样轻松切换。
- 你频繁在不同配置间切换——Claude / GPT / Gemini 配置文件，或 写作 / 总结 / 大纲——希望它们以快照形式一键切换，不必每次都重新勾选十几个选项。
- 你需要可靠的状态保持：每次修改都会立即写入当前预设并持久化到磁盘，离开再返回后选择依然保留。
---
- You keep **one large preset** with many modular entries (POV, persona, styles,
  plot blocks, model-specific COT tails) and ST's flat prompt manager is painful to
  operate. Group them once, then flip them like a control panel.
- You switch between **setups** constantly — claude / gpt / gemini profiles, or
  写作 / 总结 / 大纲 — and want them one tap away as Snapshots instead of
  re-checking a dozen boxes every time.
- You want toggles that **stick**: every change writes to the live preset and to
  disk, so your selections survive leaving and returning.

## 安装/Installation

1. 在 SillyTavern 中，打开 扩展（Extensions） 菜单，点击 安装扩展（Install Extension）。
2. 粘贴仓库地址：
   ```
   https://github.com/Foi012/preset_control
   ```
3. 点击 安装，然后 刷新 页面。
4. 选择一个包含 ⚙️CUSTOMIZATION_START / _END 区域的聊天补全预设——控制台触发按钮会随即出现在屏幕上。
---
1. In SillyTavern, open the **Extensions** menu and click **Install Extension**.
2. Paste the repository URL:
   ```
   https://github.com/Foi012/preset_control
   ```
3. Click **Install**, then **refresh** the page.
4. Select a chat-completion preset that contains a `⚙️CUSTOMIZATION_START / _END`
   region — the console trigger then appears on screen.
