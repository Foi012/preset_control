/**
 * Chat source — the one impure edge of the exporter (mirrors `preset-io`'s role).
 *
 * Resolves a chosen {@link ChatSource} to raw ST messages. Two v1 sources:
 *  - `jsonl`  — the text of a dropped/`.jsonl` file (pure parse).
 *  - `active` — ST's current in-memory chat, read from `getContext().chat`.
 *
 * The `active` read must work from both mount paths: the native extension
 * (`window.SillyTavern`) and the srcdoc iframe, where ST lives on the parent
 * window. It is best-effort — returns `[]` if ST is unreachable rather than
 * throwing, so the UI can show an empty state instead of crashing.
 *
 * (Deferred v2: a third `saved` source that browses ST's chat-file list.)
 */
import { parseJsonl, type RawMessage } from './normalize';

export type ChatSource = { kind: 'active' } | { kind: 'jsonl'; text: string };

function stChat(): RawMessage[] {
  const w = window as unknown as {
    SillyTavern?: { getContext?: () => { chat?: unknown } };
    parent?: { SillyTavern?: { getContext?: () => { chat?: unknown } } };
  };
  const st = w.SillyTavern ?? w.parent?.SillyTavern;
  const chat = st?.getContext?.().chat;
  return Array.isArray(chat) ? (chat as RawMessage[]) : [];
}

export async function loadRawMessages(source: ChatSource): Promise<RawMessage[]> {
  if (source.kind === 'jsonl') return parseJsonl(source.text);
  return stChat();
}
