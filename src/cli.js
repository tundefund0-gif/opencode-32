import { existsSync } from 'fs';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { Session, deleteSession, loadProjectInstructions } from './session.js';
import { getApiKey, setApiKey, getModel, setModel, getProvider, getBaseUrl, getTokenCache, ensureConfigDir, getConfigPath, getConfigDir, loadConfig } from './config.js';
import { tools } from './tools.js';
import { runAgentLoop } from './agent.js';

const BOLD = '\x1b[1m', DIM = '\x1b[2m', GREEN = '\x1b[32m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m';

function printHelp() {
  const help = `OpenCode-32 — AI coding agent for 32-bit ARM

${BOLD}USAGE${RESET}
  opencode <command> [options]

${BOLD}COMMANDS${RESET}
  <prompt>               Quick task (single-shot)
  exec <prompt>          Execute task with agent loop
  resume [id]            Resume a session
  fork [id]              Fork a session
  web                    Start web UI
  mcp                    Start MCP stdio server
  auth <provider>        Set API key for a provider
  model <name>           Set model (provider/name)
  doctor                 Run diagnostics
  list                   List sessions
  delete <id>            Delete a session
  cleanup                Remove empty sessions
  stats                  Show token usage stats

${BOLD}OPTIONS${RESET}
  --model <name>         Model to use (e.g. openai/gpt-4o)
  --provider <name>      Provider (openai, anthropic, google, groq, bedrock, ollama, lmstudio, opencode, openrouter)
  --api-key <key>        API key
  --base-url <url>       Custom base URL
  -y                     Auto-confirm dangerous operations
  --help, -h             Show this help

${BOLD}ENVIRONMENT${RESET}
  OPENCODE_API_KEY, OPENCODE_<PROVIDER>_API_KEY
  OPENCODE_MODEL         Model string (e.g. openai/gpt-4o)
  OPENCODE_<PROVIDER>_BASE_URL
  OPENCODE_CONFIG_DIR    Config directory (default ~/.config/opencode)
  OPENCODE_MAX_TOKENS    Max tokens per response (default 4096)
  OPENCODE_TEMPERATURE   Temperature (default 0.3)

${BOLD}EXAMPLES${RESET}
  opencode "list files in current dir"
  opencode exec "create a todo app" --model openai/gpt-4o
  opencode resume
  opencode auth openai sk-proj-xxx
  opencode web
  opencode doctor
  opencode stats`;
  console.log(help);
}

