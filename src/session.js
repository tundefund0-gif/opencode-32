import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getDataDir } from './config.js';

const SESSIONS_DIR = join(getDataDir(), 'sessions');

function ensure() {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
}

export class Session {
  constructor(id, cwd) {
    this.id = id || randomUUID();
    this.cwd = cwd || process.cwd();
    this.messages = [];
    this.created = Date.now();
    this.updated = Date.now();
    this.metadata = {};
  }

  get dir() { return join(SESSIONS_DIR, this.id); }
  get path() { return join(this.dir, 'session.json'); }

  save() {
    this.updated = Date.now();
    ensure();
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify({
      id: this.id, cwd: this.cwd, created: this.created, updated: this.updated,
      metadata: this.metadata, messages: this.messages,
    }, null, 2));
  }

  static load(id) {
    if (!id) return null;
    const p = join(SESSIONS_DIR, id, 'session.json');
    if (!existsSync(p)) return null;
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
    ensure();
    let entries;
    try { entries = readdirSync(SESSIONS_DIR); } catch { return []; }
    const sessions = [];
    for (const id of entries) {
      if (id.startsWith('.')) continue;
      const s = Session.load(id);
      if (s && (!cwd || s.cwd === cwd)) sessions.push(s);
    }
    sessions.sort((a, b) => b.updated - a.updated);
    return sessions;
  }

  static listAll() { return Session.list(); }

  static cleanup() {
    ensure();
    let entries;
    try { entries = readdirSync(SESSIONS_DIR); } catch { return 0; }
    let removed = 0;
    for (const id of entries) {
      if (id.startsWith('.')) continue;
      const s = Session.load(id);
      if (!s || !s.messages || s.messages.length === 0) {
        try { rmSync(join(SESSIONS_DIR, id), { recursive: true }); removed++; } catch {}
      }
    }
    return removed;
  }
}

export function deleteSession(id) {
  if (!id) return false;
  const dir = join(SESSIONS_DIR, id);
  if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); return true; }
  return false;
}

export function loadProjectInstructions(cwd) {
  const paths = [
    join(cwd, '.opencode', 'instructions.md'),
    join(cwd, '.codex', 'instructions.md'),
    join(cwd, '.opencode/instructions.md'),
  ];
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return null;
}
