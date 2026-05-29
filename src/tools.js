import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const ALLOWED_ROOTS = [process.cwd()];
const MAX_READ_SIZE = 10 * 1024 * 1024;

export function addAllowedRoot(root) {
  ALLOWED_ROOTS.push(resolve(root));
}

function validatePath(target) {
  const resolved = resolve(target);
  for (const root of ALLOWED_ROOTS) {
    if (resolved.startsWith(root)) return resolved;
  }
  const home = process.env.HOME || '/root';
  if (resolved.startsWith(home)) return resolved;
  throw new Error(`Access denied: ${target} is outside allowed directories`);
}

function simpleGlob(pattern, cwd) {
  const results = [];
  const parts = pattern.split('/');
  const filePart = parts[parts.length - 1];
  const dirPattern = parts.slice(0, -1).join('/');
  const searchDir = dirPattern ? resolve(cwd, dirPattern) : cwd;
  try {
    const entries = readdirSync(searchDir);
    for (const e of entries) {
      if (filePart === '**' || filePart === '*') {
        results.push(e);
        if (filePart === '**') {
          const full = join(searchDir, e);
          try { if (statSync(full).isDirectory()) results.push(...simpleGlob('**/*', full).map(p => join(e, p))); } catch {}
        }
      }
      const re = new RegExp('^' + filePart.replace(/\*/g, '.*') + '$');
      if (re.test(e)) results.push(e);
    }
  } catch {}
  return results;
}

