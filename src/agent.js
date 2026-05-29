import { createProvider } from './providers/index.js';
import { getSystemPrompt, getAgentConfig } from './config.js';
import { executeToolCall } from './tools.js';

const MAX_TURNS = 50;
const MAX_RETRIES = 2;

export async function run(options) {
  const {
    provider, model, apiKey, baseUrl, maxTokens, temperature, system,
    messages, tools, onStream, onToolCall, onToolResult, modelName,
  } = options;

  const prov = createProvider(provider, { model: modelName || model, apiKey, baseUrl, maxTokens, temperature });

  let allMessages = [{ role: 'system', content: getSystemPrompt(system) }, ...messages];
  let turnCount = 0;
  let emptyRetries = 0;
  let response;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        response = await prov.chat(
          allMessages,
          turnCount === 1 ? tools : undefined,
          onStream ? (chunk) => { if (chunk) onStream(chunk); } : undefined,
        );
        break;
      } catch (e) {
        if (retry < MAX_RETRIES - 1) continue;
        throw e;
      }
    }

    if (!response || (!response.content && (!response.toolCalls || !response.toolCalls.length))) {
      emptyRetries++;
      if (emptyRetries >= 2) {
        allMessages.push({ role: 'assistant', content: '_empty_' });
        break;
      }
      continue;
    }
    emptyRetries = 0;

    if (response.toolCalls?.length) {
      allMessages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls,
      });
      for (const tc of response.toolCalls) {
        if (onToolCall) await onToolCall(tc);
        const result = await executeToolCall(tc);
        if (onToolResult) await onToolResult(tc, result);
        allMessages.push(result);
      }
      if (turnCount >= MAX_TURNS) break;
      continue;
    }

    allMessages.push({ role: 'assistant', content: response.content });
    break;
  }

  const usage = response?.usage;
  if (usage) {
    const input = usage.prompt_tokens || usage.inputTokens || usage.promptTokenCount || 0;
    const output = usage.completion_tokens || usage.outputTokens || usage.generationTokenCount || 0;
    const { updateTokenCache } = await import('./config.js');
    updateTokenCache(input, output, 0);
  }

  return {
    messages: allMessages,
    response: allMessages.filter(m => m.role === 'assistant').pop()?.content || '',
    turnCount,
  };
}
