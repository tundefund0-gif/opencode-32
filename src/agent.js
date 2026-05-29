import { getProvider } from './providers/index.js';
import { getSystemPrompt, getMaxTokens, getTemperature, updateTokenCache, getTokenCache } from './config.js';
import { executeToolCall } from './tools.js';

const MAX_TURNS = 50;
const MAX_RETRIES = 2;
const SIMILARITY_THRESHOLD = 6;
const MAX_TOOL_OUTPUT = 10000;

function wordEditDistance(a, b) {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 1;
  let matches = 0;
  const setB = new Set(wb);
  for (const w of wa) if (setB.has(w)) matches++;
  return 1 - matches / Math.max(wa.length, wb.length);
}

function deduplicateContent(response, history) {
  if (!response?.trim()) return response;
  for (let i = history.length - 1; i >= Math.max(0, history.length - 5); i--) {
    const prev = typeof history[i]?.content === 'string' ? history[i].content : '';
    if (!prev) continue;
    if (wordEditDistance(response, prev) < 0.3) return null;
  }
  return response;
}

export async function runAgentLoop({ provider, model, apiKey, baseUrl, messages, tools, onStream, onToolCall, maxTokens, temperature, modelName }) {
  const prov = getProvider(provider, modelName || model, { apiKey, baseUrl, maxTokens: maxTokens || getMaxTokens(), temperature: temperature ?? getTemperature() });
  const allMessages = [...messages];
  let turnCount = 0;
  let lastToolCount = 0;
  let emptyResponseCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;
    const body = {
      model: modelName || model,
      messages: allMessages,
      tools: turnCount === 1 ? tools : undefined,
      stream: !!onStream,
    };

    let response;
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        response = await prov.chat(allMessages, turnCount === 1 ? tools : undefined, onStream ? (chunk) => {
          if (chunk.content) onStream(chunk);
        } : undefined);
        break;
      } catch (err) {
        if (retry < MAX_RETRIES - 1) continue;
        throw err;
      }
    }

    if (!response || (!response.content && (!response.toolCalls || !response.toolCalls.length))) {
      emptyResponseCount++;
      if (emptyResponseCount >= 2) {
        onStream?.({ content: '_empty_', done: false });
        allMessages.push({ role: 'assistant', content: '_empty_' });
        break;
      }
      continue;
    }
    emptyResponseCount = 0;

    if (onStream && response.content) onStream({ content: '', done: false });

    const deduped = deduplicateContent(response.content, allMessages);
    const finalContent = deduped || response.content;

    if (response.toolCalls?.length) {
      allMessages.push({ role: 'assistant', content: finalContent || null, tool_calls: response.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function?.name, arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}) },
      })) });

      for (const tc of response.toolCalls) {
        if (onToolCall) await onToolCall(tc);
        const result = await executeToolCall(tc);
        if (result.content && result.content.length > MAX_TOOL_OUTPUT) {
          result.content = result.content.substring(0, MAX_TOOL_OUTPUT) + `\n... [truncated ${result.content.length - MAX_TOOL_OUTPUT} chars]`;
        }
        allMessages.push(result);
      }

      if (response.toolCalls.length === lastToolCount) break;
      lastToolCount = response.toolCalls.length;
      continue;
    }

    allMessages.push({ role: 'assistant', content: finalContent });
    break;
  }

  const usage = response?.usage;
  if (usage) {
    const input = usage.prompt_tokens || usage.inputTokens || usage.promptTokenCount || 0;
    const output = usage.completion_tokens || usage.outputTokens || usage.generationTokenCount || 0;
    updateTokenCache(input, output, 0);
  }

  const lastAssistant = allMessages.filter(m => m.role === 'assistant').pop();
  return {
    messages: allMessages,
    response: lastAssistant?.content || '',
    turnCount,
  };
}