function printMarkdown(text) {
  if (!text) return;
  const lines = text.split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inCode = !inCode; console.log(DIM + line + RESET); continue; }
    if (inCode) { console.log(DIM + '  ' + line + RESET); continue; }
    const rendered = line
      .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
      .replace(/`(.+?)`/g, `${GREEN}$1${RESET}`)
      .replace(/^### (.+)/, `${YELLOW}$1${RESET}`)
      .replace(/^## (.+)/, `${CYAN}$1${RESET}`)
      .replace(/^# (.+)/, `${BOLD}$1${RESET}`);
    console.log(rendered);
  }
}

function printThinking(text) {
  if (!text) return;
  console.log(DIM + '🤔 ' + text.replace(/\n/g, '\n   ') + RESET);
}

async function runTerminal(prompt, session, { apiKey, baseUrl, model }) {
  const cwd = session.cwd;
  const provider = getProvider();
  const modelName = model || getModel();
  const parts = modelName.split('/');
  const providerName = provider || parts[0] || 'opencode';
  const mName = parts[1] || parts[0];
  const key = apiKey || getApiKey(providerName) || getApiKey('opencode');
  const bUrl = baseUrl || getBaseUrl(providerName);
  const instructions = loadProjectInstructions(cwd);

  session.messages.push({ role: 'user', content: prompt });

  const onStream = ({ content, done }) => {
    if (content) process.stdout.write(content);
    if (done) process.stdout.write('\n');
  };

  const onToolCall = async (tc) => {
    const name = tc.function?.name || tc.tool_name || 'tool';
    const args = tc.function?.arguments || '{}';
    let desc = '';
    try { const a = JSON.parse(typeof args === 'string' ? args : '{}'); desc = a.description || a.command || a.path || ''; } catch {}
    process.stdout.write(`\n${DIM}⎿  using ${name}${desc ? ': ' + desc : ''}${RESET}\n`);
  };

  try {
    const result = await runAgentLoop({
      provider: providerName, model: mName, apiKey: key, baseUrl: bUrl,
      messages: session.messages, tools, onStream, onToolCall, modelName: mName,
    });
    session.messages = result.messages;
    session.save();
    printStats(result.turnCount);
  } catch (err) {
    console.error(`\n${RED}Error:${RESET} ${err.message}`);
    process.exit(1);
  }
}

function printStats(turns) {
  const tc = getTokenCache();
  console.log(DIM + `— ${turns} turn(s), ${(tc.totalInput + tc.totalOutput).toLocaleString()} tokens total, $${tc.totalCost.toFixed(4)} cost${RESET}`);
}

export async function cli(args) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') { printHelp(); return; }

  ensureConfigDir();

  let i = 0;
  const opts = {};
  while (i < args.length) {
    if (args[i] === '--model') opts.model = args[++i];
    else if (args[i] === '--provider') opts.provider = args[++i];
    else if (args[i] === '--api-key') opts.apiKey = args[++i];
    else if (args[i] === '--base-url') opts.baseUrl = args[++i];
    else if (args[i] === '-y') opts.yes = true;
    else break;
    i++;
  }

  const cmd = args[i];
  const rest = args.slice(i + 1);
  const prompt = rest.join(' ');

  switch (cmd) {
    case 'exec': {
      if (!prompt) { console.error('Error: no prompt provided'); process.exit(1); }
      const session = new Session(null, process.cwd());
      await runTerminal(prompt, session, opts);
      break;
    }

    case 'resume': {
      const sessions = Session.list(process.cwd());
      if (!sessions.length) { console.log('No sessions found.'); return; }
      let session;
      if (rest[0]) {
        session = Session.load(rest[0]);
        if (!session) { console.error('Session not found:', rest[0]); process.exit(1); }
      } else {
        session = sessions[0];
      }
      const cwd = session.cwd || process.cwd();
      const lastMsg = session.messages.filter(m => m.role !== 'system' && m.role !== 'tool').slice(-1)[0];
      if (lastMsg) console.log(`${DIM}Previous: ${typeof lastMsg.content === 'string' ? lastMsg.content.substring(0, 100) + (lastMsg.content.length > 100 ? '...' : '') : ''}${RESET}`);
      session.save();
      console.log(`${DIM}Resumed session ${session.id.substring(0, 8)}...${RESET}`);
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      const ask = () => {
        rl.question(`\n${CYAN}>>>${RESET} `, async (input) => {
          if (input === 'exit' || input === 'quit') { rl.close(); return; }
          await runTerminal(input, session, opts);
          ask();
        });
      };
      ask();
      return;
    }

    case 'fork': {
      const sessions = Session.list(process.cwd());
      if (!sessions.length) { console.log('No sessions to fork.'); return; }
      const srcId = rest[0] || sessions[0].id;
      const src = Session.load(srcId);
      if (!src) { console.error('Session not found:', srcId); process.exit(1); }
      const fork = new Session(null, process.cwd());
      fork.messages = src.messages.slice(0, -1);
      fork.save();
      console.log(`Forked session ${fork.id.substring(0, 8)}... from ${srcId.substring(0, 8)}...`);
      break;
    }

    case 'web': {
      const { startWebUI } = await import('./webui.js');
      const port = parseInt(rest[0] || '3000', 10);
      await startWebUI(port);
      break;
    }

    case 'mcp': {
      const { startMCPServer } = await import('./mcp-server.js');
      await startMCPServer();
      break;
    }

    case 'auth': {
      const providerArg = rest[0];
      const keyArg = rest[1];
      if (!providerArg || !keyArg) {
        console.log('Usage: opencode auth <provider> <api-key>');
        console.log('Providers: openai, anthropic, google, groq, bedrock, opencode, openrouter');
        console.log('Current keys:');
        const cfg = loadConfig();
        for (const [p, k] of Object.entries(cfg.apiKeys || {})) {
          console.log(`  ${p}: ${k.substring(0, 8)}...${k.substring(k.length - 4)}`);
        }
        return;
      }
      setApiKey(providerArg, keyArg);
      console.log(`Saved API key for ${providerArg}`);
      break;
    }

    case 'model': {
      if (!rest[0]) {
        console.log(`Current model: ${getModel()}`);
        console.log(`Usage: opencode model <provider/model-name>`);
        return;
      }
      setModel(rest[0]);
      console.log(`Model set to ${rest[0]}`);
      break;
    }

    case 'doctor': {
      const { runDoctor } = await import('./doctor.js');
      await runDoctor();
      break;
    }

    case 'list': {
      const sessions = Session.list(process.cwd());
      if (!sessions.length) { console.log('No sessions.'); return; }
      for (const s of sessions) {
        const last = s.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-1)[0];
        const preview = typeof last?.content === 'string' ? last.content.substring(0, 60) : '(empty)';
        console.log(`${s.id.substring(0, 8)}  ${new Date(s.updated).toLocaleString()}  ${preview}${preview.length >= 60 ? '...' : ''}`);
      }
      break;
    }

    case 'delete': {
      if (!rest[0]) { console.error('Usage: opencode delete <session-id>'); return; }
      if (deleteSession(rest[0])) console.log('Deleted:', rest[0].substring(0, 8));
      else console.log('Not found:', rest[0].substring(0, 8));
      break;
    }

    case 'cleanup': {
      const count = Session.cleanup();
      console.log(`Cleaned up ${count} empty sessions.`);
      break;
    }

    case 'stats': {
      const tc = getTokenCache();
      console.log(`Tokens: ${tc.totalInput.toLocaleString()} input, ${tc.totalOutput.toLocaleString()} output`);
      console.log(`Total cost: $${tc.totalCost.toFixed(4)}`);
      break;
    }

    default: {
      const prompt = args.join(' ');
      if (!prompt) { printHelp(); return; }
      const session = new Session(null, process.cwd());
      await runTerminal(prompt, session, opts);
    }
  }
}
