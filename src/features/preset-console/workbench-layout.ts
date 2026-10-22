import type { ExpandedEntry, ExpansionContext, ExpansionResult } from './workbench-preview';
export const markerLabel = (entry: ExpandedEntry): string => ({
  personaDescription: '用户角色信息', charDescription: '角色信息', charPersonality: '角色性格', scenario: '场景',
  worldInfoBefore: '世界书 · 前置', worldInfoAfter: '世界书 · 后置', dialogueExamples: '对话示例', chatHistory: '聊天记录',
}[entry.entry.prompt.identifier] ?? entry.entry.prompt.name ?? '其他聊天内容');
const normal = (e: ExpandedEntry) => e.entry.placed && e.entry.enabled && !e.entry.configuration && (!e.entry.prompt.injection_trigger?.length || e.entry.prompt.injection_trigger.includes('normal'));
/** Display order only. ST expands prompt-manager macros in prompt_order, before inserting depth prompts. */
export function sendingLayout(result: ExpansionResult, context: ExpansionContext): { entries: ExpandedEntry[]; unresolved: ExpandedEntry[]; unresolvedReason: string; diagnostics: string[] } {
  const enabled = result.entries.filter(normal), diagnostics: string[] = [];
  // Disabled placeholders remain visible as structural context, explicitly marked as not sent.
  const visible = result.entries.filter(e => normal(e) || e.entry.placed && e.entry.prompt.marker && !e.entry.configuration);
  const absolute = enabled.filter(e => e.entry.prompt.injection_position === 1 && !e.entry.prompt.marker);
  const hasHistory = enabled.some(e => e.entry.prompt.identifier === 'chatHistory' && e.entry.prompt.marker);
  const count = context.chatMessageCount;
  const history = result.entries.find(e => e.entry.placed && e.entry.prompt.marker && e.entry.prompt.identifier === 'chatHistory');
  const unresolved = !hasHistory || count === undefined ? absolute : [];
  const unresolvedReason = !unresolved.length ? '' : history && !history.entry.enabled
    ? '「聊天记录」占位条目未开启。这些条目设为插入聊天记录，当前不会进入聊天记录中的发送内容；其正文保留在这里供检查。'
    : !hasHistory ? '当前没有可用的「聊天记录」占位条目，无法将这些条目放入发送位置。其正文保留在这里供检查。'
      : '暂时无法读取聊天记录的长度，因此无法确定以下条目的发送位置。其正文保留在这里供检查。';
  if (unresolvedReason) diagnostics.push(unresolvedReason);
  const output: ExpandedEntry[] = [];
  const placeholders = (history: ExpandedEntry): ExpandedEntry[] => {
    if (!absolute.length || !hasHistory || count === undefined) return [history];
    const sorted = [...absolute].sort((a, b) => {
      const depth = (e: ExpandedEntry) => Number(e.entry.prompt.injection_depth ?? 4);
      const order = (e: ExpandedEntry) => Number(e.entry.prompt.injection_order ?? 100);
      const role = (e: ExpandedEntry) => ['assistant', 'user', 'system'].indexOf(e.entry.prompt.role ?? 'system');
      return depth(b) - depth(a) || order(a) - order(b) || role(a) - role(b) || a.entry.index - b.entry.index;
    });
    const blocks: ExpandedEntry[] = []; let remaining = count, part = 0;
    const historyPart = (n: number) => {
      if (n <= 0) return;
      blocks.push({ ...history, entry: { ...history.entry, prompt: { ...history.entry.prompt, identifier: `chatHistory:part:${part++}`, name: `聊天记录 · ${n} 条` } } });
    };
    for (const entry of sorted) {
      const depth = Math.max(0, Math.min(count, Number(entry.entry.prompt.injection_depth ?? 4)));
      historyPart(remaining - depth); remaining = depth; blocks.push(entry);
    }
    historyPart(remaining);
    if (!count) blocks.unshift({ ...history, entry: { ...history.entry, prompt: { ...history.entry.prompt, name: '聊天记录 · 0 条' } } });
    return blocks;
  };
  for (const entry of visible) {
    if (entry.entry.prompt.injection_position === 1 && !entry.entry.prompt.marker) continue;
    if (entry.entry.prompt.identifier === 'chatHistory' && entry.entry.prompt.marker) output.push(...placeholders(entry));
    else output.push(entry);
  }
  return { entries: output, unresolved, unresolvedReason, diagnostics };
}
