import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Session } from './session.js';
import { getAgentConfig, getApiKey } from './config.js';
import { tools } from './tools.js';
import { run } from './agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'webui', 'index.html');

function readHTML() {
  try {
    if (existsSync(HTML_PATH)) return readFileSync(HTML_PATH, 'utf-8');
  } catch {}
  return '<h1>OpenCode-32</h1><p>Web UI file not found. Reinstall the package.</p>';
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function startWeb(port, host) {
  const html = readHTML();
  console.log(`\n  OpenCode-32 Web → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    // Serve HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
      res.end(html);
      return;
    }

    // Return current config
    if (url.pathname === '/config') {
      const ac = getAgentConfig();
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ provider: ac.provider, model: ac.model }));
      return;
    }

    // Chat endpoint (SSE)
    if (url.pathname === '/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { messages } = JSON.parse(body);
          if (!messages || !Array.isArray(messages)) throw new Error('Invalid messages');

          const sid = url.searchParams.get('sid') || Date.now().toString(36);
          const modelParam = url.searchParams.get('model');
          const keyParam = url.searchParams.get('key');
          const providerParam = url.searchParams.get('provider');

          const ac = getAgentConfig();
          const provider = providerParam || ac.provider;
          const model = modelParam || ac.model;
          const apiKey = keyParam || ac.apiKey || getApiKey(provider);
          const baseUrl = ac.baseUrl;

          let session = Session.load(sid);
          if (!session) session = new Session(sid, process.cwd());

          // Set SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...CORS,
          });

          const send = (data) => {
            if (data == null) return;
            try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
          };

          try {
            const result = await run({
              provider, model, apiKey, baseUrl,
              maxTokens: ac.maxTokens, temperature: ac.temperature,
              messages, tools,
              onStream: (chunk) => {
                if (chunk && typeof chunk === 'string') send({ content: chunk });
              },
              onToolCall: null,
              modelName: model,
            });

            session.messages = result.messages;
            session.save();
            send({ content: '', done: true, msgs: result.messages });
          } catch (e) {
            send({ error: e.message });
          }

          try { res.end(); } catch {}
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS });
    res.end('Not found');
  });

  server.listen(port, host);
}
