import { OpenAIProvider } from './openai.js';

export class OpenCodeProvider extends OpenAIProvider {
  constructor(config) {
    super({
      ...config,
      baseUrl: 'https://opencode.ai/zen/v1',
    });
  }
}
