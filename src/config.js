import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join, resolve } from 'path';

export const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'opencode')
  : join(homedir(), '.config', 'opencode');
export const DATA_DIR = process.env.XDG_DATA_HOME
  ? join(process.env.XDG_DATA_HOME, 'opencode')
  : join(homedir(), '.local', 'share', 'opencode');
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const CONFIG_PATH = join(CONFIG_DIR, 'opencode.json');
export const CONFIG_JSONC_PATH = join(CONFIG_DIR, 'opencode.jsonc');

export function ensureDirs() {
  for (const d of [CONFIG_DIR, DATA_DIR, SESSIONS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function loadConfig() {
  const paths = [process.env.OPENCODE_CONFIG_PATH, CONFIG_PATH, CONFIG_JSONC_PATH].filter(Boolean);
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        let raw = readFileSync(p, 'utf-8');
        if (p.endsWith('.jsonc')) raw = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        return JSON.parse(raw);
      } catch {}
    }
  }
  return {};
}

export function saveConfig(config) {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getApiKey(provider) {
  const envKey = `OPENCODE_${provider.toUpperCase()}_API_KEY`;
  if (process.env[envKey]) return process.env[envKey];
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;
  const cfg = loadConfig();
  return cfg.apiKeys?.[provider] || null;
}

export function setApiKey(provider, key) {
  const cfg = loadConfig();
  if (!cfg.apiKeys) cfg.apiKeys = {};
  cfg.apiKeys[provider] = key;
  saveConfig(cfg);
}

export function getProviders() {
  const cfg = loadConfig();
  if (cfg.providers) return cfg.providers;

  const model = cfg.model || process.env.OPENCODE_MODEL;
  if (model && model.includes('/')) {
    const [prov, mdl] = model.split('/');
    return { [prov]: { model: mdl, apiKey: getApiKey(prov), maxTokens: cfg.maxTokens || 4096 } };
  }
  return { opencode: { model: 'big-pickle', apiKey: getApiKey('opencode'), maxTokens: 4096 } };
}

export function getAgents() {
  const cfg = loadConfig();
  return cfg.agents || {
    primary: { model: process.env.OPENCODE_MODEL || 'opencode/big-pickle', maxTokens: 4096, system: '' },
    task: { model: process.env.OPENCODE_MODEL || 'opencode/big-pickle', maxTokens: 4096 },
    title: { model: process.env.OPENCODE_MODEL || 'opencode/big-pickle', maxTokens: 80 },
  };
}

export function getAgentConfig(name = 'primary') {
  const agents = getAgents();
  const agent = agents[name] || agents.primary || {};
  const model = agent.model || process.env.OPENCODE_MODEL || 'opencode/big-pickle';
  const [provider, ...rest] = model.split('/');
  const modelName = rest.join('/') || model;
  const provConfig = getProviders()[provider] || {};
  return {
    provider,
    model: modelName,
    apiKey: agent.apiKey || provConfig.apiKey || getApiKey(provider),
    baseUrl: agent.baseUrl || provConfig.baseUrl || process.env[`OPENCODE_${provider.toUpperCase()}_BASE_URL`],
    maxTokens: agent.maxTokens || provConfig.maxTokens || parseInt(process.env.OPENCODE_MAX_TOKENS || '4096', 10),
    temperature: agent.temperature ?? parseFloat(process.env.OPENCODE_TEMPERATURE ?? '0.3'),
    system: agent.system || '',
    reasoningEffort: agent.reasoningEffort || '',
  };
}

export function getSystemPrompt(custom) {
  let p = `You are OpenCode, an AI coding agent. You have full access to files and the shell.

Rules:
- Be concise. Do the task and stop.
- Use tools to read, write, edit files and run commands.
- For bash, always include a clear description.`;
  if (custom) p += '\n\n' + custom;
  return p;
}

export function estimateTokens(text) {
  if (!text) return 0;
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    t += c < 128 ? 0.25 : c < 2048 ? 0.5 : 0.75;
  }
  return Math.ceil(t) + 3;
}

const VISION_MODELS = ['claude-3', 'claude-4', 'gpt-4o', 'gpt-4.1', 'gpt-5', 'gemini-2.5', 'gemini-2.0'];
export function supportsVision(m) {
  return VISION_MODELS.some(v => (m || '').includes(v));
}

export function getTokenCache() {
  const p = join(DATA_DIR, 'tokens.json');
  if (!existsSync(p)) return { totalInput: 0, totalOutput: 0, totalCost: 0 };
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return { totalInput: 0, totalOutput: 0, totalCost: 0 }; }
}

export function updateTokenCache(input, output, cost) {
  const c = getTokenCache();
  c.totalInput += input; c.totalOutput += output; c.totalCost += cost;
  ensureDirs();
  writeFileSync(join(DATA_DIR, 'tokens.json'), JSON.stringify(c));
}
