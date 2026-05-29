import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync, mkdirSync, rmSync, renameSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const ALLOWED_ROOTS = [process.cwd(), '/tmp', '/home', '/root', '/data/data/com.termux/files/home'];

function validPath(target) {
  const r = resolve(target);
  for (const root of ALLOWED_ROOTS) {
    if (r.startsWith(resolve(root))) return r;
  }
  throw new Error(`Access denied: ${target}`);
}

export const tools = [
  {
    name: 'read',
    description: 'Read a file (optionally with offset/limit)',
    parameters: {
      type: 'object', properties: {
        path: { type: 'string', description: 'File path' },
        offset: { type: 'number', description: 'Start line (1-indexed)' },
        limit: { type: 'number', description: 'Max lines' },
      }, required: ['path'],
    },
    async execute({ path, offset, limit }) {
      const fp = validPath(path);
      if (!existsSync(fp)) return `Error: not found: ${path}`;
      const s = statSync(fp);
      if (s.isDirectory()) {
        return readdirSync(fp).map(e => {
          try { const st = statSync(join(fp, e)); return `${st.isDirectory() ? 'd' : '-'} ${e}`; }
          catch { return `? ${e}`; }
        }).join('\n') || '(empty)';
      }
      if (s.size > 10 * 1024 * 1024) return `Error: file too large (${(s.size / 1024 / 1024).toFixed(1)}MB)`;
      const c = readFileSync(fp, 'utf-8');
      const lines = c.split('\n');
      const start = offset ? Math.max(0, offset - 1) : 0;
      const end = limit ? start + limit : lines.length;
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n') + `\n[${lines.length} lines]`;
    },
  },
  {
    name: 'write',
    description: 'Write content to a file (creates parent dirs)',
    parameters: {
      type: 'object', properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content' },
      }, required: ['path', 'content'],
    },
    async execute({ path, content }) {
      const fp = validPath(path);
      const dir = fp.slice(0, fp.lastIndexOf('/'));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(fp, content, 'utf-8');
      return `Written ${content.length}b to ${path}`;
    },
  },
  {
    name: 'edit',
    description: 'Find and replace text in a file',
    parameters: {
      type: 'object', properties: {
        path: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' },
      }, required: ['path', 'oldString', 'newString'],
    },
    async execute({ path, oldString, newString }) {
      const fp = validPath(path);
      if (!existsSync(fp)) return `Error: not found: ${path}`;
      let c = readFileSync(fp, 'utf-8');
      if (!c.includes(oldString)) return `Error: oldString not found`;
      c = c.replace(oldString, newString);
      writeFileSync(fp, c, 'utf-8');
      return `Edited ${path}`;
    },
  },
  {
    name: 'bash',
    description: 'Execute a shell command',
    parameters: {
      type: 'object', properties: {
        command: { type: 'string' }, description: { type: 'string' }, timeout: { type: 'number' },
      }, required: ['command', 'description'],
    },
    async execute({ command, description, timeout }) {
      try {
        const out = execSync(command, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: timeout || 120000, env: { ...process.env, PATH: process.env.PATH } });
        return out || '(done)';
      } catch (e) {
        return `Exit ${e.status}: ${(e.stderr || e.message || '').slice(0, 3000)}`;
      }
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a pattern',
    parameters: {
      type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'],
    },
    async execute({ pattern, path: sp }) {
      const cwd = sp ? validPath(sp) : process.cwd();
      const hasRg = existsSync('/usr/bin/rg') || existsSync('/data/data/com.termux/files/usr/bin/rg');
      if (hasRg) {
        try {
          const out = execSync(`rg --files '${cwd}' 2>/dev/null || true`, { encoding: 'utf-8', timeout: 10000 });
          const lines = out.trim().split('\n').filter(Boolean);
          const re = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.'));
          return lines.filter(l => re.test(l)).join('\n') || 'No matches';
        } catch { return 'No matches'; }
      }
      try {
        const out = execSync(`find '${cwd}' -name '${pattern.replace(/\*/g, '*')}' 2>/dev/null | head -100`, { encoding: 'utf-8', timeout: 10000 });
        return out.trim() || 'No matches';
      } catch { return 'No matches'; }
    },
  },
  {
    name: 'grep',
    description: 'Search file contents',
    parameters: {
      type: 'object', properties: {
        pattern: { type: 'string' }, path: { type: 'string' }, include: { type: 'string' },
      }, required: ['pattern'],
    },
    async execute({ pattern, path: sp, include }) {
      const cwd = sp ? validPath(sp) : process.cwd();
      const safe = pattern.replace(/['"]/g, '\\$&');
      let cmd = `grep -rn '${safe}' '${cwd}' 2>/dev/null | head -200`;
      if (include) cmd = `grep -rn '${safe}' '${cwd}' --include='${include}' 2>/dev/null | head -200`;
      try {
        const out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024, timeout: 15000 });
        return out || 'No matches';
      } catch { return 'No matches'; }
    },
  },
  {
    name: 'ls',
    description: 'List directory contents',
    parameters: {
      type: 'object', properties: { path: { type: 'string' } },
    },
    async execute({ path: sp }) {
      const fp = sp ? validPath(sp) : process.cwd();
      if (!existsSync(fp)) return `Error: not found`;
      return readdirSync(fp).map(e => {
        try { const s = statSync(join(fp, e)); return `${s.isDirectory() ? 'd' : '-'} ${e}`; }
        catch { return `? ${e}`; }
      }).join('\n') || '(empty)';
    },
  },
  {
    name: 'append',
    description: 'Append to a file',
    parameters: {
      type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'],
    },
    async execute({ path, content }) {
      const fp = validPath(path);
      appendFileSync(fp, content, 'utf-8');
      return `Appended ${content.length}b to ${path}`;
    },
  },
  {
    name: 'move',
    description: 'Move or rename a file',
    parameters: {
      type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source', 'destination'],
    },
    async execute({ source, destination }) {
      renameSync(validPath(source), validPath(destination));
      return `Moved ${source} → ${destination}`;
    },
  },
  {
    name: 'delete',
    description: 'Delete a file or directory',
    parameters: {
      type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
    },
    async execute({ path }) {
      const fp = validPath(path);
      if (!existsSync(fp)) return `Error: not found`;
      const s = statSync(fp);
      if (s.isDirectory()) rmSync(fp, { recursive: true, force: true });
      else unlinkSync(fp);
      return `Deleted ${path}`;
    },
  },
  {
    name: 'search',
    description: 'Web search for information',
    parameters: {
      type: 'object', properties: { query: { type: 'string' } }, required: ['query'],
    },
    async execute({ query }) {
      try {
        const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json();
        const results = [];
        if (data.AbstractText) results.push(data.AbstractText);
        if (data.Results) data.Results.slice(0, 5).forEach(r => results.push(`${r.Title}: ${r.Text}`));
        if (data.RelatedTopics) data.RelatedTopics.slice(0, 5).forEach(r => { if (r.Text) results.push(r.Text); });
        return results.join('\n') || 'No results';
      } catch (e) { return `Search error: ${e.message}`; }
    },
  },
];

export async function executeToolCall(tc) {
  const name = tc.function?.name || tc.tool_name || 'unknown';
  const tool = tools.find(t => t.name === name);
  if (!tool) return { role: 'tool', tool_call_id: tc.id, tool_name: name, content: `Unknown tool: ${name}` };
  let args;
  try {
    args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
  } catch {
    return { role: 'tool', tool_call_id: tc.id, tool_name: name, content: 'Error: invalid JSON' };
  }
  try {
    const result = await tool.execute(args);
    const maxLen = 10000;
    const content = typeof result === 'string' ? result.slice(0, maxLen) : JSON.stringify(result).slice(0, maxLen);
    return { role: 'tool', tool_call_id: tc.id, tool_name: name, content };
  } catch (e) {
    return { role: 'tool', tool_call_id: tc.id, tool_name: name, content: `Error: ${e.message}` };
  }
}
