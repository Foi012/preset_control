import type { Config } from './config';
/** Shared hierarchy policy for quick grouping, draft grouping and legacy mode layouts. */
export const MAX_GROUP_DEPTH = 3;
export interface GroupLink { id: string; parentId?: string | null }
export function validGroupAncestry(id: string, parents: Map<string, string | null | undefined>): boolean {
  const seen = new Set<string>(); let current: string | null | undefined = id;
  while (current) {
    if (seen.has(current) || !parents.has(current) || seen.size >= MAX_GROUP_DEPTH) return false;
    seen.add(current); current = parents.get(current);
  }
  return true;
}
export function canPlaceGroup(nodes: GroupLink[], id: string, parentId?: string | null): boolean {
  const parents = new Map(nodes.map(n => [n.id, n.parentId]));
  if (!parents.has(id) || parentId && !parents.has(parentId)) return false;
  parents.set(id, parentId);
  // Include descendants: moving a two-level subtree below a level-two parent is invalid.
  for (const node of nodes) {
    let current: string | null | undefined = node.id; const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === id && !validGroupAncestry(node.id, parents)) return false;
      seen.add(current); current = parents.get(current);
    }
  }
  return validGroupAncestry(id, parents);
}

/** Delete the virtual container only; keep prompt text, switches and saved scopes. */
export function removeCustomGroup(config: Config, id: string): boolean {
  const group = config.customGroups.find(g => g.id === id);
  if (!group) return false;
  const parentId = group.parentId;
  config.customGroups = config.customGroups.filter(g => g.id !== id);
  for (const child of [...config.customGroups, ...config.groups]) {
    if (child.parentId === id) child.parentId = parentId;
  }
  for (const [entryId, meta] of Object.entries(config.entryMeta)) {
    if (meta.groupId !== id) continue;
    if (parentId) meta.groupId = parentId;
    else delete meta.groupId;
    if (!Object.keys(meta).length) delete config.entryMeta[entryId];
  }
  for (const mode of config.scenarios) {
    const layoutParent = mode.layout.find(g => g.groupId === id)?.parentId;
    mode.groupIds = mode.groupIds.filter(gid => gid !== id);
    mode.layout = mode.layout.filter(g => g.groupId !== id);
    for (const child of mode.layout) if (child.parentId === id) child.parentId = layoutParent;
  }
  return true;
}
