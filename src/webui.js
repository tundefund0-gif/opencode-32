import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Session } from './session.js';
import { getApiKey, getModel, getProvider, getBaseUrl, loadConfig, getSystemPrompt } from './config.js';
import { tools } from './tools.js';
import { runAgentLoop } from './agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'webui', 'index.html');

function getHTML() {
  if (existsSync(HTML_PATH)) return readFileSync(HTML_PATH, 'utf-8');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name=viewport content="width=device-width,initial-scale=1"><title>OpenCode-32</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;height:100vh;display:flex;flex-direction:column}
#chat{flex:1;overflow-y:auto;padding:16px}
.msg{margin:8px 0;padding:12px;border-radius:8px;max-width:80%;line-height:1.5}
.msg.user{background:#1f6feb22;margin-left:auto;border:1px solid #1f6feb44}
.msg.assistant{background:#30363d;margin-right:auto}
.msg.system{background:#161b22;color:#8b949e;font-style:italic;text-align:center;font-size:0.9em}
.msg.tool{background:#0d1117;color:#8b949e;font-size:0.85em;border-left:3px solid #30363d;margin-left:16px;font-family:monospace;white-space:pre-wrap}
#input-area{display:flex;padding:12px;border-top:1px solid #30363d;background:#0d1117}
#input{flex:1;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:10px 12px;font-size:14px;outline:none;resize:none}
#input:focus{border-color:#58a6ff}
#send{background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 20px;margin-left:8px;cursor:pointer;font-size:14px}
#send:hover{background:#2ea043}
code{background:#161b22;padding:2px 4px;border-radius:3px;font-size:0.9em}
pre{background:#161b22;padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0;border:1px solid #30363d}
pre code{background:transparent;padding:0}
.thinking{color:#8b949e;font-style:italic;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.settings{position:fixed;top:12px;right:12px;z-index:100}
#settings-btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:#00000088;z-index:200}
.modal.open{display:flex;align-items:center;justify-content:center}
.modal-content{background:#161b22;border-radius:12px;padding:24px;width:90%;max-width:500px;max-height:80vh;overflow-y:auto}
.modal-content h2{margin-bottom:16px}
.form-group{margin-bottom:12px}
.form-group label{display:block;margin-bottom:4px;font-size:13px;color:#8b949e}
.form-group input,.form-group select{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:8px 10px;font-size:14px}
@media(max-width:600px){.msg{max-width:95%}#input-area{flex-direction:column}#send{margin:8px 0 0 0;width:100%}}
</style></head><body>
<div class=settings><button id=settings-btn>⚙ Settings</button></div>
<div id=chat></div>
<div id=input-area><textarea id=input rows=2 placeholder="Type a message..." autofocus></textarea><button id=send>Send</button></div>
<div id=settings-modal class=modal><div class=modal-content><h2>Settings</h2>
<div class=form-group><label>Provider</label><select id=sel-provider>
<option value=opencode>OpenCode (Zen)</option><option value=openai>OpenAI</option><option value=anthropic>Anthropic</option>
<option value=google>Google Gemini</option><option value=groq>Groq</option><option value=ollama>Ollama</option>
<option value=lmstudio>LM Studio</option><option value=openrouter>OpenRouter</option></select></div>
<div class=form-group><label>Model</label><input id=sel-model placeholder="e.g. gpt-4o"></div>
<div class=form-group><label>API Key</label><input id=sel-apikey type=password placeholder="Leave blank to use config"></div>
<div class=form-group><label>Base URL (optional)</label><input id=sel-baseurl placeholder="Custom API endpoint"></div>
<button id=settings-close style="background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;margin-top:8px">Save</button>
</div></div>
<script>
let sessionId=null,messages=[],streaming=false
const chat=document.getElementById('chat'),input=document.getElementById('input')
const sendBtn=document.getElementById('send'),settingsBtn=document.getElementById('settings-btn')
const modal=document.getElementById('settings-modal'),closeBtn=document.getElementById('settings-close')
const selProvider=document.getElementById('sel-provider'),selModel=document.getElementById('sel-model')
const selApikey=document.getElementById('sel-apikey'),selBaseurl=document.getElementById('sel-baseurl')
function addMsg(role,content){const d=document.createElement('div');d.className='msg '+role
if(role==='assistant'&&!content){d.className='msg assistant thinking';d.innerHTML='Thinking...'}else d.textContent=content
chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d}
async function send(){
if(streaming||!input.value.trim())return;streaming=true
const text=input.value.trim();input.value=''
addMsg('user',text);messages.push({role:'user',content:text})
const thinkEl=addMsg('assistant','')
let fullContent=''
const bc=new BroadcastChannel('opencode-web'),sessionId=sessionId||Date.now().toString(36)
const params=new URLSearchParams({provider:selProvider.value,model:selModel.value,apikey:selApikey.value,baseurl:selBaseurl.value,sessionId})
try{
const res=await fetch('/chat?'+params.toString(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages})})
if(!res.ok){const e=await res.text();addMsg('system','Error: '+e);streaming=false;return}
const reader=res.body.getReader(),decoder=new TextDecoder()
let buffer=''
while(true){const{done,value}=await reader.read();if(done)break
buffer+=decoder.decode(value,{stream:true})
const lines=buffer.split('\n');buffer=lines.pop()||''
for(const line of lines){if(!line.startsWith('data: '))continue
const d=line.slice(6)
if(d==='[DONE]'){streaming=false;thinkEl.className='msg assistant';break}
try{const j=JSON.parse(d)
if(j.error){addMsg('system','Error: '+j.error);streaming=false;break}
if(j.content){fullContent+=j.content;thinkEl.textContent=fullContent;chat.scrollTop=chat.scrollHeight}
if(j.done){messages=j.messages;streaming=false;thinkEl.className='msg assistant'}}catch{}}}
}catch(err){addMsg('system','Error: '+err.message);streaming=false}
}
sendBtn.onclick=send
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}})
settingsBtn.onclick=()=>modal.classList.add('open')
closeBtn.onclick=()=>modal.classList.remove('open')
modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open')}
fetch('/config').then(r=>r.json()).then(c=>{selProvider.value=c.provider||'opencode';selModel.value=c.modelName||''})
</script></body></html>`;
}

export async function startWebUI(port) {
  const html = getHTML();
  const http = await import('http');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider: getProvider(), modelName: getModel().split('/')[1] || getModel() }));
      return;
    }

    if (url.pathname === '/chat' && req.method === 'POST') {
      const provider = url.searchParams.get('provider') || getProvider();
      const model = url.searchParams.get('model') || getModel().split('/')[1] || getModel();
      const apiKey = url.searchParams.get('apikey') || getApiKey(provider);
      const baseUrl = url.searchParams.get('baseurl') || getBaseUrl(provider);
      const sid = url.searchParams.get('sessionId') || Date.now().toString(36);

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { messages } = JSON.parse(body);
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });

          let session = Session.load(sid);
          if (!session) { session = new Session(sid, process.cwd()); }

          const allMessages = [...messages];

          const sendEvent = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          };

          try {
            const result = await runAgentLoop({
              provider, model, apiKey, baseUrl,
              messages: allMessages, tools,
              onStream: (chunk) => {
                if (chunk.content) sendEvent({ content: chunk.content });
                if (chunk.done) sendEvent({ content: '', done: true, messages: result?.messages || allMessages });
              },
              onToolCall: null,
              modelName: model,
            });

            session.messages = result.messages;
            session.save();
            sendEvent({ content: '', done: true, messages: result.messages });
          } catch (err) {
            sendEvent({ error: err.message });
          }
          res.end();
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`\n  OpenCode-32 Web UI → http://localhost:${port}\n`);
      resolve(server);
    });
  });
}
