import { BaseProvider } from './base.js';

export class OpenAIProvider extends BaseProvider {
  async chat(messages, tools, onStream) {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = {
      model: this.config.model,
      messages: this.formatMessages(messages),
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 0.3,
      stream: !!onStream,
    };
    if (tools && tools.length) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...(this.config.headers || {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${err.substring(0, 300)}`);
    }
    if (onStream) return this._handleStream(res, onStream);
    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls || [],
      finishReason: choice?.finish_reason,
      usage: data.usage,
    };
  }

  async _handleStream(res, onStream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let finishReason = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') { finishReason = 'stop'; break; }
        try {
          const data = JSON.parse(jsonStr);
          const delta = data.choices?.[0]?.delta;
          if (delta?.content) { content += delta.content; onStream({ content: delta.content, done: false }); }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.find(t => t.index === tc.index);
              if (existing) {
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
              } else {
                toolCalls.push({ index: tc.index, id: tc.id || '', type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' } });
              }
            }
          }
          if (data.choices?.[0]?.finish_reason) finishReason = data.choices[0].finish_reason;
        } catch {}
      }
    }
    onStream({ content: '', done: true });
    return {
      content,
      toolCalls: toolCalls.filter(t => t.id).map(t => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments } })),
      finishReason,
    };
  }
}
