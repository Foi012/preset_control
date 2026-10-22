import { CONFIG_ENTRY_NAME, defaultConfig, readConfig, serializeConfig } from './config';
import { saveConfig, setEntriesEnabled } from './preset-io';
import { presetGatewayNative } from './preset-io-native';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function main() {
  const selectedName = 'Native Fixture';
  const settings = {
    prompts: [
      { identifier: 'a', name: 'A', content: 'one', role: 'system' },
      { identifier: 'b', name: 'B', content: 'two', role: 'system' },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }] }],
    extensions: {
      presetEasyToggle: { config: serializeConfig(defaultConfig()) },
    },
  };
  let saved: any = null;
  (globalThis as any).SillyTavern = {
    getContext: () => ({
      chatCompletionSettings: settings,
      eventTypes: { SETTINGS_UPDATED: 'settings_updated' },
      eventSource: { emit: () => undefined },
      saveSettingsDebounced: () => undefined,
      getPresetManager: () => ({
        getSelectedPresetName: () => selectedName,
        getCompletionPresetByName: () => ({ name: selectedName }),
        savePreset: async (_name: string, preset: unknown) => {
          saved = preset;
        },
      }),
    }),
  };

  const gateway = presetGatewayNative();
  const lists = gateway.read();
  check('read uses prompt_order order', lists.prompts.map(prompt => prompt.id), ['b', 'a']);
  check('read maps enabled from prompt_order', lists.prompts.map(prompt => prompt.enabled), [true, false]);
  check('read exposes extension config as virtual prompt', lists.promptsUnused[0]?.name, CONFIG_ENTRY_NAME);
  check('extension config parses through existing reader', readConfig(lists.promptsUnused).version, 1);

  await setEntriesEnabled(gateway, { a: true, b: false });
  check('write updates native prompt_order enabled', settings.prompt_order[0].order, [
    { identifier: 'b', enabled: false },
    { identifier: 'a', enabled: true },
  ]);

  const cfg = defaultConfig();
  cfg.customGroups.push({ id: 'g1', name: 'Native', rule: 'multi', order: 0, pinned: false, hidden: false, required: false, collapsed: false });
  await saveConfig(gateway, cfg);
  check('saveConfig writes native extension storage', typeof settings.extensions.presetEasyToggle.config, 'string');
  check('saved extension config round-trips', readConfig(gateway.read().promptsUnused).customGroups[0]?.name, 'Native');

  await gateway.persist();
  check('persist saves prompts into selected preset', saved.prompts.length, 2);
  check('persist saves prompt_order into selected preset', saved.prompt_order[0].order[0].identifier, 'b');
  check('persist saves extensions into selected preset', saved.extensions.presetEasyToggle.config.includes('Native'), true);

  settings.prompts.push({ identifier: 'unplaced', name: 'Unplaced', content: 'spare', role: 'system' });
  settings.prompt_order[0].order.push({ identifier: 'missing', enabled: false });
  (settings.prompt_order[0].order[0] as any).custom = 'preserve';
  await setEntriesEnabled(gateway, { a: false });
  check('ordinary toggle keeps unplaced entry out of prompt_order', settings.prompt_order[0].order.some(e => e.identifier === 'unplaced'), false);
  check('ordinary toggle preserves stale order reference', settings.prompt_order[0].order.some(e => e.identifier === 'missing'), true);
  check('ordinary toggle preserves native order metadata', (settings.prompt_order[0].order[0] as any).custom, 'preserve');
  await setEntriesEnabled(gateway, { unplaced: true });
  check('explicit enable places an unplaced entry', settings.prompt_order[0].order.some(e => e.identifier === 'unplaced' && e.enabled), true);

  if (failures) process.exit(1);
  console.log('\nALL PASS');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

