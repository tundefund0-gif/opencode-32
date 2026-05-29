import { BaseProvider } from './base.js';

export class AnthropicProvider extends BaseProvider {
  async chat(messages, tools, onStream) {
    const url = `${this.config.baseUrl}/messages`;
    const model = this.config.model;
    const system = [];
    const msgs = [];
    for (const m of messages) {
      if (m.role === 'system') { system.push(m.content); continue; }
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = [];
      if (typeof m.content === 'string') {
        content.push({ type: 'text', text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (typeof c === 'string') content.push({ type: 'text', text: c });
          else content.push(c);
        }
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name,
            input: JSON.parse(tc.function?.arguments || '{}'),
          });
        }
      }
      msgs.push({ role, content });
    }
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg?.role === 'tool_result') throw new Error('Anthropic does not support tool_result role');
    const body = { model, max_tokens: this.config.maxTokens || 4096, messages: msgs };
    if (system.length) body.system = system.join('\n');
    if (tools?.length) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    if (onStream) body.stream = true;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        ...(this.config.headers || {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status}: ${err.substring(0, 300)}`);
    }
    if (onStream) return this._handleStream(res, onStream);
    const data = await res.json();
    return {
      content: data.content?.[0]?.text || '',
      toolCalls: (data.content?.filter(c => c.type === 'tool_use') || []).map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      })),
      finishReason: data.stop_reason,
      usage: data.usage,
    };
  }

  async _handleStream(res, onStream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);
        try {
          const data = JSON.parse(jsonStr);
          if (data.type === 'content_block_delta' && data.delta?.text) {
            content += data.delta.text;
            onStream({ content: data.delta.text, done: false });
          }
          if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
            toolCalls.push({
              index: data.index,
              id: data.content_block.id,
              type: 'function',
              function: { name: data.content_block.name, arguments: '' },
            });
          }
          if (data.type === 'content_block_delta' && data.delta?.partial_json) {
            const tc = toolCalls.find(t => t.index === data.index);
            if (tc) tc.function.arguments += data.delta.partial_json;
          }
        } catch {}
      }
    }
    onStream({ content: '', done: true });
    return {
      content,
      toolCalls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })),
      finishReason: 'end_turn',
    };
  }
}
