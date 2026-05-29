import { resolve } from 'path';
import { Session, deleteSession, loadProjectHints } from './session.js';
import { getAgentConfig, getApiKey, setApiKey, getTokenCache, ensureDirs, loadConfig, saveConfig } from './config.js';
import { tools } from './tools.js';
import { run } from './agent.js';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', C = '\x1b[36m', Y = '\x1b[33m', Rr = '\x1b[31m', R = '\x1b[0m';

function help() {
  console.log(`opencode [options] <prompt>`);
  console.log(`opencode <command> [args]`);
  console.log('');
  console.log(`Commands:`);
  console.log(`  (no args)       Start interactive TUI`);
  console.log(`  run <prompt>    Run a prompt (non-interactive)`);
  console.log(`  continue [id]   Continue a session`);
  console.log(`  auth [p] [k]    Manage API keys`);
  console.log(`  models          List configured providers`);
  console.log(`  serve           Start HTTP server`);
  console.log(`  web             Start web UI`);
  console.log(`  mcp             Start MCP server`);
  console.log(`  sessions        List sessions`);
  console.log(`  session del <id> Delete session`);
  console.log(`  stats           Token usage`);
  console.log(`  doctor          Run diagnostics`);
  console.log(`  cleanup         Remove empty sessions`);
  console.log(`  help            Show this message`);
  console.log('');
  console.log(`Options:`);
  console.log(`  -p, --prompt <text>    Run a prompt`);
  console.log(`  -c, --continue         Continue last session`);
  console.log(`  -m, --model <model>    Model (provider/model)`);
  console.log(`  --agent <name>         Agent from config`);
  console.log(`  -f, --format <fmt>     Output format (text, json)`);
  console.log(`  -h, --help             Show help`);
  console.log('');
  console.log(`Config: ~/.config/opencode/opencode.json`);
  console.log(`Env:    OPENCODE_MODEL, OPENCODE_<P>_API_KEY`);
}

async function runPrompt(prompt, session, opts) {
  const ac = opts.agentConfig || getAgentConfig(opts.agent || 'primary');
  const provider = opts.provider || ac.provider;
  const model = opts.model || ac.model;
  const apiKey = opts.apiKey || ac.apiKey || getApiKey(provider);
  const baseUrl = opts.baseUrl || ac.baseUrl;

  const hints = loadProjectHints(session.cwd);
  session.messages.push({ role: 'user', content: prompt });

  // If caller provides onStream (e.g. TUI streaming), use it
  const onStream = opts.onStream || (opts.tui ? undefined : (chunk) => { if (chunk) process.stdout.write(chunk); });
  const onToolCall = opts.onToolCall || (opts.tui ? undefined : async (tc) => {
    const name = tc.function?.name || 'tool';
    let desc = '';
    try { const a = JSON.parse(tc.function?.arguments || '{}'); desc = a.description || a.command || a.path || ''; } catch {}
    process.stdout.write(`\n${D}⎿  ${name}${desc ? ': ' + desc : ''}${R}\n`);
  });

  const result = await run({
    provider, model, apiKey, baseUrl,
    maxTokens: ac.maxTokens, temperature: ac.temperature, system: ac.system,
    messages: session.messages, tools,
    onStream, onToolCall, onToolResult: opts.onToolResult, modelName: model,
  });

  session.messages = result.messages;
  session.save();
  return result;
}

export async function cli(argv) {
  ensureDirs();

  // help
  if (argv.includes('-h') || argv.includes('--help') || argv[0] === 'help') {
    help();
    return;
  }

  // version
  if (argv.includes('--version') || argv[0] === 'version') {
    console.log('1.0.0');
    return;
  }

  // Parse flags
  const flags = { tools: null };
  let i = 0;
  while (i < argv.length && argv[i].startsWith('-') && argv[i] !== '--') {
    switch (argv[i]) {
      case '-p': case '--prompt': flags.prompt = argv[++i]; break;
      case '-c': case '--continue': flags.cont = true; break;
      case '-m': case '--model': flags.model = argv[++i]; break;
      case '--agent': flags.agent = argv[++i]; break;
      case '-f': case '--format': flags.format = argv[++i]; break;
      case '-cwd': flags.cwd = resolve(argv[++i]); break;
      case '-d': flags.debug = true; break;
      case '--verbose': flags.verbose = true; break;
      case '-q': flags.quiet = true; break;
      case '--allowedTools': flags.allowedTools = argv[++i].split(','); break;
      case '--excludedTools': flags.excludedTools = argv[++i].split(','); break;
    }
    i++;
  }

  const cmd = argv[i];
  const rest = argv.slice(i + 1);
  const prompt = rest.join(' ');

  // --- Commands ---

  if (cmd === 'run') {
    if (!prompt) { console.log('Usage: opencode run <prompt>'); return; }
    const session = new Session(null, flags.cwd || process.cwd());
    const result = await runPrompt(prompt, session, flags);
    const last = result.messages.filter(m => m.role === 'assistant').pop();
    if (last?.content) console.log(last.content);
    return;
  }

  if (cmd === 'continue') {
    const sid = rest[0] || null;
    const session = sid ? Session.load(sid) : Session.recent();
    if (!session) { console.log('No sessions found.'); return; }
    if (prompt) {
      await runPrompt(prompt, session, flags);
      const last = session.messages.filter(m => m.role === 'assistant').pop();
      if (last?.content) console.log(last.content);
      return;
    }
    // Interactive continue
    await runTUI(session, flags);
    return;
  }

  if (cmd === 'auth') {
    const p = rest[0];
    const k = rest[1];
    if (!p) {
      console.log('Usage: opencode auth <provider> [api-key]');
      console.log('Providers: openai, anthropic, google, groq, bedrock, ollama, opencode, openrouter');
      const cfg = loadConfig();
      if (cfg.apiKeys) {
        console.log('');
        for (const [prov, key] of Object.entries(cfg.apiKeys)) {
          console.log(`  ${prov}: ${key.slice(0, 8)}...${key.slice(-4)}`);
        }
      }
      return;
    }
    if (!k) {
      console.log(getApiKey(p) ? `${p}: key set` : `${p}: no key`);
      return;
    }
    setApiKey(p, k);
    console.log(`Saved API key for ${p}`);
    return;
  }

  if (cmd === 'models') {
    // Show configured providers
    const cfg = loadConfig();
    const known = ['openai', 'anthropic', 'google', 'groq', 'bedrock', 'ollama', 'lmstudio', 'opencode', 'openrouter', 'deepseek', 'together', 'fireworks'];
    if (cfg.apiKeys) {
      console.log('Providers with keys:');
      for (const [p] of Object.entries(cfg.apiKeys)) {
        console.log(`  ${p} ✓`);
      }
    }
    if (cfg.providers) {
      console.log('\nConfigured:');
      for (const [p, c] of Object.entries(cfg.providers)) {
        console.log(`  ${p}: ${c.model || '(default)'}`);
      }
    }
    if (!cfg.apiKeys && !cfg.providers) {
      console.log('No providers configured. Use: opencode auth <provider> <api-key>');
    }
    return;
  }

  if (cmd === 'serve' || cmd === 'web') {
    const { startWeb } = await import('./web.js');
    const portIdx = argv.indexOf('--port');
    const port = parseInt(portIdx >= 0 ? argv[portIdx + 1] : (rest[0] || '3000'), 10);
    const hostIdx = argv.indexOf('--hostname');
    const host = hostIdx >= 0 ? argv[hostIdx + 1] : '0.0.0.0';
    await startWeb(port, host);
    return;
  }

  if (cmd === 'mcp') {
    const { startMCP } = await import('./mcp.js');
    await startMCP();
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

  if (cmd === 'session' && (rest[0] === 'delete' || rest[0] === 'del')) {
    const id = rest[1];
    if (!id) { console.log('Usage: opencode session delete <id>'); return; }
    if (deleteSession(id)) console.log('Deleted:', id);
    else console.log('Not found:', id);
    return;
  }

  if (cmd === 'stats') {
    const tc = getTokenCache();
    console.log(`  Input tokens:  ${tc.totalInput.toLocaleString()}`);
    console.log(`  Output tokens: ${tc.totalOutput.toLocaleString()}`);
    console.log(`  Total cost:    $${tc.totalCost.toFixed(4)}`);
    return;
  }

  if (cmd === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    await runDoctor();
    return;
  }

  if (cmd === 'cleanup') {
    const n = Session.cleanup();
    console.log(`Cleaned ${n} empty sessions.`);
    return;
  }

  if (cmd === 'agent' && rest[0] === 'create') {
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));
    console.log('Create agent:');
    const name = await ask('  Name: ');
    const model = await ask('  Model (provider/model): ') || 'opencode/big-pickle';
    const system = await ask('  System prompt: ');
    const maxTokens = await ask('  Max tokens: ') || '4096';
    rl.close();
    const cfg = loadConfig();
    if (!cfg.agents) cfg.agents = {};
    cfg.agents[name] = { model, maxTokens: parseInt(maxTokens), system };
    saveConfig(cfg);
    console.log(`Agent '${name}' created.`);
    return;
  }

  // --- Non-interactive mode (-p flag or direct prompt) ---
  if (flags.cont) {
    const session = Session.recent();
    if (!session) { console.log('No sessions.'); return; }
    if (flags.prompt || prompt) {
      const p = flags.prompt || prompt;
      await runPrompt(p, session, flags);
      const last = session.messages.filter(m => m.role === 'assistant').pop();
      if (last?.content) console.log(last.content);
      return;
    }
    await runTUI(session, flags);
    return;
  }

  if (flags.prompt || prompt) {
    const p = flags.prompt || prompt;
    const session = new Session(null, flags.cwd || process.cwd());
    const result = await runPrompt(p, session, flags);
    const last = result.messages.filter(m => m.role === 'assistant').pop();
    if (flags.format === 'json') {
      console.log(JSON.stringify({ response: last?.content || '', turns: result.turnCount }));
    } else if (last?.content) {
      console.log(last.content);
    }
    return;
  }

  // --- Launch TUI (no args) ---
  const session = new Session(null, flags.cwd || process.cwd());
  await runTUI(session, flags);
}

async function runTUI(session, flags) {
  const { startTUI } = await import('./tui.js');
  const tui = startTUI({
    autoPrompt: true,
    onMessage: async (msg) => {
      tui.addMessage('user', msg);
      let streamUpdater = tui.startStream('assistant');
      const seenTools = new Set();
      try {
        const result = await runPrompt(msg, session, {
          ...flags, tui: true,
          onStream: (chunk) => { streamUpdater(chunk); },
          onToolCall: async (tc) => {
            tui.endStream();
            const name = tc.function?.name || 'tool';
            let brief = '';
            try {
              const a = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
              brief = a.command || a.path || a.description || a.url || '';
            } catch {}
            tui.addOutput(`→ ${name}${brief ? ': ' + brief : ''}`);
            streamUpdater = tui.startStream('assistant');
          },
          onToolResult: async (tc, result) => {
            const id = tc.id || tc.function?.name || 'tool';
            if (seenTools.has(id)) return;
            seenTools.add(id);
            let brief = '';
            if (typeof result.content === 'string') {
              brief = result.content.replace(/\s+/g, ' ').trim();
              if (brief.length > 80) brief = brief.slice(0, 80) + '...';
            }
            if (result.isError) {
              tui.addOutput(`  ⎋ Error: ${brief || 'tool failed'}`);
            } else if (brief) {
              tui.addOutput(`  ↳ ${brief}`);
            }
          },
        });
        tui.endStream();
        // Show any tool results that weren't streamed
        for (const m of result.messages) {
          if (m.role === 'tool') {
            const id = m.tool_call_id || 'tool';
            if (!seenTools.has(id)) {
              seenTools.add(id);
              let brief = '';
              if (typeof m.content === 'string') {
                brief = m.content.replace(/\s+/g, ' ').trim();
                if (brief.length > 80) brief = brief.slice(0, 80) + '...';
              }
              if (m.isError) tui.addOutput(`  ⎋ Error: ${brief || 'tool failed'}`);
              else if (brief) tui.addOutput(`  ↳ ${brief}`);
            }
          }
        }
      } catch (e) {
        tui.endStream();
        tui.addChatLine(Rr + 'Error: ' + e.message + R);
      }
    },
  });
  await new Promise(() => {});
}
