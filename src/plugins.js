import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config.js';

const PLUGINS_DIR = join(getConfigDir(), 'plugins');

export function listPlugins() {
  if (!existsSync(PLUGINS_DIR)) return [];
  const entries = readdirSync(PLUGINS_DIR);
  const plugins = [];
  for (const entry of entries) {
    const manifestPath = join(PLUGINS_DIR, entry, 'plugin.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        plugins.push({ id: entry, ...manifest });
      } catch {}
    }
  }
  return plugins;
}

export function loadPluginHooks(name) {
  const pluginDir = join(PLUGINS_DIR, name);
  const hooksPath = join(pluginDir, 'hooks.js');
  if (existsSync(hooksPath)) {
    try {
      return import(hooksPath);
    } catch {}
  }
  return null;
}

export async function runPluginHooks(hook, context) {
  const plugins = listPlugins();
  for (const plugin of plugins) {
    const hooks = await loadPluginHooks(plugin.id);
    if (hooks?.[hook]) {
      try { await hooks[hook](context); } catch {}
    }
  }
}
