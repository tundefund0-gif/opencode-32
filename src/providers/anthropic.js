export class AnthropicProvider {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 0.3;
  }

  async chat(messages, tools, onStream) {
    const system = [];
    const msgs = [];
    for (const m of messages) {
      if (m.role === 'system') { system.push(m.content); continue; }
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = [];
      if (typeof m.content === 'string') content.push({ type: 'text', text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input: JSON.parse(tc.function?.arguments || '{}') });
        }
      }
      if (m.role === 'tool') {
        msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] });
        continue;
      }
      msgs.push({ role, content });
    }

    const body = { model: this.model, max_tokens: this.maxTokens, messages: msgs };
    if (system.length) body.system = system.join('\n');
    if (tools?.length) {
      body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    if (onStream) body.stream = true;

    const res = await fetch(this.baseUrl + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Anthropic error ${res.status}: ${err.slice(0, 300)}`);
    }
    if (onStream) return this._stream(res, onStream);
    const data = await res.json();
    return {
      content: data.content?.find(c => c.type === 'text')?.text || '',
      toolCalls: (data.content?.filter(c => c.type === 'tool_use') || []).map(tc => ({
        id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      })),
      finishReason: data.stop_reason,
      usage: data.usage,
    };
  }

  async _stream(res, onStream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    let toolCalls = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'content_block_delta' && d.delta?.text) { content += d.delta.text; onStream(d.delta.text); }
          if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
            toolCalls.push({ index: d.index, id: d.content_block.id, type: 'function', function: { name: d.content_block.name, arguments: '' } });
          }
          if (d.type === 'content_block_delta' && d.delta?.partial_json) {
            const tc = toolCalls.find(t => t.index === d.index);
            if (tc) tc.function.arguments += d.delta.partial_json;
          }
        } catch {}
      }
    }
    onStream(null);
    return {
      content,
      toolCalls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })),
      finishReason: 'end_turn',
    };
  }
}
