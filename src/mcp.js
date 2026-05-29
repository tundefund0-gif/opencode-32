import { tools, executeToolCall } from './tools.js';

export async function startMCP() {
  let buf = '';
  const send = (msg) => {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`;
    process.stdout.write(header + json);
  };

  process.stdin.on('data', (chunk) => {
    buf += chunk.toString();
    while (true) {
      const m = buf.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!m) break;
      const len = parseInt(m[1], 10);
      const hEnd = m.index + m[0].length;
      if (buf.length < hEnd + len) break;
      const content = buf.slice(hEnd, hEnd + len);
      buf = buf.slice(hEnd + len);
      try {
        const req = JSON.parse(content);
        handle(req, send);
      } catch (e) {
        send({ id: null, error: { code: -32700, message: e.message } });
      }
    }
  });

  function handle(req, send) {
    const { id, method, params } = req;
    switch (method) {
      case 'initialize':
        send({ id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'opencode-32', version: '1.0.0' } } });
        break;
      case 'ping':
        send({ id, result: {} });
        break;
      case 'tools/list':
        send({ id, result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.parameters.properties || {}, required: t.parameters.required || [] } })) } });
        break;
      case 'tools/call':
        executeToolCall({ id: params.arguments?._tool_call_id || 'mcp', type: 'function', function: { name: params.name, arguments: JSON.stringify(params.arguments || {}) } })
          .then(r => send({ id, result: { content: [{ type: 'text', text: r.content || '' }], isError: (r.content || '').startsWith('Error:') || (r.content || '').startsWith('Exit ') } }))
          .catch(e => send({ id, error: { code: -32603, message: e.message } }));
        break;
      default:
        send({ id, error: { code: -32601, message: `Not found: ${method}` } });
    }
  }
}
