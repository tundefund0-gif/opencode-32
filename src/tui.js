import { stdin, stdout, exit, platform } from 'process';
import { createInterface } from 'readline';

const ESC = '\x1b';
const CSI = ESC + '[';
const SGR = (n) => CSI + n + 'm';
const CUP = (r, c) => CSI + r + ';' + c + 'H';
const ED = (n) => CSI + n + 'J';
const EL = (n) => CSI + n + 'K';
const DSR = CSI + '6n';
const SCOSC = ESC + '7';
const SCORC = ESC + '8';
const STBM = (t, b) => CSI + t + ';' + b + 'r';

const BOLD = SGR(1), DIM = SGR(2), ITALIC = SGR(3), RESET = SGR(0);
const BLACK = SGR(30), RED = SGR(31), GREEN = SGR(32), YELLOW = SGR(33), BLUE = SGR(34), MAGENTA = SGR(35), CYAN = SGR(36), WHITE = SGR(37);
const BG_BLACK = SGR(40), BG_BLUE = SGR(44), BG_DARK = SGR(48 + 5) + '236m';
const BRIGHT_BLACK = SGR(90), BRIGHT_WHITE = SGR(97);

let rows = 0, cols = 0;
let inputBuffer = [];
let inputPos = 0;
let history = [];
let historyIdx = -1;
let chatLines = [];
let scrollOffset = 0;
let statusMsg = '';
let statusColor = '';
let inputActive = true;
let mode = 'insert';
let messageCallback = null;
let interruptCallback = null;
let onResize = null;

function getSize() {
  try { rows = stdout.rows || 24; cols = stdout.columns || 80; } catch {}
}

function emit(data) { stdout.write(data); }

function cursorTo(r, c) { emit(CUP(r + 1, c + 1)); }

function clearLine() { emit(EL(2)); }

function clearScreen() { emit(ED(2)); }

function showCursor(show) { emit(show ? ESC + '?25h' : ESC + '?25l'); }

