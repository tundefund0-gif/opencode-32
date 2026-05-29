import { OpenAIProvider } from './openai.js';

export class OpenRouterProvider extends OpenAIProvider {
  constructor(config) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': config.referer || 'https://opencode-32.local',
        'X-Title': config.title || 'opencode-32',
      },
    });
  }
}
