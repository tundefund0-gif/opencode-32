export class BaseProvider {
  constructor(config) {
    this.config = config;
  }

  async chat(messages, tools, onStream) {
    throw new Error('Not implemented');
  }

  formatMessages(messages) {
    return messages;
  }

  parseResponse(data) {
    const choice = data.choices?.[0];
    if (!choice) return { content: '', toolCalls: [] };
    const content = choice.delta?.content || choice.message?.content || '';
    const toolCalls = (choice.delta?.tool_calls || choice.message?.tool_calls || []).filter(Boolean);
    return { content, toolCalls, finishReason: choice.finish_reason };
  }
}
