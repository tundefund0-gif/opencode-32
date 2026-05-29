import { BaseProvider } from './base.js';
import { createHash, createHmac } from 'crypto';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(key, dateStamp, region, service) {
  const kDate = hmacSha256(`AWS4${key}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export class BedrockProvider extends BaseProvider {
  constructor(config) {
    super(config);
    const regionMatch = config.baseUrl?.match(/bedrock-runtime\.(.+)\.amazonaws/);
    this.region = config.region || regionMatch?.[1] || process.env.AWS_REGION || 'us-east-1';
    this.accessKey = config.apiKey || process.env.AWS_ACCESS_KEY_ID || '';
    this.secretKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    this.sessionToken = process.env.AWS_SESSION_TOKEN || '';
    this.modelId = config.model || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
  }

  async chat(messages, tools, onStream) {
    const modelId = this.modelId;
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${modelId}/converse`;
    const body = this._buildBody(messages, tools);
    const bodyStr = JSON.stringify(body);
    const host = `bedrock-runtime.${this.region}.amazonaws.com`;
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const headers = {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      'Host': host,
    };
    if (this.sessionToken) headers['X-Amz-Security-Token'] = this.sessionToken;

    const signedHeaders = Object.keys(headers).map(h => h.toLowerCase()).sort().join(';');
    const canonicalHeaders = Object.entries(headers)
      .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}\n`)
      .sort(([a], [b]) => a.localeCompare(b))
      .join('');

    const payloadHash = sha256(bodyStr);
    const canonicalRequest = [
      'POST',
      `/model/${modelId}/converse`,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/bedrock/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join('\n');

    const signingKey = getSignatureKey(this.secretKey, dateStamp, this.region, 'bedrock');
    const signature = hmacSha256(signingKey, stringToSign).toString('hex');

    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Bedrock API error ${res.status}: ${err.substring(0, 300)}`);
    }

    const data = await res.json();
    const output = data.output?.message;
    return {
      content: output?.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '',
      toolCalls: (output?.content?.filter(c => c.toolUse) || []).map(tc => ({
        id: tc.toolUse.toolUseId,
        type: 'function',
        function: { name: tc.toolUse.name, arguments: JSON.stringify(tc.toolUse.input) },
      })),
      finishReason: data.stopReason,
      usage: data.usage,
    };
  }

  _buildBody(messages, tools) {
    const system = [];
    const convMessages = [];
    for (const m of messages) {
      if (m.role === 'system') { system.push({ text: m.content }); continue; }
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = [];
      if (typeof m.content === 'string') {
        content.push({ text: m.content });
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({ toolUse: { toolUseId: tc.id, name: tc.function?.name, input: JSON.parse(tc.function?.arguments || '{}') } });
        }
      }
      if (m.role === 'tool') {
        convMessages.push({ role: 'user', content: [{ toolResult: { toolUseId: m.tool_call_id, content: [{ text: m.content }] } }] });
        continue;
      }
      convMessages.push({ role, content });
    }
    const body = { messages: convMessages };
    if (system.length) body.system = system;
    if (tools?.length) {
      body.inferenceConfig = {};
      body.toolConfig = { tools: tools.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters } } })) };
    }
    return body;
  }
}
