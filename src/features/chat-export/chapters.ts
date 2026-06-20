/**
 * Chapter splitting — Phase 4 pure core.
 *
 * Runs the extract engine over each message, then groups the results into chapters
 * by a **boundary rule**. A message either *starts* a new chapter or folds into the
 * current one; bodies are joined, and the title comes from a captured `title` field
 * (else an auto `第N章`). Other captured fields (time/location/…) become chapter meta.
 */
import { extractMessage, type ExtractConfig } from './extract';
import type { NormMessage, Role } from './normalize';

export type ChapterRule =
  | { kind: 'per-assistant' } // each AI reply starts a chapter (user turns fold in)
  | { kind: 'per-message' } //   every message is its own chapter
  | { kind: 'title' } //          new chapter wherever a `title` field is captured
  | { kind: 'every'; n: number }; // fixed-size groups of N messages

export interface Chapter {
  /** 1-based. */
  index: number;
  title: string;
  body: string;
  meta: Record<string, string>;
}

interface Draft {
  bodies: string[];
  meta: Record<string, string>;
  title: string;
  lastRole: Role | null;
}

export interface ChapterBuildOptions {
  roleDivider?: string;
}

/** Group extracted messages into chapters by the boundary rule. */
export function buildChapters(messages: NormMessage[], config: ExtractConfig, rule: ChapterRule, options: ChapterBuildOptions = {}): Chapter[] {
  const chapters: Chapter[] = [];
  let cur: Draft | null = null;
  let sinceStart = 0;
  const roleDivider = options.roleDivider?.trim();

  const flush = (): void => {
    if (!cur) return;
    const body = cur.bodies.filter(Boolean).join('\n\n').trim();
    // Drop chapters with neither a title nor any body — pure noise (e.g. an empty turn).
    if (body || cur.title) {
      chapters.push({ index: chapters.length + 1, title: cur.title || `第${chapters.length + 1}章`, body, meta: cur.meta });
    }
    cur = null;
  };

  messages.forEach(m => {
    const ex = extractMessage(m.content, m.role, config);
    let boundary = cur === null; // the first message always opens chapter 1
    if (!boundary) {
      switch (rule.kind) {
        case 'per-message':
          boundary = true;
          break;
        case 'per-assistant':
          boundary = m.role === 'assistant';
          break;
        case 'title':
          boundary = !!ex.fields.title;
          break;
        case 'every':
          boundary = sinceStart >= Math.max(1, rule.n);
          break;
      }
    }
    if (boundary) {
      flush();
      cur = { bodies: [], meta: {}, title: '', lastRole: null };
      sinceStart = 0;
    }
    if (roleDivider && cur!.lastRole && cur!.lastRole !== m.role) cur!.bodies.push(roleDivider);
    cur!.bodies.push(ex.body);
    cur!.lastRole = m.role;
    sinceStart += 1;
    if (!cur!.title && ex.fields.title) cur!.title = ex.fields.title;
    for (const [k, v] of Object.entries(ex.fields)) {
      if (k !== 'title' && !(k in cur!.meta)) cur!.meta[k] = v;
    }
  });
  flush();
  return chapters;
}
