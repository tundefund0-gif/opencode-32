import { OpenAIProvider } from './openai.js';

export class LMStudioProvider extends OpenAIProvider {
  constructor(config) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'http://localhost:1234/v1',
    });
  }
}
