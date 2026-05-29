import { tools, executeToolCall } from './tools.js';

export async function startMCPServer() {
  const encoder = new TextEncoder();
  const reader = process.stdin;
  const writer = process.stdout;
  let buffer = '';

  const send = (msg) => {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`;
    writer.write(header + json);
  };

  const handleRequest = async (req) => {
    const { id, method, params } = req;

    switch (method) {
      case 'initialize':
        send({
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'opencode-32', version: '1.0.0' },
          },
        });
        break;

      case 'ping':
        send({ id, result: {} });
        break;

      case 'tools/list':
        send({
          id,
          result: {
            tools: tools.map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: { type: 'object', properties: t.parameters.properties || {}, required: t.parameters.required || [] },
            })),
          },
        });
        break;

      case 'tools/call': {
        const result = await executeToolCall({
          id: params.arguments?._tool_call_id || 'mcp_call',
          type: 'function',
          function: { name: params.name, arguments: JSON.stringify(params.arguments || {}) },
        });
        send({
          id,
          result: {
            content: [{ type: 'text', text: result.content || '' }],
            isError: result.content?.startsWith('Error:') || result.content?.startsWith('Exit '),
          },
        });
        break;
      }

      default:
        send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  };

  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    while (true) {
      const headerMatch = buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;
      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch.index + headerMatch[0].length;
      if (buffer.length < headerEnd + contentLength) break;
      const content = buffer.slice(headerEnd, headerEnd + contentLength);
      buffer = buffer.slice(headerEnd + contentLength);
      try {
        const req = JSON.parse(content);
        handleRequest(req);
      } catch (err) {
        send({ error: { code: -32700, message: `Parse error: ${err.message}` } });
      }
    }
  });

  send({ jsonrpc: '2.0', method: 'server/start', params: { message: 'OpenCode-32 MCP server ready' } });

  return new Promise(() => {});
}
