export class OpenAIProvider {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 0.3;
    this.headers = config.headers || {};
  }

  async chat(messages, tools, onStream) {
    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: !!onStream,
    };
    if (tools && tools.length) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const res = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}`, ...this.headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${err.slice(0, 300)}`);
    }
    if (onStream) return this._stream(res, onStream);
    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls || [],
      finishReason: choice?.finish_reason,
      usage: data.usage,
    };
  }

  async _stream(res, onStream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    let toolCalls = [];
    let finishReason = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ')) continue;
        const j = t.slice(6);
        if (j === '[DONE]') { finishReason = 'stop'; break; }
        try {
          const d = JSON.parse(j);
          const delta = d.choices?.[0]?.delta;
          if (delta?.content) { content += delta.content; onStream(delta.content); }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              let found = toolCalls.find(x => x.index === tc.index);
              if (found) {
                if (tc.function?.arguments) found.function.arguments += tc.function.arguments;
              } else {
                toolCalls.push({ index: tc.index, id: tc.id || '', type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' } });
              }
            }
          }
          if (d.choices?.[0]?.finish_reason) finishReason = d.choices[0].finish_reason;
        } catch {}
      }
    }
    onStream(null);
    return {
      content,
      toolCalls: toolCalls.filter(t => t.id).map(t => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments } })),
      finishReason,
    };
  }
}
