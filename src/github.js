import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let _token = null;

export function setGitHubToken(token) {
  _token = token;
}

export function getGitHubToken() {
  if (_token) return _token;
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) { _token = fromEnv; return fromEnv; }
  try {
    const out = execSync('gh auth token 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
    _token = out.trim();
    return _token;
  } catch {}
  return null;
}

async function ghFetch(path, opts = {}) {
  const token = getGitHubToken();
  if (!token) throw new Error('No GitHub token. Set GITHUB_TOKEN or run `gh auth login`.');
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'opencode-32',
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`GitHub API error ${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

export async function createPR({ repo, title, body, head, base }) {
  const [owner, repoName] = repo.split('/');
  return ghFetch(`/repos/${owner}/${repoName}/pulls`, {
    method: 'POST',
    body: { title, body, head, base },
  });
}

export async function getPRComments(repo, prNumber) {
  const [owner, repoName] = repo.split('/');
  return ghFetch(`/repos/${owner}/${repoName}/issues/${prNumber}/comments`);
}

export async function commentOnPR(repo, prNumber, body) {
  const [owner, repoName] = repo.split('/');
  return ghFetch(`/repos/${owner}/${repoName}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export async function getDiff(repo, prNumber) {
  const [owner, repoName] = repo.split('/');
  const token = getGitHubToken();
  const url = `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3.diff',
      'User-Agent': 'opencode-32',
    },
  });
  if (!res.ok) throw new Error(`GitHub diff error ${res.status}`);
  return res.text();
}

export async function addPRReview(repo, prNumber, body, event = 'COMMENT') {
  const [owner, repoName] = repo.split('/');
  return ghFetch(`/repos/${owner}/${repoName}/pulls/${prNumber}/reviews`, {
    method: 'POST',
    body: { body, event },
  });
}

export async function createIssue(repo, title, body) {
  const [owner, repoName] = repo.split('/');
  return ghFetch(`/repos/${owner}/${repoName}/issues`, {
    method: 'POST',
    body: { title, body },
  });
}
