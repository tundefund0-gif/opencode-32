import { OpenAIProvider } from './openai.js';

export class GroqProvider extends OpenAIProvider {
  constructor(config) {
    super({
      ...config,
      baseUrl: 'https://api.groq.com/openai/v1',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    });
  }
}
