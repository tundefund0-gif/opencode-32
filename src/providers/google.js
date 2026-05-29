export class GoogleProvider {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-2.5-flash';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 0.3;
  }

  async chat(messages, tools, onStream) {
    const contents = [];
    const system = [];
    for (const m of messages) {
      if (m.role === 'system') { system.push(m.content); continue; }
      if (m.role === 'tool') continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      contents.push({ role, parts: [{ text }] });
    }
    const body = { contents };
    if (system.length) body.systemInstruction = { parts: [{ text: system.join('\n') }] };
    if (tools?.length) {
      body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }
    const url = `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Google error ${res.status}: ${err.slice(0, 300)}`);
    }
    if (onStream) return this._stream(res, onStream);
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
    const fcs = (candidate?.content?.parts?.filter(p => p.functionCall) || []).map((p, i) => ({
      id: `fc_${i}`, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) },
    }));
    return { content: text, toolCalls: fcs, finishReason: candidate?.finishReason, usage: data.usageMetadata };
  }

  async _stream(res, onStream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = ''; let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          const parts = d.candidates?.[0]?.content?.parts || [];
          for (const p of parts) {
            if (p.text) { content += p.text; onStream(p.text); }
          }
        } catch {}
      }
    }
    onStream(null);
    return { content, toolCalls: [], finishReason: 'stop' };
  }
}
