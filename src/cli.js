import { existsSync } from 'fs';
import { resolve } from 'path';
import { Session, deleteSession, loadProjectHints } from './session.js';
import { getAgentConfig, getApiKey, setApiKey, getTokenCache, ensureDirs, loadConfig, saveConfig, DATA_DIR } from './config.js';
import { tools } from './tools.js';
import { run } from './agent.js';

const BOLD = '\x1b[1m', DIM = '\x1b[2m', GREEN = '\x1b[32m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m';

function help() {
  console.log(`${BOLD}OpenCode-32${RESET} ${DIM}v1.0.0${RESET}`);
  console.log('');
  console.log(`${BOLD}USAGE${RESET}`);
  console.log('  opencode                      Start interactive TUI');
  console.log('  opencode [options] <prompt>    Run a prompt and exit');
  console.log('  opencode <command> [args]      Run a command');
  console.log('');
  console.log(`${BOLD}OPTIONS${RESET}`);
  console.log('  -p, --prompt <text>       Run a prompt (non-interactive)');
  console.log('  -c, --continue            Continue most recent session');
  console.log('  -m, --model <model>       Model to use (provider/model)');
  console.log('  --agent <name>            Agent to use (from config)');
  console.log('  -d                        Debug mode');
  console.log('  --verbose                 Verbose logging');
  console.log('  -q                        Quiet (no spinner)');
  console.log('  -f, --format <fmt>        Output format (text, json)');
  console.log('  --allowedTools <list>     Comma-separated allowed tools');
  console.log('  --excludedTools <list>    Comma-separated excluded tools');
  console.log('  -cwd <path>               Working directory');
  console.log('  -h, --help                Show help');
  console.log('');
  console.log(`${BOLD}COMMANDS${RESET}`);
  console.log('  run       <prompt>        Run a prompt non-interactively');
  console.log('  continue  [id]            Continue a session');
  console.log('  auth      <provider> [key] Manage API keys');
  console.log('  models                    List available models');
  console.log('  serve     [--port] [--hostname] Start HTTP server');
  console.log('  web                       Start web UI');
  console.log('  mcp                       Start MCP stdio server');
  console.log('  agent     create          Create a custom agent');
  console.log('  stats                     Show token usage');
  console.log('  sessions                  List sessions');
  console.log('  session   delete <id>     Delete a session');
  console.log('  doctor                    Run diagnostics');
  console.log('  version                   Show version');
  console.log('');
  console.log(`${BOLD}ENVIRONMENT${RESET}`);
  console.log('  OPENCODE_MODEL, OPENCODE_<PROVIDER>_API_KEY');
  console.log('  OPENCODE_<PROVIDER>_BASE_URL');
  console.log('  XDG_CONFIG_HOME, OPENCODE_CONFIG_PATH');
  console.log('');
  console.log(`${BOLD}CONFIG${RESET}`);
  console.log('  ~/.config/opencode/opencode.json');
}

