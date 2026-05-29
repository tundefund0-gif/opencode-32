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

function getHTML() {
  try {
    if (existsSync(HTML_PATH)) return readFileSync(HTML_PATH, 'utf-8');
  } catch {}
  // Minimal fallback
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name=viewport content="width=device-width,initial-scale=1"><title>OC32</title><style>body{font-family:sans-serif;background:#0d1117;color:#c9d1d9;display:flex;flex-direction:column;height:100vh;margin:0}#chat{flex:1;overflow-y:auto;padding:16px}.msg{padding:10px;margin:6px 0;border-radius:8px;max-width:80%}.us{margin-left:auto;background:#1f6feb22;border:1px solid #1f6feb44}.ai{background:#30363d}#bar{display:flex;padding:12px;border-top:1px solid #30363d;gap:8px}#inp{flex:1;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:10px;font-size:14px}#btn{background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 20px;cursor:pointer}</style></head><body><div id=chat></div><div id=bar><textarea id=inp rows=2 placeholder="Type..." autofocus></textarea><button id=btn>Send</button></div><script>let msgs=[],sid=Date.now().toString(36),chat=document.getElementById("chat"),inp=document.getElementById("inp"),btn=document.getElementById("btn");function add(r,c){let d=document.createElement("div");d.className="msg "+(r==="user"?"us":"ai");d.textContent=c;chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d}btn.onclick=async()=>{let t=inp.value.trim();if(!t)return;inp.value="";add("user",t);msgs.push({role:"user",content:t});let ta=add("ai","Thinking..."),full="";try{let r=await fetch("/chat?sid="+sid,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:msgs})});if(!r.ok){ta.textContent="Error "+(await r.text());return}let rd=r.body.getReader(),dc=new TextDecoder(),buf="";while(true){let{done,value}=await rd.read();if(done)break;buf+=dc.decode(value,{stream:true});let ls=buf.split("\n");buf=ls.pop()||"";for(let l of ls){if(!l.startsWith("data: "))continue;let d=l.slice(6);if(d==="[DONE]")break;try{let j=JSON.parse(d);if(j.error){ta.textContent="Error: "+j.error;break}if(j.content){full+=j.content;ta.textContent=full}if(j.done){msgs=j.msgs||msgs;ta.className="msg ai"}}catch{}}}}catch(e){ta.textContent="Error: "+e.message}};inp.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();btn.onclick()}})</script></body></html>';
}

export async function startWeb(port, host) {
  const html = getHTML();
  console.log(`\n  OpenCode-32 Web → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    // CORS headers for all responses
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cors });
      res.end(html);
      return;
    }

    if (url.pathname === '/config') {
      const ac = getAgentConfig();
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ provider: ac.provider, model: ac.model }));
      return;
    }

    if (url.pathname === '/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { messages } = JSON.parse(body);
          const sid = url.searchParams.get('sid') || Date.now().toString(36);
          const modelParam = url.searchParams.get('model');
          const keyParam = url.searchParams.get('key');
          const ac = getAgentConfig();

          const provider = ac.provider;
          const model = modelParam || ac.model;
          const apiKey = keyParam || ac.apiKey || getApiKey(provider);
          const baseUrl = ac.baseUrl;

          let session = Session.load(sid);
          if (!session) session = new Session(sid, process.cwd());

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...cors,
          });

          const send = (data) => {
            if (data === null || data === undefined) return;
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          };

          try {
            const result = await run({
              provider, model, apiKey, baseUrl,
              maxTokens: ac.maxTokens, temperature: ac.temperature,
              messages, tools,
              onStream: (chunk) => { if (chunk) send({ content: chunk }); },
              onToolCall: null, modelName: model,
            });
            session.messages = result.messages;
            session.save();
            send({ content: '', done: true, msgs: result.messages });
          } catch (e) { send({ error: e.message }); }
          res.end();
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain', ...cors });
    res.end('Not found');
  });

  server.listen(port, host);
}
