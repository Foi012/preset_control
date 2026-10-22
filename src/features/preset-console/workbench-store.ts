import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { ConfigSchema, type Config } from './config';
import { nativePresetRepository, type PresetRepository, type PresetSnapshot } from './preset-repository';
import { catalog, changeSummary, cloneDocument, fingerprint, migratePlans, planMatches, readDocumentConfig, writeDocumentConfig, type PresetDocument } from './workbench-model';
import { expandDocument, type ExpansionContext } from './workbench-preview';

export interface WorkbenchDraft {
  snapshot: PresetSnapshot;
  document: PresetDocument;
  config: Config;
  initialConfig: string;
  corrupt: boolean;
  selected: string[];
  activePlan: string;
}
export function newDraft(snapshot: PresetSnapshot): WorkbenchDraft {
  const { config, corrupt } = readDocumentConfig(snapshot.document);
  migratePlans(config);
  const document = cloneDocument(snapshot.document);
  const activePlan = config.plans.filter(p => planMatches(document, p.selections)).sort((a, b) => Object.keys(b.selections).length - Object.keys(a.selections).length)[0]?.id ?? '';
  return { snapshot, document, config, initialConfig: fingerprint(config), corrupt, selected: [], activePlan };
}
export function draftDocument(draft: WorkbenchDraft): PresetDocument {
  const output = cloneDocument(draft.document);
  if (fingerprint(draft.config) !== draft.initialConfig || !draft.corrupt && !readDocumentConfig(output).config.plansMigrated) {
    if (draft.corrupt) throw new Error('控制台设置和备份都无法读取，暂时不能保存设置。');
    writeDocumentConfig(output, ConfigSchema.parse(draft.config));
  }
  return output;
}
export function draftDirty(draft: WorkbenchDraft): boolean {
  return fingerprint(draft.document) !== draft.snapshot.baseline || fingerprint(draft.config) !== draft.initialConfig;
}
/** Commit a new switch combination without committing the surrounding editor changes. */
export async function savePlanRecord(draft: WorkbenchDraft, repository: PresetRepository, plan: Config['plans'][number]): Promise<void> {
  if (draft.corrupt) throw new Error('控制台设置和备份都无法读取，暂时不能保存方案。');
  const baseline = newDraft(draft.snapshot);
  if (baseline.corrupt) throw new Error('控制台设置和备份都无法读取，暂时不能保存方案。');
  const savedIds = new Set(catalog(baseline.document).filter(e => e.placed && !e.configuration && !e.prompt.marker).map(e => e.prompt.identifier));
  if (Object.keys(plan.selections).some(id => !savedIds.has(id))) throw new Error('这个组合包含尚未保存的新条目。请先点击「保存」保存预设，再另存方案。');
  if (baseline.config.plans.some(p => p.id === plan.id)) throw new Error('无法创建新方案：生成的编号已被使用。请再试一次。');
  baseline.config.plans.push(cloneDocument(plan));
  await commitPlans(draft, repository, baseline, () => {
    draft.config.plans.push(cloneDocument(plan));
    draft.activePlan = plan.id;
  });
}
async function commitPlans(draft: WorkbenchDraft, repository: PresetRepository, baseline: WorkbenchDraft, update: () => void): Promise<void> {
  const output = cloneDocument(baseline.document);
  writeDocumentConfig(output, baseline.config);
  const next = await repository.save(draft.snapshot, output);
  update();
  draft.document.extensions ??= {};
  draft.document.extensions.presetEasyToggle = cloneDocument(next.document.extensions!.presetEasyToggle);
  draft.config.plansMigrated = true;
  draft.snapshot = next;
  draft.initialConfig = newDraft(next).initialConfig;
}
/** Delete only a saved combination; preserve pending editor changes. */
export async function deletePlanRecord(draft: WorkbenchDraft, repository: PresetRepository, id: string): Promise<void> {
  const baseline = newDraft(draft.snapshot);
  if (draft.corrupt || baseline.corrupt) throw new Error('控制台设置无法读取，暂时不能删除方案。');
  if (!baseline.config.plans.some(p => p.id === id)) throw new Error('这个方案已不存在，请重新打开工作台。');
  baseline.config.plans = baseline.config.plans.filter(p => p.id !== id);
  await commitPlans(draft, repository, baseline, () => {
    draft.config.plans = draft.config.plans.filter(p => p.id !== id);
    if (draft.activePlan === id) draft.activePlan = '';
  });
}
export const useWorkbenchStore = defineStore('pet-workbench', () => {
  const open = ref(false);
  const initialPanel = ref<'' | 'plans'>('');
  const drafts = ref<Record<string, WorkbenchDraft>>({});
  const names = ref<string[]>([]);
  const targetName = ref('');
  const sourceName = ref('');
  const copying = ref(false);
  const error = ref('');
  const notice = ref('');
  const busy = ref(false);
  const context = ref<ExpansionContext>({});
  let repository: PresetRepository | undefined;
  const repo = () => repository ??= nativePresetRepository();
  const target = computed(() => drafts.value[targetName.value]);
  const source = computed(() => drafts.value[sourceName.value]);
  const targetExpansion = computed(() => target.value ? expandDocument(target.value.document, context.value) : null);
  function load(name: string): void {
    if (!drafts.value[name]) drafts.value[name] = newDraft(repo().read(name));
  }
  function refreshContext(): void {
    if (!open.value) return;
    try {
      const next = repo().expansionContext();
      if (fingerprint(next) !== fingerprint(context.value)) { context.value = next; notice.value = '聊天内容已更新，预览已刷新，你的未保存修改仍会保留。'; }
    } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  }
  function enter(panel: '' | 'plans' = ''): void {
    try {
      initialPanel.value = panel;
      names.value = repo().list();
      targetName.value = repo().current();
      copying.value = false;
      load(targetName.value);
      context.value = repo().expansionContext();
      open.value = true;
      error.value = '';
    } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  }
  function chooseTarget(name: string): void {
    try { load(name); targetName.value = name; error.value = ''; } catch (e) { error.value = String(e); }
  }
  function chooseSource(name: string): void {
    try { load(name); sourceName.value = name; error.value = ''; } catch (e) { error.value = String(e); }
  }
  async function save(): Promise<boolean> {
    if (!target.value || busy.value) return false;
    busy.value = true;
    error.value = ''; notice.value = '';
    const draft = target.value;
    try {
      if (draft.corrupt) throw new Error('控制台设置和备份都无法读取，暂时不能保存。你的修改仍保留在工作台。');
      const next = await repo().save(draft.snapshot, draftDocument(draft));
      const saved = newDraft(next);
      saved.activePlan = draft.activePlan;
      drafts.value[next.name] = saved;
      notice.value = `已保存：${next.name}`;
      return true;
    } catch (e) { error.value = e instanceof Error ? e.message : String(e); return false; }
    finally { busy.value = false; }
  }
  async function savePlan(plan: Config['plans'][number]): Promise<boolean> {
    if (!target.value || busy.value || copying.value) return false;
    busy.value = true; error.value = ''; notice.value = '';
    try {
      await savePlanRecord(target.value, repo(), plan);
      notice.value = `方案「${plan.name}」已保存。`;
      return true;
    } catch (e) { error.value = e instanceof Error ? e.message : String(e); return false; }
    finally { busy.value = false; }
  }
  async function deletePlan(id: string): Promise<boolean> {
    if (!target.value || busy.value || copying.value) return false;
    busy.value = true; error.value = ''; notice.value = '';
    const name = target.value.config.plans.find(p => p.id === id)?.name;
    try {
      await deletePlanRecord(target.value, repo(), id);
      notice.value = `方案「${name}」已删除，条目和当前开关保留。`;
      return true;
    } catch (e) { error.value = e instanceof Error ? e.message : String(e); return false; }
    finally { busy.value = false; }
  }
  function discard(): void {
    if (!target.value || busy.value) return;
    try { drafts.value[targetName.value] = newDraft(repo().read(targetName.value)); error.value = ''; }
    catch (e) { error.value = String(e); }
  }
  const changes = computed(() => {
    const d = target.value;
    if (!d) return [];
    const summary = changeSummary(d.snapshot.document, d.document);
    if (fingerprint(d.config) !== d.initialConfig) summary.push('更新分组设置');
    return summary;
  });
  function hasCurrentDraft(): boolean {
    const d = drafts.value[repo().current()];
    return !!d && draftDirty(d);
  }
  function invalidateClean(): void {
    for (const [name, draft] of Object.entries(drafts.value)) if (!draftDirty(draft)) delete drafts.value[name];
  }
  return { open, initialPanel, drafts, names, targetName, sourceName, copying, error, notice, busy, context, target, source,
    targetExpansion, changes, enter, refreshContext, load, chooseTarget, chooseSource, save, savePlan, deletePlan, discard, hasCurrentDraft, invalidateClean };
});
