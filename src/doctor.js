import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { getConfigDir, getDataDir, loadConfig } from './config.js';

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function ok(msg) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); }

function check(label, fn) {
  process.stdout.write(` ${label}: `);
  try { const [s, m] = fn(); s ? ok(m || label) : warn(m || label); } catch (e) { fail(e.message); }
}

export async function runDoctor() {
  console.log(`\n${BOLD}OpenCode-32 Diagnostics${RESET}\n`);

  check('Node.js', () => {
    const v = process.version;
    const major = parseInt(v.slice(1).split('.')[0], 10);
    if (major < 18) return [false, `${v} (need >= 18)`];
    return [true, v];
  });

  check('Architecture', () => {
    const arch = process.arch;
    const platform = process.platform;
    return [true, `${platform} ${arch}`];
  });

  check('Config dir', () => {
    const d = getConfigDir();
    return [existsSync(d), d];
  });

  check('Config file', () => {
    const p = join(getConfigDir(), 'opencode.json');
    if (!existsSync(p)) return [false, 'not found'];
    const cfg = loadConfig();
    const keys = Object.keys(cfg.apiKeys || {});
    return [true, `${keys.length} key(s) configured`];
  });

  check('Network', async () => {
    try {
      const res = await fetch('https://opencode.ai/zen/v1/models', { signal: AbortSignal.timeout(5000) });
      return [true, `opencode.ai reachable (${res.status})`];
    } catch {
      return [false, 'opencode.ai unreachable'];
    }
  });

  check('Ollama', () => {
    try {
      execSync('curl -sf http://localhost:11434/api/tags >/dev/null 2>&1 || wget -q http://localhost:11434/api/tags -O /dev/null 2>&1', { timeout: 2000 });
      return [true, 'running'];
    } catch { return [false, 'not detected']; }
  });

  check('GitHub CLI', () => {
    try {
      const v = execSync('gh --version 2>/dev/null', { encoding: 'utf-8', timeout: 2000 });
      return [true, v.split('\n')[0]];
    } catch { return [false, 'gh not found']; }
  });

  check('Ripgrep', () => {
    const has = existsSync('/usr/bin/rg') || existsSync('/data/data/com.termux/files/usr/bin/rg');
    return [has, has ? 'available' : 'not found (fallback to grep)'];
  });

  check('Disk space', () => {
    try {
      const out = execSync('df -h / | tail -1', { encoding: 'utf-8', timeout: 2000 });
      const parts = out.trim().split(/\s+/);
      return [true, `${parts[3]} free on /`];
    } catch { return [true, 'unknown']; }
  });

  check('Temp dir', () => {
    const d = '/tmp/opencode';
    if (!existsSync(d)) {
      try { execSync('mkdir -p /tmp/opencode'); return [true, 'created']; } catch { return [false, 'cannot create']; }
    }
    return [true, 'exists'];
  });

  console.log('');
}