function printMarkdown(text) {
  if (!text) return;
  const lines = text.split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inCode = !inCode; console.log(DIM + line + RESET); continue; }
    if (inCode) { console.log(DIM + '  ' + line + RESET); continue; }
    console.log(line.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`).replace(/`(.+?)`/g, `${GREEN}$1${RESET}`));
  }
}

async function runPrompt(prompt, session, opts) {
  const agentName = opts.agent || 'primary';
  const ac = opts.agentConfig || getAgentConfig(agentName);
  const provider = opts.provider || ac.provider;
  const model = opts.model || ac.model;
  const apiKey = opts.apiKey || ac.apiKey || getApiKey(provider);
  const baseUrl = opts.baseUrl || ac.baseUrl;

  const instructions = loadProjectHints(session.cwd);
  session.messages.push({ role: 'user', content: prompt });

  const onStream = opts.tui
    ? (chunk) => { if (chunk) process.stdout.write(chunk); }
    : undefined;

  const onToolCall = opts.tui
    ? async (tc) => {
        const name = tc.function?.name || 'tool';
        let desc = '';
        try { const a = JSON.parse(tc.function?.arguments || '{}'); desc = a.description || a.command || a.path || ''; } catch {}
        process.stdout.write(`\n${DIM}⎿  ${name}${desc ? ': ' + desc : ''}${RESET}\n`);
        if (opts.verbose) process.stdout.write(DIM + tc.function?.arguments?.slice(0, 200) + RESET + '\n');
      }
    : undefined;

  const result = await run({
    provider, model, apiKey, baseUrl,
    maxTokens: ac.maxTokens, temperature: ac.temperature, system: ac.system,
    messages: session.messages, tools,
    onStream, onToolCall, modelName: model,
  });

  session.messages = result.messages;
  session.save();
  return result;
}

export async function cli(argv) {
  ensureDirs();

  if (!argv.length || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    help();
    return;
  }

  if (argv[0] === 'version' || argv[0] === '--version') {
    console.log('1.0.0');
    return;
  }

  // Parse CLI options
  const opts = { tools: null };
  let i = 0;
  while (i < argv.length && argv[i].startsWith('-') && argv[i] !== '--') {
    switch (argv[i]) {
      case '-p': case '--prompt': opts.prompt = argv[++i]; break;
      case '-c': case '--continue': opts.continue = true; break;
      case '-m': case '--model': opts.model = argv[++i]; break;
      case '--agent': opts.agent = argv[++i]; break;
      case '-d': opts.debug = true; break;
      case '--verbose': opts.verbose = true; break;
      case '-q': opts.quiet = true; break;
      case '-f': case '--format': opts.format = argv[++i]; break;
      case '--allowedTools': opts.allowedTools = argv[++i].split(','); break;
      case '--excludedTools': opts.excludedTools = argv[++i].split(','); break;
      case '-cwd': opts.cwd = resolve(argv[++i]); break;
      default: break;
    }
    i++;
  }

  const cmd = argv[i];
  const rest = argv.slice(i + 1);
  const prompt = rest.join(' ');

  // Commands
  if (cmd === 'run') {
    if (!prompt) { console.error('Usage: opencode run <prompt>'); return; }
    const session = new Session(null, opts.cwd || process.cwd());
    await runPrompt(prompt, session, opts);
    const last = session.messages.filter(m => m.role === 'assistant').pop();
    if (last?.content) printMarkdown(last.content);
    return;
  }

  if (cmd === 'continue') {
    const sid = rest[0] || null;
    const session = sid ? Session.load(sid) : Session.recent();
    if (!session) { console.log('No sessions to continue.'); return; }
    if (!prompt) {
      const { startTUI, cleanup } = await import('./tui.js');
      const tui = startTUI({ autoPrompt: true });
      tui.addMessage('assistant', `Resumed session ${session.id}`);
      for (const m of session.messages) {
        if (m.role === 'user') tui.addMessage('user', typeof m.content === 'string' ? m.content : '(tool call)');
        else if (m.role === 'assistant' && m.content && m.content !== '_empty_') tui.addMessage('assistant', m.content);
        else if (m.role === 'tool') tui.addOutput(m.content?.slice(0, 200));
      }
      tui.setStatus(`Session ${session.id}`);
      tui.onMessage(async (msg) => {
        tui.inputActive(false);
        tui.addMessage('user', msg);
        try {
          const result = await runPrompt(msg, session, { ...opts, tui });
          for (const m of result.messages.slice(-1)) {
            if (m.content && m.content !== '_empty_') tui.addMessage('assistant', m.content);
          }
        } catch (e) {
          tui.addChatLine(RED + 'Error: ' + e.message + RESET);
        }
        tui.inputActive(true);
      });
      return;
    }
    await runPrompt(prompt, session, opts);
    const last = session.messages.filter(m => m.role === 'assistant').pop();
    if (last?.content) printMarkdown(last.content);
    return;
  }

  if (cmd === 'auth') {
    const prov = rest[0];
    const key = rest[1];
    if (!prov) {
      console.log('Usage: opencode auth <provider> [api-key]');
      console.log('Providers: openai, anthropic, google, groq, bedrock, ollama, opencode, openrouter');
      const cfg = loadConfig();
      if (cfg.apiKeys) {
        console.log('');
        for (const [p, k] of Object.entries(cfg.apiKeys)) {
          console.log(`  ${p}: ${k.slice(0, 8)}...${k.slice(-4)}`);
        }
      }
      return;
    }
    if (!key) {
      console.log(getApiKey(prov) ? `${prov}: key is set` : `${prov}: no key`);
      return;
    }
    setApiKey(prov, key);
    console.log(`Saved API key for ${prov}`);
    return;
  }

  if (cmd === 'models') {
    const { listProviders } = await import('./providers/index.js');
    const providers = listProviders();
    console.log('Available providers:');
    for (const p of providers) {
      const key = getApiKey(p);
      console.log(`  ${p}${key ? ' ✓' : ''}`);
    }
    const cfg = loadConfig();
    if (cfg.providers) {
      console.log('\nConfigured:');
      for (const [p, c] of Object.entries(cfg.providers)) {
        console.log(`  ${p}: ${c.model || '(default)'}`);
      }
    }
    return;
  }

  if (cmd === 'serve' || cmd === 'web') {
    const { startWeb } = await import('./web.js');
    const port = parseInt(rest[0] || (argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '3000'), 10);
    const host = argv.includes('--hostname') ? argv[argv.indexOf('--hostname') + 1] : '0.0.0.0';
    await startWeb(port, host);
    return;
  }

  if (cmd === 'mcp') {
    const { startMCP } = await import('./mcp.js');
    await startMCP();
    return;
  }

  if (cmd === 'agent' && rest[0] === 'create') {
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));
    console.log('Create a custom agent:');
    const name = await ask('  Name: ');
    const model = await ask('  Model (provider/model): ') || 'opencode/big-pickle';
    const system = await ask('  System prompt (optional): ');
    const maxTokens = await ask('  Max tokens (default 4096): ') || '4096';
    rl.close();
    const cfg = loadConfig();
    if (!cfg.agents) cfg.agents = {};
    cfg.agents[name] = { model, maxTokens: parseInt(maxTokens), system };
    saveConfig(cfg);
    console.log(`Agent '${name}' created. Use: opencode --agent ${name} <prompt>`);
    return;
  }

  if (cmd === 'stats') {
    const tc = getTokenCache();
    console.log(`  Total input:  ${tc.totalInput.toLocaleString()} tokens`);
    console.log(`  Total output: ${tc.totalOutput.toLocaleString()} tokens`);
    console.log(`  Total cost:   $${tc.totalCost.toFixed(4)}`);
    return;
  }

  if (cmd === 'sessions') {
    const sessions = Session.list();
    if (!sessions.length) { console.log('No sessions.'); return; }
    for (const s of sessions) {
      const last = s.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-1)[0];
      const pre = typeof last?.content === 'string' ? last.content.slice(0, 60) : '';
      console.log(`${s.id}  ${new Date(s.updated).toLocaleString()}  ${pre}${pre.length >= 60 ? '...' : ''}`);
    }
    return;
  }

  if (cmd === 'session' && rest[0] === 'delete') {
    const id = rest[1];
    if (!id) { console.log('Usage: opencode session delete <id>'); return; }
    if (deleteSession(id)) console.log('Deleted:', id);
    else console.log('Not found:', id);
    return;
  }

  if (cmd === 'doctor') {
    const rl = await import('./doctor.js');
    await rl.runDoctor();
    return;
  }

  if (cmd === 'cleanup') {
    const { Session } = await import('./session.js');
    const n = Session.cleanup();
    console.log(`Cleaned up ${n} empty sessions.`);
    return;
  }

  // Default: launch TUI or run prompt
  if (opts.continue) {
    const session = Session.recent();
    if (!session) { console.log('No sessions to continue.'); return; }
    const { startTUI, cleanup } = await import('./tui.js');
    const tui = startTUI({ autoPrompt: true });
    tui.addMessage('assistant', `Resumed session ${session.id}`);
    for (const m of session.messages) {
      if (m.role === 'user') tui.addMessage('user', typeof m.content === 'string' ? m.content : '(tool call)');
      else if (m.role === 'assistant' && m.content && m.content !== '_empty_') tui.addMessage('assistant', m.content);
    }
    tui.onMessage(async (msg) => {
      tui.inputActive(false);
      tui.addMessage('user', msg);
      try {
        const result = await runPrompt(msg, session, { ...opts, tui });
        for (const m of result.messages.slice(-1)) {
          if (m.content && m.content !== '_empty_') tui.addMessage('assistant', m.content);
        }
      } catch (e) {
        tui.addChatLine(RED + 'Error: ' + e.message + RESET);
      }
      tui.inputActive(true);
    });
    return;
  }

  if (opts.prompt || prompt) {
    const p = opts.prompt || prompt;
    const session = new Session(null, opts.cwd || process.cwd());
    const result = await runPrompt(p, session, opts);
    const last = result.messages.filter(m => m.role === 'assistant').pop();
    if (opts.format === 'json') {
      console.log(JSON.stringify({ response: last?.content || '', turns: result.turnCount }));
    } else if (last?.content) {
      printMarkdown(last.content);
    }
    return;
  }

  // Launch TUI (like original opencode)
  const { startTUI, cleanup } = await import('./tui.js');
  const tui = startTUI({ autoPrompt: true });
  const session = new Session(null, opts.cwd || process.cwd());
  tui.addChatLine(GREEN + BOLD + 'OpenCode-32' + RESET + DIM + ' — interactive coding agent' + RESET);
  tui.addChatLine(DIM + 'Type a message, /help for commands' + RESET);

  tui.onMessage(async (msg) => {
    tui.inputActive(false);
    tui.addMessage('user', msg);
    try {
      const result = await runPrompt(msg, session, { ...opts, tui });
      for (const m of result.messages.slice(-1)) {
        if (m.content && m.content !== '_empty_') tui.addMessage('assistant', m.content);
      }
    } catch (e) {
      tui.addChatLine(RED + 'Error: ' + e.message + RESET);
    }
    tui.inputActive(true);
  });
}
