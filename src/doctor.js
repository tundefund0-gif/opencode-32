import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { CONFIG_DIR, DATA_DIR, loadConfig } from './config.js';

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m';

function ok(m) { console.log(`  ${GREEN}✓${RESET} ${m}`); }
function warn(m) { console.log(`  ${YELLOW}⚠${RESET} ${m}`); }
function fail(m) { console.log(`  ${RED}✗${RESET} ${m}`); }

export async function runDoctor() {
  console.log(`\n${BOLD}OpenCode-32 Diagnostics${RESET}\n`);

  const v = process.version;
  const major = parseInt(v.slice(1).split('.')[0], 10);
  (major >= 18 ? ok : fail)(`Node.js ${v} (need >= 18)`);

  ok(`${process.platform} ${process.arch}`);

  (existsSync(CONFIG_DIR) ? ok : warn)(`Config dir: ${CONFIG_DIR}`);
  (existsSync(DATA_DIR) ? ok : warn)(`Data dir: ${DATA_DIR}`);

  const cfg = loadConfig();
  const keys = cfg.apiKeys ? Object.keys(cfg.apiKeys) : [];
  if (keys.length) ok(`${keys.length} API key(s) configured`);
  else warn('No API keys configured');

  if (cfg.agents) ok(`${Object.keys(cfg.agents).length} agent(s) configured`);
  else warn('No custom agents');

  try {
    const hasRg = existsSync('/usr/bin/rg') || existsSync('/data/data/com.termux/files/usr/bin/rg');
    (hasRg ? ok : warn)('ripgrep ' + (hasRg ? 'available' : '(fallback to grep)'));
  } catch { warn('ripgrep check failed'); }

  try {
    execSync('which node', { encoding: 'utf-8', timeout: 2000 });
    ok('node in PATH');
  } catch { warn('node PATH check failed'); }

  try {
    const ollama = execSync('curl -sf http://localhost:11434/api/tags >/dev/null 2>&1 || wget -q http://localhost:11434/api/tags -O /dev/null 2>&1', { timeout: 2000 });
    ok('Ollama running');
  } catch { warn('Ollama not detected'); }

  try {
    const gh = execSync('gh --version 2>/dev/null', { encoding: 'utf-8', timeout: 2000 });
    ok('GitHub CLI: ' + gh.split('\n')[0]);
  } catch { warn('GitHub CLI not found'); }

  try {
    const res = await fetch('https://opencode.ai/zen/v1/models', { signal: AbortSignal.timeout(5000) });
    ok(`opencode.ai reachable (${res.status})`);
  } catch { warn('opencode.ai unreachable (check network)'); }

  console.log('');
}
