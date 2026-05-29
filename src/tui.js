import { stdin, stdout, exit } from 'process';

const CSI = '\x1b[';
const SGR = (n) => CSI + n + 'm';
const CUP = (r, c) => CSI + r + ';' + c + 'H';
const EL = (n) => CSI + n + 'K';
const ED = CSI + '2J';

const R = SGR(0), B = SGR(1), D = SGR(2);
const G = SGR(32), C = SGR(36), Y = SGR(33), Rr = SGR(31);

let rows = 24, cols = 80;
let chatHistory = [];
let scrollPos = 0;
let inputBuf = '';
let inputCur = 0;
let hist = [];
let histIdx = 0;
let statusText = '';
let statusColor = D;
let msgCallback = null;
let intCallback = null;
let running = true;
let streamLine = -1;
let streamText = '';

function sz() { try { rows = stdout.rows || 24; cols = stdout.columns || 80; } catch {} }

function w(s) { stdout.write(s); }

function pos(r, c) { w(CUP(r + 1, c + 1)); }

function clr() { w(EL(2)); }

function scr() { w(ED); pos(0, 0); }

function chatRows() { return Math.max(1, rows - 3); }

function draw() {
  const cr = chatRows();
  const start = Math.max(0, chatHistory.length - cr - scrollPos);
  const end = Math.min(chatHistory.length, start + cr);
  for (let i = 0; i < cr; i++) {
    pos(i, 0); clr();
    const idx = start + i;
    if (idx < chatHistory.length) w(chatHistory[idx].slice(0, cols - 1));
  }
  // Input line
  const iy = rows - 3;
  pos(iy, 0); clr();
  w('> ' + inputBuf.slice(0, cols - 2));
  // Status bar
  const sy = rows - 2;
  pos(sy, 0); clr();
  const left = ' ' + (hist.length > 0 ? 'HIST' : 'INSERT') + ' ';
  const right = statusText ? ' ' + statusText + ' ' : ' /help for commands ';
  w(D + left + R);
  const pad = cols - left.replace(/\x1b\[[0-9;]*m/g, '').length - right.replace(/\x1b\[[0-9;]*m/g, '').length - 2;
  if (pad > 0) w(' '.repeat(pad));
  w(D + right + R);
  // Bottom spacer
  const by = rows - 1;
  pos(by, 0); clr();
  // Cursor
  pos(iy, 2 + inputCur);
}

export function startTUI(opts = {}) {
  msgCallback = opts.onMessage || null;
  intCallback = opts.onInterrupt || null;
  sz();
  stdin.setRawMode(true);
  stdin.resume();
  scr();

  if (opts.autoPrompt) {
    addChatLine(G + B + 'OpenCode-32' + R + D + ' — interactive coding agent' + R);
  }

  stdin.on('data', handler);
  stdout.on('resize', () => { sz(); if (running) draw(); });

  // Send cursor to bottom on clean exit
  process.on('exit', cleanup);

  draw();

  const api = {
    addMessage(role, content) {
      const p = role === 'user' ? (G + 'You' + R) : (C + 'AI' + R);
      for (const l of content.split('\n')) addChatLine(p + ' ' + l);
    },
    addOutput(content) {
      if (!content) return;
      for (const l of content.split('\n')) addChatLine(D + l + R);
    },
    setStatus(s) { statusText = s; statusColor = D; if (running) draw(); },
    addChatLine,
    inputActive(v) { if (!v && running) draw(); },

    startStream(role) {
      const p = role === 'assistant' ? (C + 'AI' + R) : (G + 'You' + R);
      streamLine = chatHistory.length;
      streamText = '';
      chatHistory.push(p + ' ');
      if (running) draw();
      return (chunk) => {
        if (chunk === null) return; // null = done, handled by endStream
        streamText += chunk;
        chatHistory[streamLine] = (p + ' ' + streamText).slice(0, cols * 4);
        if (running) {
          // Redraw just the stream line for performance
          const cr = chatRows();
          const start = Math.max(0, chatHistory.length - cr - scrollPos);
          const lineIdx = streamLine - start;
          if (lineIdx >= 0 && lineIdx < cr) {
            pos(lineIdx, 0); clr();
            w(chatHistory[streamLine].slice(0, cols - 1));
            // Restore cursor to input
            const iy = rows - 3;
            pos(iy, 2 + inputCur);
          } else {
            draw();
          }
        }
      };
    },
    endStream() {
      streamLine = -1;
      if (running) draw();
    },
  };
  return api;
}

function addChatLine(text) {
  chatHistory.push(text || '');
  scrollPos = 0;
  if (running) draw();
}

function handler(data) {
  if (!running) return;
  const key = data.toString();

  if (key === '\x03') {
    cleanup();
    if (intCallback) intCallback();
    else process.exit(0);
    return;
  }

  if (key === '\r' || key === '\n') {
    const msg = inputBuf.trim();
    inputBuf = '';
    inputCur = 0;
    if (msg) {
      hist.push(msg);
      histIdx = hist.length;
      if (msg.startsWith('/')) {
        handleSlash(msg);
      } else if (msgCallback) {
        msgCallback(msg);
      }
    }
    if (running) draw();
    return;
  }

  if (key === '\x7f' || key === '\b') {
    if (inputCur > 0) {
      inputCur--;
      inputBuf = inputBuf.slice(0, inputCur) + inputBuf.slice(inputCur + 1);
    }
    if (running) draw();
    return;
  }

  if (key === '\x1b[A') {
    if (histIdx > 0) { histIdx--; inputBuf = hist[histIdx]; inputCur = inputBuf.length; }
    if (running) draw();
    return;
  }

  if (key === '\x1b[B') {
    if (histIdx < hist.length - 1) { histIdx++; inputBuf = hist[histIdx]; inputCur = inputBuf.length; }
    else { histIdx = hist.length; inputBuf = ''; inputCur = 0; }
    if (running) draw();
    return;
  }

  if (key === '\x1b[C') {
    if (inputCur < inputBuf.length) { inputCur++; }
    if (running) draw();
    return;
  }

  if (key === '\x1b[D') {
    if (inputCur > 0) { inputCur--; }
    if (running) draw();
    return;
  }

  // j/k scroll in chat
  if (key === '\x1bOA' || key === 'k') {
    const max = Math.max(0, chatHistory.length - chatRows());
    if (scrollPos < max) { scrollPos++; }
    if (running) draw();
    return;
  }

  if (key === '\x1bOB' || key === 'j') {
    if (scrollPos > 0) { scrollPos--; }
    if (running) draw();
    return;
  }

  // Printable
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    inputBuf = inputBuf.slice(0, inputCur) + key + inputBuf.slice(inputCur);
    inputCur++;
    if (running) draw();
  }
}

function handleSlash(cmd) {
  const parts = cmd.split(/\s+/);
  switch (parts[0]) {
    case '/help':
      addChatLine(C + 'Commands: /help /clear /exit /init' + R);
      break;
    case '/clear':
      chatHistory = [];
      scrollPos = 0;
      if (running) draw();
      break;
    case '/init':
      addChatLine('Session reinitialized');
      break;
    case '/exit':
      cleanup();
      process.exit(0);
      break;
    case '/undo':
      addChatLine('Undo not yet implemented');
      break;
    case '/redo':
      addChatLine('Redo not yet implemented');
      break;
    default:
      addChatLine(Rr + 'Unknown: ' + cmd + R);
  }
}

function cleanup() {
  try {
    running = false;
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write(CSI + '?25h');
    pos(rows - 1, 0);
    clr();
    w(R);
  } catch {}
}