export const tools = [
  {
    name: 'read',
    description: 'Read the contents of a file or list a directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path' },
        offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
        limit: { type: 'number', description: 'Max lines to read' },
      },
      required: ['path'],
    },
    execute: async ({ path, offset, limit }) => {
      const fullPath = validatePath(path);
      if (!existsSync(fullPath)) return `Error: file not found: ${path}`;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const entries = readdirSync(fullPath);
        return entries.map(e => {
          try {
            const s = statSync(join(fullPath, e));
            return `${s.isDirectory() ? 'd' : s.isSymbolicLink() ? 'l' : '-'} ${e}${s.isDirectory() ? '/' : ''}`;
          } catch { return `? ${e}`; }
        }).join('\n') || '(empty)';
      }
      if (stat.size > MAX_READ_SIZE) return `Error: file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB).`;
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const start = offset ? offset - 1 : 0;
      const end = limit ? start + limit : lines.length;
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
        + `\n---\n[${lines.length} lines total, showing ${start + 1}-${Math.min(end, lines.length)}]`;
    },
  },
  {
    name: 'write',
    description: 'Write content to a file (creates parent directories)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async ({ path, content }) => {
      const fullPath = validatePath(path);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      return `Written ${content.length} bytes to ${path}`;
    },
  },
  {
    name: 'edit',
    description: 'Edit a file by finding and replacing text (first occurrence)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        oldString: { type: 'string', description: 'Text to find' },
        newString: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'oldString', 'newString'],
    },
    execute: async ({ path, oldString, newString }) => {
      const fullPath = validatePath(path);
      if (!existsSync(fullPath)) return `Error: file not found: ${path}`;
      let content = readFileSync(fullPath, 'utf-8');
      if (!content.includes(oldString)) return `Error: oldString not found in ${path}`;
      content = content.replace(oldString, newString);
      writeFileSync(fullPath, content, 'utf-8');
      return `Edited ${path}`;
    },
  },
  {
    name: 'glob',
    description: 'Search for files matching a glob pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.js")' },
        path: { type: 'string', description: 'Directory to search (default: cwd)' },
      },
      required: ['pattern'],
    },
    execute: async ({ pattern, path: searchPath }) => {
      const cwd = searchPath ? validatePath(searchPath) : process.cwd();
      const matches = simpleGlob(pattern, cwd);
      return matches.length ? matches.join('\n') : 'No matches found';
    },
  },
  {
    name: 'grep',
    description: 'Search file contents for a regex pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Directory to search' },
        include: { type: 'string', description: 'File glob filter (e.g. "*.js")' },
      },
      required: ['pattern'],
    },
    execute: async ({ pattern, path: searchPath, include }) => {
      const cwd = searchPath ? validatePath(searchPath) : process.cwd();
      const safe = pattern.replace(/['"\\]/g, '\\$&');
      const hasRg = existsSync('/usr/bin/rg') || existsSync('/data/data/com.termux/files/usr/bin/rg');
      let cmd;
      if (hasRg) {
        cmd = `rg -rn -- '${safe}' '${cwd}' 2>/dev/null || true`;
        if (include) cmd = `rg -rn -- '${safe}' '${cwd}' -g '${include}' 2>/dev/null || true`;
      } else {
        cmd = `grep -rn -- '${safe}' '${cwd}' 2>/dev/null || true`;
        if (include) cmd = `grep -rn -- '${safe}' '${cwd}' --include='${include}' 2>/dev/null || true`;
      }
      try {
        const out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 15000 });
        return out || 'No matches found';
      } catch { return 'No matches found'; }
    },
  },
  {
    name: 'bash',
    description: 'Execute a shell command',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        description: { type: 'string', description: 'What this does' },
        timeout: { type: 'number', description: 'Timeout in ms (default 120000)' },
      },
      required: ['command', 'description'],
    },
    execute: async ({ command, description, timeout }) => {
      try {
        const out = execSync(command, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: timeout || 120000,
          env: { ...process.env, PATH: process.env.PATH, HOME: process.env.HOME, SHELL: process.env.SHELL || '/bin/sh' },
        });
        return out || '(completed with no output)';
      } catch (err) {
        return `Exit ${err.status}: ${err.stderr || err.message}`.substring(0, 5000);
      }
    },
  },
  {
    name: 'ls',
    description: 'List directory contents',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
      },
      required: [],
    },
    execute: async ({ path: dirPath }) => {
      const fullPath = dirPath ? validatePath(dirPath) : process.cwd();
      if (!existsSync(fullPath)) return `Error: not found: ${dirPath || '.'}`;
      return readdirSync(fullPath).map(e => {
        const full = join(fullPath, e);
        try {
          const s = statSync(full);
          return `${s.isDirectory() ? 'd' : s.isSymbolicLink() ? 'l' : '-'} ${e}${s.isDirectory() ? '/' : ''}`;
        } catch { return `? ${e}`; }
      }).join('\n') || '(empty)';
    },
  },
  {
    name: 'append',
    description: 'Append content to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to append' },
      },
      required: ['path', 'content'],
    },
    execute: async ({ path, content }) => {
      const fullPath = validatePath(path);
      appendFileSync(fullPath, content, 'utf-8');
      return `Appended ${content.length} bytes to ${path}`;
    },
  },
  {
    name: 'move',
    description: 'Move or rename a file or directory',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' },
      },
      required: ['source', 'destination'],
    },
    execute: async ({ source, destination }) => {
      const srcPath = validatePath(source);
      const dstPath = validatePath(destination);
      const dir = dstPath.substring(0, dstPath.lastIndexOf('/'));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const { renameSync } = await import('fs');
      renameSync(srcPath, dstPath);
      return `Moved ${source} to ${destination}`;
    },
  },
  {
    name: 'delete',
    description: 'Delete a file or directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
      },
      required: ['path'],
    },
    execute: async ({ path }) => {
      const fullPath = validatePath(path);
      if (!existsSync(fullPath)) return `Error: not found: ${path}`;
      const s = statSync(fullPath);
      if (s.isDirectory()) {
        const { rmSync } = await import('fs');
        rmSync(fullPath, { recursive: true, force: true });
      } else {
        const { unlinkSync } = await import('fs');
        unlinkSync(fullPath);
      }
      return `Deleted ${path}`;
    },
  },
  {
    name: 'search',
    description: 'Search web for current information (uses DuckDuckGo)',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    execute: async ({ query }) => {
      try {
        const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
        const data = await res.json();
        const results = [];
        if (data.AbstractText) results.push(data.AbstractText);
        if (data.Results) data.Results.slice(0, 5).forEach(r => results.push(`${r.Title}: ${r.Text}`));
        if (data.RelatedTopics) data.RelatedTopics.slice(0, 5).forEach(r => {
          if (r.Text) results.push(r.Text);
        });
        return results.length ? results.join('\n') : 'No results found';
      } catch (err) {
        return `Search error: ${err.message}`;
      }
    },
  },
];

export async function executeToolCall(toolCall) {
  const tool = tools.find(t => t.name === toolCall.function?.name || t.name === toolCall.function?.name);
  const name = toolCall.function?.name || toolCall.tool_name || 'unknown';
  const toolDef = tools.find(t => t.name === name);
  if (!toolDef) return { role: 'tool', tool_call_id: toolCall.id, tool_name: name, content: `Unknown tool: ${name}` };

  let args;
  try {
    args = JSON.parse(typeof toolCall.function?.arguments === 'string' ? toolCall.function.arguments : '{}');
  } catch {
    return { role: 'tool', tool_call_id: toolCall.id, tool_name: name, content: 'Error: invalid JSON arguments' };
  }

  try {
    const result = await toolDef.execute(args);
    return { role: 'tool', tool_call_id: toolCall.id, tool_name: name, content: typeof result === 'string' ? result : JSON.stringify(result) };
  } catch (err) {
    return { role: 'tool', tool_call_id: toolCall.id, tool_name: name, content: `Error: ${err.message}` };
  }
}
