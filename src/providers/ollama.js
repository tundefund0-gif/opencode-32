import { OpenAIProvider } from './openai.js';

export class OllamaProvider extends OpenAIProvider {
  constructor(config) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'http://localhost:11434/v1',
    });
  }
}
