import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SESSIONS_DIR } from './config.js';

export class Session {
  constructor(id, cwd) {
    this.id = id || randomUUID().slice(0, 12);
    this.cwd = cwd || process.cwd();
    this.messages = [];
    this.created = Date.now();
    this.updated = Date.now();
    this.metadata = {};
  }

  get path() { return join(SESSIONS_DIR, this.id + '.json'); }

  save() {
    this.updated = Date.now();
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(this.path, JSON.stringify({
      id: this.id, cwd: this.cwd, created: this.created, updated: this.updated,
      metadata: this.metadata, messages: this.messages,
    }, null, 2));
  }

  static load(id) {
    if (!id) return null;
    const p = join(SESSIONS_DIR, id + '.json');
    if (!existsSync(p)) {
      const alt = readdirSync(SESSIONS_DIR).find(f => f.startsWith(id));
      if (!alt) return null;
      return Session.load(alt.replace('.json', ''));
    }
    try {
      const d = JSON.parse(readFileSync(p, 'utf-8'));
      const s = new Session(d.id, d.cwd);
      s.messages = d.messages || [];
      s.created = d.created || Date.now();
      s.updated = d.updated || Date.now();
      s.metadata = d.metadata || {};
      return s;
    } catch { return null; }
  }

  static list(cwd) {
    if (!existsSync(SESSIONS_DIR)) return [];
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = [];
    for (const f of files) {
      const s = Session.load(f.replace('.json', ''));
      if (s && (!cwd || s.cwd === cwd)) sessions.push(s);
    }
    sessions.sort((a, b) => b.updated - a.updated);
    return sessions;
  }

  static recent() {
    const all = Session.list();
    return all[0] || null;
  }

  static cleanup() {
    if (!existsSync(SESSIONS_DIR)) return 0;
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    let removed = 0;
    for (const f of files) {
      try {
        const d = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'));
        if (!d.messages || d.messages.length === 0) {
          rmSync(join(SESSIONS_DIR, f)); removed++;
        }
      } catch { rmSync(join(SESSIONS_DIR, f)); removed++; }
    }
    return removed;
  }
}

export function deleteSession(id) {
  if (!id) return false;
  const exact = join(SESSIONS_DIR, id + '.json');
  if (existsSync(exact)) { rmSync(exact); return true; }
  if (existsSync(SESSIONS_DIR)) {
    const found = readdirSync(SESSIONS_DIR).find(f => f.startsWith(id));
    if (found) { rmSync(join(SESSIONS_DIR, found)); return true; }
  }
  return false;
}

export function loadProjectHints(cwd) {
  const paths = [
    join(cwd, '.opencode', 'instructions.md'),
    join(cwd, '.opencode', 'rules.md'),
    join(cwd, 'AGENTS.md'),
    join(cwd, '.codex', 'instructions.md'),
  ];
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p, 'utf-8').slice(0, 2000);
  }
  return null;
}