function rawMode(on) {
  if (on) {
    stdin.setRawMode(true);
    stdin.resume();
  } else {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

function drawStatusBar() {
  cursorTo(rows - 1, 0);
  clearLine();
  const m = mode === 'insert' ? 'INSERT' : 'NORMAL';
  const left = statusColor + ' ' + m + ' ' + RESET;
  if (statusMsg) {
    const right = DIM + statusMsg.substring(0, cols - 20) + RESET;
    const pad = cols - visibleLen(left) - visibleLen(right);
    emit(left + ' '.repeat(Math.max(0, pad)) + right);
  } else {
    emit(left + DIM + ' /help for commands' + RESET);
    emit(EL(0));
  }
}

function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function drawChat() {
  const chatRows = rows - 3;
  const start = Math.max(0, chatLines.length - chatRows - scrollOffset);
  const end = Math.min(chatLines.length, start + chatRows);
  for (let i = 0; i < chatRows; i++) {
    cursorTo(i, 0);
    clearLine();
    const idx = start + i;
    if (idx < chatLines.length) {
      const line = chatLines[idx];
      emit(line.substring(0, cols - 1));
    }
  }
}

function drawInputLine() {
  cursorTo(rows - 2, 0);
  clearLine();
  const prefix = mode === 'insert' ? '> ' : ':';
  const text = prefix + inputBuffer.join('');
  emit(text.substring(0, cols - 1));
  const curX = (prefix.length + inputPos) % cols;
  const curY = rows - 2 + Math.floor((prefix.length + inputPos) / cols);
  cursorTo(curY, curX);
}

function drawAll() {
  drawChat();
  drawInputLine();
  drawStatusBar();
}

function addChatLine(text, color = '') {
  chatLines.push(color + text + RESET);
  scrollOffset = 0;
  drawAll();
}

function setStatus(msg, color = DIM) {
  statusMsg = msg;
  statusColor = color;
  drawStatusBar();
}

function isASCII(code) { return code >= 32 && code <= 126; }

function onKey(data) {
  if (!inputActive) return;
  const key = data.toString();

  if (key === '\x03') { // Ctrl-C
    if (interruptCallback) interruptCallback();
    else exit(0);
    return;
  }

  if (key === '\x1b') { // ESC
    if (mode === 'insert') {
      mode = 'normal';
      drawAll();
    } else {
      mode = 'insert';
      drawAll();
    }
    return;
  }

  if (mode === 'normal') {
    if (key === 'i' || key === 'a') { mode = 'insert'; drawAll(); return; }
    if (key === 'j') { if (scrollOffset > 0) { scrollOffset--; drawChat(); drawStatusBar(); } return; }
    if (key === 'k') { const max = Math.max(0, chatLines.length - (rows - 3)); if (scrollOffset < max) { scrollOffset++; drawChat(); drawStatusBar(); } return; }
    if (key === 'g') { scrollOffset = chatLines.length; drawChat(); drawStatusBar(); return; }
    if (key === 'G') { scrollOffset = 0; drawChat(); drawStatusBar(); return; }
    if (key === '\r') { mode = 'insert'; drawAll(); return; }
    return;
  }

  if (key === '\r') { // Enter
    const msg = inputBuffer.join('').trim();
    inputBuffer = []; inputPos = 0;
    drawInputLine();
    if (msg) {
      history.push(msg); historyIdx = history.length;
      if (msg.startsWith('/')) {
        handleCommand(msg);
      } else {
        if (messageCallback) messageCallback(msg);
      }
    }
    return;
  }

  if (key === '\x7f' || key === '\b') { // Backspace
    if (inputPos > 0) { inputPos--; inputBuffer.splice(inputPos, 1); drawInputLine(); }
    return;
  }

  if (key === '\x1b[A') { // Up
    if (historyIdx > 0) { historyIdx--; inputBuffer = history[historyIdx].split(''); inputPos = inputBuffer.length; drawInputLine(); }
    return;
  }

  if (key === '\x1b[B') { // Down
    if (historyIdx < history.length - 1) { historyIdx++; inputBuffer = history[historyIdx].split(''); inputPos = inputBuffer.length; drawInputLine(); }
    else { historyIdx = history.length; inputBuffer = []; inputPos = 0; drawInputLine(); }
    return;
  }

  if (key === '\x1b[C') { // Right
    if (inputPos < inputBuffer.length) { inputPos++; drawInputLine(); }
    return;
  }

  if (key === '\x1b[D') { // Left
    if (inputPos > 0) { inputPos--; drawInputLine(); }
    return;
  }

  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    inputBuffer.splice(inputPos, 0, key);
    inputPos++;
    drawInputLine();
  }
}

function handleCommand(msg) {
  const parts = msg.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case '/help': addChatLine('Commands: /help /init /undo /redo /share /clear /exit', CYAN); break;
    case '/clear': chatLines = []; scrollOffset = 0; drawAll(); break;
    case '/exit': cleanup(); exit(0); break;
    case '/init': addChatLine('Session initialized', GREEN); break;
    default: addChatLine('Unknown command: ' + cmd, RED);
  }
}

export function cleanup() {
  try {
    rawMode(false);
    showCursor(true);
    cursorTo(rows - 1, 0);
    clearLine();
    emit(RESET);
  } catch {}
}

export function startTUI({ onMessage, onInterrupt, autoPrompt } = {}) {
  messageCallback = onMessage;
  interruptCallback = onInterrupt;
  getSize();
  showCursor(false);
  rawMode(true);
  clearScreen();
  drawAll();

  if (autoPrompt) {
    addChatLine('OpenCode-32', GREEN + BOLD);
    addChatLine('Type /help for commands or start typing.', DIM);
  }

  stdin.on('data', onKey);
  stdout.on('resize', () => {
    getSize();
    STBM(0, rows - 3);
    drawAll();
  });

  STBM(0, rows - 3);

  return {
    addMessage: (role, content) => {
      const prefix = role === 'user' ? (GREEN + 'You') : (CYAN + 'AI');
      const lines = (prefix + RESET + ' ' + content).split('\n');
      for (const line of lines) addChatLine(line);
    },
    addOutput: (content) => {
      if (!content) return;
      const lines = content.split('\n');
      for (const line of lines) addChatLine(line, DIM);
    },
    addToolCall: (name, args) => {
      addChatLine(DIM + '⎿  using ' + name + RESET, DIM);
    },
    setStatus,
    cleanup,
    addChatLine,
    inputActive: (v) => { inputActive = v; },
  };
}
