import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), '.config', 'opencode');
const CONFIG_PATH = join(CONFIG_DIR, 'opencode.json');
const DATA_DIR = join(CONFIG_DIR, 'data');

export function ensureConfigDir() {
  for (const d of [CONFIG_DIR, DATA_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return {}; }
}

export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getConfigDir() { return CONFIG_DIR; }
export function getDataDir() { return DATA_DIR; }
export function getConfigPath() { return CONFIG_PATH; }

export function getApiKey(provider) {
  const envKey = `OPENCODE_${provider.toUpperCase()}_API_KEY`;
  const fromEnv = process.env[envKey] || process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY;
  if (fromEnv) return fromEnv;
  const cfg = loadConfig();
  return cfg.apiKeys?.[provider] || cfg.apiKey || null;
}

export function setApiKey(provider, key) {
  const cfg = loadConfig();
  if (!cfg.apiKeys) cfg.apiKeys = {};
  cfg.apiKeys[provider] = key;
  saveConfig(cfg);
}

export function getModel() {
  return process.env.OPENCODE_MODEL || loadConfig().model || 'opencode/big-pickle';
}

export function setModel(model) {
  const cfg = loadConfig();
  cfg.model = model;
  saveConfig(cfg);
}

export function getProvider() {
  const raw = getModel();
  const slash = raw.indexOf('/');
  if (slash > 0) return raw.substring(0, slash).toLowerCase();
  const cfg = loadConfig();
  return cfg.provider || 'opencode';
}

export function getModelName() {
  const raw = getModel();
  const slash = raw.indexOf('/');
  if (slash > 0) return raw.substring(slash + 1);
  return raw;
}

export function getBaseUrl(provider) {
  const envUrl = process.env[`OPENCODE_${provider.toUpperCase()}_BASE_URL`];
  if (envUrl) return envUrl;
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'anthropic': return 'https://api.anthropic.com/v1';
    case 'google': return 'https://generativelanguage.googleapis.com/v1beta';
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'bedrock': return null; // Uses AWS SDK
    case 'ollama': return 'http://localhost:11434/v1';
    case 'lmstudio': return 'http://localhost:1234/v1';
    case 'opencode': return 'https://opencode.ai/zen/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    default: return loadConfig().baseUrl || 'https://api.openai.com/v1';
  }
}

export function getMaxTokens() {
  return parseInt(process.env.OPENCODE_MAX_TOKENS || loadConfig().maxTokens || '4096', 10);
}

export function getTemperature() {
  return parseFloat(process.env.OPENCODE_TEMPERATURE || loadConfig().temperature || '0.3');
}

export function getSystemPrompt(instructions) {
  let p = `You are OpenCode, an AI coding agent running on the user's device. You have full access to files and the shell.

CRITICAL RULES:
- Never repeat yourself. Vary every response.
- Be concise unless asked for detail.
- Use tools to read, write, edit files and run shell commands.
- For bash commands, always include a clear description.
- Do the task and stop — no unnecessary follow-up.

Available tools: read, write, edit, bash, glob, grep, ls, append, move, delete, search`;
  if (instructions) p += `\n\nProject Instructions:\n${instructions}`;
  return p;
}

let _ollamaCheck = { result: null, time: 0 };
export function isOllamaRunning() {
  if (_ollamaCheck.result !== null && Date.now() - _ollamaCheck.time < 15000) return _ollamaCheck.result;
  try {
    execSync('curl -sf http://localhost:11434/api/tags >/dev/null 2>&1 || wget -q http://localhost:11434/api/tags -O /dev/null 2>&1', { timeout: 2000 });
    _ollamaCheck = { result: true, time: Date.now() };
  } catch { _ollamaCheck = { result: false, time: Date.now() }; }
  return _ollamaCheck.result;
}

const VISION_MODELS = ['gpt-4o', 'gpt-4.1', 'gpt-5.5', 'gpt-5.4', 'gemini-2.5', 'claude-3', 'claude-4'];
export function supportsVision() {
  const m = getModelName();
  return VISION_MODELS.some(v => m.includes(v)) || loadConfig().vision === true;
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

export function getTokenCachePath() {
  return join(DATA_DIR, 'tokens.json');
}

export function getTokenCache() {
  const p = getTokenCachePath();
  if (!existsSync(p)) return { totalInput: 0, totalOutput: 0, totalCost: 0 };
  try { return JSON.parse(readFileSync(p, 'utf-8')); }
  catch { return { totalInput: 0, totalOutput: 0, totalCost: 0 }; }
}

export function updateTokenCache(input, output, cost) {
  const c = getTokenCache();
  c.totalInput += input;
  c.totalOutput += output;
  c.totalCost += cost;
  ensureConfigDir();
  writeFileSync(getTokenCachePath(), JSON.stringify(c));
}
