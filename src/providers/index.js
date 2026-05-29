import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';

const BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  opencode: 'https://opencode.ai/zen/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  azure: null,
};

export function createProvider(provider, config) {
  const baseUrl = config.baseUrl || BASE_URLS[provider];

  if (provider === 'anthropic') {
    return new AnthropicProvider({ ...config, baseUrl });
  }
  if (provider === 'google') {
    return new GoogleProvider({ ...config, baseUrl });
  }

  const headers = {};
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://opencode-32.local';
    headers['X-Title'] = 'opencode-32';
  }

  return new OpenAIProvider({ ...config, baseUrl, headers });
}

export function listProviders() {
  return Object.keys(BASE_URLS);
}
