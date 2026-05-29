import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { GroqProvider } from './groq.js';
import { BedrockProvider } from './bedrock.js';
import { OllamaProvider } from './ollama.js';
import { LMStudioProvider } from './lmstudio.js';
import { OpenCodeProvider } from './opencode.js';
import { OpenRouterProvider } from './openrouter.js';

const DEFAULTS = {
  openai: { cls: OpenAIProvider, needsKey: true },
  anthropic: { cls: AnthropicProvider, needsKey: true },
  google: { cls: GoogleProvider, needsKey: true },
  groq: { cls: GroqProvider, needsKey: true },
  bedrock: { cls: BedrockProvider, needsKey: true },
  ollama: { cls: OllamaProvider, needsKey: false },
  lmstudio: { cls: LMStudioProvider, needsKey: false },
  opencode: { cls: OpenCodeProvider, needsKey: true },
  openrouter: { cls: OpenRouterProvider, needsKey: true },
};

export function getProvider(providerName, modelName, config) {
  const def = DEFAULTS[providerName];
  if (!def) throw new Error(`Unknown provider: ${providerName}. Supported: ${Object.keys(DEFAULTS).join(', ')}`);
  const providerConfig = {
    ...config,
    model: modelName,
    baseUrl: config.baseUrl || undefined,
    apiKey: config.apiKey || undefined,
    maxTokens: config.maxTokens || 4096,
    temperature: config.temperature ?? 0.3,
  };
  return new def.cls(providerConfig);
}

export function requiresKey(providerName) {
  return DEFAULTS[providerName]?.needsKey !== false;
}

export function listProviders() {
  return Object.entries(DEFAULTS).map(([name, def]) => ({
    name,
    needsKey: def.needsKey,
  }));
}
