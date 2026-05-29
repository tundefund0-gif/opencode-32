import { BaseProvider } from './base.js';

export class GoogleProvider extends BaseProvider {
  formatMessages(messages) {
    const parts = [];
    const system = [];
    for (const m of messages) {
      if (m.role === 'system') { system.push(m.content); continue; }
      if (m.role === 'tool') { parts.push({ role: 'user', parts: [{ text: `[Tool ${m.tool_name}] ${m.content}` }] }); continue; }
      const role = m.role === 'assistant' ? 'model' : 'user';
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      parts.push({ role, parts: [{ text }] });
    }
    return { systemText: system.join('\n'), contents: parts };
  }

  async chat(messages, tools, onStream) {
    const { systemText, contents } = this.formatMessages(messages);
    const url = `${this.config.baseUrl}/models/${this.config.model}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
    const body = { contents };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (tools?.length) {
      body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Google API error ${res.status}: ${err.substring(0, 300)}`);
    }
    if (onStream) return this._handleStream(res, onStream);
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
    const toolCalls = (candidate?.content?.parts?.filter(p => p.functionCall) || []).map((p, i) => ({
      id: `call_${i}`,
      type: 'function',
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) },
    }));
    return { content, toolCalls, finishReason: candidate?.finishReason };
  }

  async _handleStream(res, onStream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    const usage = {};
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          const parts = data.candidates?.[0]?.content?.parts || [];
          for (const p of parts) {
            if (p.text) { content += p.text; onStream({ content: p.text, done: false }); }
            if (p.functionCall) {
              toolCalls.push({
                id: `call_${toolCalls.length}`,
                type: 'function',
                function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) },
              });
            }
          }
          if (data.usageMetadata) Object.assign(usage, data.usageMetadata);
        } catch {}
      }
    }
    onStream({ content: '', done: true });
    return { content, toolCalls, finishReason: 'stop', usage };
  }
}
