/**
 * AI 代理：任何 OpenAI 兼容端点 + Anthropic 原生端点
 *
 * 浏览器只跟本机服务通信，apiKey 存在服务端 .data/config.json，不会落到前端；
 * 出站请求由服务端发起，因此也不受浏览器 CORS 限制。
 */
export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiStyle: 'auto' | 'openai' | 'anthropic';
  temperature: number;
  maxTokens: number;
  systemExtra: string;
  systemPrompt?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiEvent {
  type: 'start' | 'delta' | 'thinking' | 'done' | 'error' | 'end';
  text?: string;
  message?: string;
  url?: string;
  style?: string;
  model?: string;
  usage?: unknown;
  stopReason?: string | null;
  aborted?: boolean;
}

import { DEFAULT_SYSTEM_PROMPT } from '../web/src/lib/systemPrompt';
export { DEFAULT_SYSTEM_PROMPT };

/* ------------------------------------------------------------ URL 组装 */

export type ApiStyle = 'openai' | 'anthropic';

export function detectStyle(ai: AiConfig): ApiStyle {
  const style = String(ai.apiStyle ?? 'auto').toLowerCase();
  if (style === 'openai' || style === 'anthropic') return style;
  return String(ai.baseUrl ?? '').toLowerCase().includes('anthropic') ? 'anthropic' : 'openai';
}

export function endpointFor(ai: AiConfig): { url: string; style: ApiStyle } {
  const style = detectStyle(ai);
  const base = String(ai.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('还没有配置 API 地址，请在「设置」里填写 Base URL');
  if (style === 'anthropic') {
    if (/\/messages$/.test(base)) return { url: base, style };
    if (/\/v\d[\w.-]*$/.test(base)) return { url: `${base}/messages`, style };
    return { url: `${base}/v1/messages`, style };
  }
  if (/\/chat\/completions$/.test(base)) return { url: base, style };
  // https://api.deepseek.com        -> /v1/chat/completions
  // https://api.openai.com/v1       -> /chat/completions
  // .../v1beta/openai (Gemini 兼容) -> /chat/completions
  if (/\/v\d[\w.-]*$/.test(base) || /\/(openai|api)$/.test(base)) return { url: `${base}/chat/completions`, style };
  return { url: `${base}/v1/chat/completions`, style };
}

function authHeaders(ai: AiConfig, style: ApiStyle): Record<string, string> {
  const key = String(ai.apiKey ?? '').trim();
  if (!key) throw new Error('还没有配置 API Key，请在「设置」里填写');
  if (style === 'anthropic') {
    return { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  }
  return { 'content-type': 'application/json', authorization: `Bearer ${key}`, accept: 'text/event-stream' };
}

/** 通过相同的服务商地址和认证获取可用模型 */
export async function listModels(ai: AiConfig, signal?: AbortSignal): Promise<{ ok: boolean; models?: string[]; message?: string }> {
  try {
    const { url, style } = endpointFor(ai);
    const modelsUrl = url.replace(style === 'anthropic' ? /\/messages$/ : /\/chat\/completions$/, '/models');
    const headers = authHeaders(ai, style);
    headers.accept = 'application/json';
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const ids = new Set<string>();
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const target = new URL(modelsUrl);
      if (cursor) target.searchParams.set('after_id', cursor);
      const res = await fetch(target.toString(), { headers, signal: requestSignal });
      const body = await res.text();
      if (!res.ok) return { ok: false, message: friendlyHttpError(res.status, body) };
      const data = JSON.parse(body) as { data?: unknown; has_more?: boolean; last_id?: string };
      if (!Array.isArray(data.data)) return { ok: false, message: '接口返回的模型列表格式不受支持，可手动输入模型名称' };
      for (const item of data.data as unknown[]) {
        if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' && item.id.trim()) ids.add(item.id);
      }
      if (style !== 'anthropic' || !data.has_more || !data.last_id || data.last_id === cursor) break;
      cursor = data.last_id;
    }
    return { ok: true, models: [...ids].sort((a, b) => a.localeCompare(b)) };
  } catch (err) {
    return { ok: false, message: `获取模型失败：${(err as Error).message}` };
  }
}

function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system, rest: messages.filter((m) => m.role !== 'system') };
}

function buildBody(ai: AiConfig, messages: ChatMessage[], stream: boolean): { style: ApiStyle; body: Record<string, unknown> } {
  const style = detectStyle(ai);
  const model = String(ai.model ?? '').trim();
  if (!model) throw new Error('还没有配置模型名，请在「设置」里填写（例如 gpt-4o-mini / deepseek-chat / claude-sonnet-5-5）');
  const temperature = typeof ai.temperature === 'number' ? ai.temperature : 0.6;
  const maxTokens = Number(ai.maxTokens) > 0 ? Number(ai.maxTokens) : 8192;
  if (style === 'anthropic') {
    const { system, rest } = splitSystem(messages);
    return {
      style,
      body: {
        model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: rest.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        stream,
      },
    };
  }
  return {
    style,
    body: {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
      stream,
    },
  };
}

/* --------------------------------------------------------- SSE 解析 */

async function* sseDataLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim();
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

interface Delta {
  text?: string;
  thinking?: string;
  finish?: string | null;
  stopReason?: string | null;
  usage?: unknown;
  error?: string;
}

interface OpenAiChunk {
  choices?: { delta?: Record<string, unknown>; message?: Record<string, unknown>; finish_reason?: string | null }[];
  usage?: unknown;
}

interface AnthropicChunk {
  type?: string;
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string | null };
  usage?: unknown;
  error?: { message?: string };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}

function extractOpenAIDelta(json: OpenAiChunk): Delta {
  const choice = json.choices?.[0];
  const delta = choice?.delta ?? choice?.message ?? {};
  return {
    text: contentToText((delta as { content?: unknown }).content),
    thinking: String((delta as { reasoning_content?: unknown; reasoning?: unknown }).reasoning_content ?? (delta as { reasoning?: unknown }).reasoning ?? ''),
    finish: choice?.finish_reason ?? null,
    usage: json.usage,
  };
}

function extractAnthropicDelta(json: AnthropicChunk): Delta {
  switch (json.type) {
    case 'content_block_delta': {
      const d = json.delta ?? {};
      if (d.type === 'thinking_delta') return { thinking: d.thinking ?? '' };
      if (d.type === 'text_delta') return { text: d.text ?? '' };
      return {};
    }
    case 'message_delta':
      return { stopReason: json.delta?.stop_reason ?? null, usage: json.usage };
    case 'error':
      return { error: json.error?.message ?? '上游返回错误' };
    default:
      return {};
  }
}

export function friendlyHttpError(status: number, bodyText: string): string {
  const snippet = String(bodyText ?? '').slice(0, 600);
  const hints: string[] = [];
  if (status === 401 || status === 403) hints.push('API Key 无效 / 没有权限，检查 Key 与模型额度');
  if (status === 404) hints.push('404 通常是 Base URL 写错（是否漏了 /v1？）或模型名不存在');
  if (status === 429) hints.push('触发限流或余额不足，稍后重试或换个模型');
  return `上游返回 ${status}${hints.length ? `：${hints.join(' ')}` : ''}\n${snippet}`;
}

/* -------------------------------------------------------------- 主入口 */

export async function streamChat(opts: {
  ai: AiConfig;
  messages: ChatMessage[];
  onEvent: (evt: AiEvent) => void;
  signal?: AbortSignal;
  stream?: boolean;
}): Promise<void> {
  const { ai, messages, onEvent, signal } = opts;
  const stream = opts.stream ?? true;
  const { url, style } = endpointFor(ai);
  const headers = authHeaders(ai, style);
  const { body } = buildBody(ai, messages, stream);
  onEvent({ type: 'start', url, style, model: String(body.model) });

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream }), signal });
  } catch (err) {
    onEvent({ type: 'error', message: `无法连接到 ${url}\n${(err as Error)?.message}` });
    return;
  }

  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {}
    onEvent({ type: 'error', message: friendlyHttpError(res.status, text) });
    return;
  }

  const ctype = res.headers.get('content-type') ?? '';
  if (!/event-stream/.test(ctype) || !res.body) {
    // 有些网关不支持流式，退化成一次性读取
    let text = '';
    try {
      text = await res.text();
    } catch {}
    try {
      const json = JSON.parse(text) as OpenAiChunk & AnthropicChunk & { content?: { type?: string; text?: string; thinking?: string }[]; stop_reason?: string | null };
      if (style === 'anthropic') {
        const t = (json.content ?? []).map((c) => c.text ?? '').join('');
        const thinking = (json.content ?? []).map((c) => c.thinking ?? '').join('');
        if (thinking) onEvent({ type: 'thinking', text: thinking });
        if (t) onEvent({ type: 'delta', text: t });
        onEvent({ type: 'done', usage: json.usage, stopReason: json.stop_reason ?? null });
      } else {
        const d = extractOpenAIDelta(json);
        if (d.thinking) onEvent({ type: 'thinking', text: d.thinking });
        if (d.text) onEvent({ type: 'delta', text: d.text });
        onEvent({ type: 'done', usage: json.usage, stopReason: d.finish ?? null });
      }
    } catch {
      onEvent({ type: 'error', message: `上游返回了无法解析的内容（content-type: ${ctype}）\n${text.slice(0, 500)}` });
    }
    return;
  }

  let usage: unknown = null;
  let stopReason: string | null = null;
  try {
    for await (const data of sseDataLines(res)) {
      if (!data || data === '[DONE]') continue;
      let json: OpenAiChunk & AnthropicChunk;
      try {
        json = JSON.parse(data) as OpenAiChunk & AnthropicChunk;
      } catch {
        continue;
      }
      const delta = style === 'anthropic' ? extractAnthropicDelta(json) : extractOpenAIDelta(json);
      if (delta.error) {
        onEvent({ type: 'error', message: delta.error });
        return;
      }
      if (delta.thinking) onEvent({ type: 'thinking', text: delta.thinking });
      if (delta.text) onEvent({ type: 'delta', text: delta.text });
      if (delta.usage) usage = delta.usage;
      if (delta.finish || delta.stopReason) stopReason = delta.finish ?? delta.stopReason ?? null;
    }
  } catch (err) {
    if (signal?.aborted) {
      onEvent({ type: 'done', aborted: true, usage, stopReason });
      return;
    }
    onEvent({ type: 'error', message: `读取流式响应时中断：${(err as Error)?.message}` });
    return;
  }
  onEvent({ type: 'done', usage, stopReason });
}

export interface TestResult {
  ok: boolean;
  url?: string;
  style?: string;
  model?: string;
  latencyMs?: number;
  reply?: string;
  message?: string;
}

/** 设置面板里的「测试连接」 */
export async function testConnection(ai: AiConfig): Promise<TestResult> {
  let url = '';
  let style: ApiStyle = 'openai';
  try {
    const resolved = endpointFor(ai);
    url = resolved.url;
    style = resolved.style;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  try {
    headers = authHeaders(ai, style);
    body = buildBody(ai, [{ role: 'user', content: 'ping：只回复两个字「可用」' }], false).body;
  } catch (err) {
    return { ok: false, message: (err as Error).message, url };
  }
  if (style === 'anthropic') body.max_tokens = 32;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, message: friendlyHttpError(res.status, text), url };
    const json = JSON.parse(text) as OpenAiChunk & AnthropicChunk & { content?: { text?: string }[] };
    const reply =
      style === 'anthropic'
        ? (json.content ?? []).map((c) => c.text ?? '').join('')
        : extractOpenAIDelta(json).text ?? '';
    return { ok: true, url, style, model: String(body.model), latencyMs: Date.now() - t0, reply: String(reply).slice(0, 60) };
  } catch (err) {
    const e = err as Error;
    const msg = e?.name === 'TimeoutError' ? '请求超时（30s），检查网络 / 代理' : String(e?.message);
    return { ok: false, message: `${msg}\n目标地址：${url}`, url };
  }
}

/* --------------------------------------------------- 提示词组装 */

export interface BuildMessagesInput {
  messages?: ChatMessage[];
  document?: string;
  selection?: { text?: string } | null;
  mode?: 'chat' | 'jd';
  extra?: string;
  systemExtra?: string;
  systemPrompt?: string;
}

export function buildMessages(input: BuildMessagesInput): ChatMessage[] {
  const { messages = [], document: doc, selection, mode = 'chat', extra = '', systemExtra = '', systemPrompt = DEFAULT_SYSTEM_PROMPT } = input;
  const sys = [systemPrompt, systemExtra].filter(Boolean).join('\n\n');
  const context: string[] = [];
  if (typeof doc === 'string' && doc.trim()) {
    context.push(`# 当前编辑文件的完整源码（Typst）\n\`\`\`typst\n${doc}\n\`\`\``);
  } else if (typeof doc === 'string') {
    context.push('# 当前编辑文件为空\n如果用户要求编写或生成内容，请直接从零生成 Typst 初稿，不要只提问；缺少的个人信息和数据用明确的待填写占位符，不能编造事实。如果用户只是咨询问题，则正常回答');
  }
  if (selection?.text?.trim()) {
    context.push(`# 用户当前选中的片段\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\``);
  }
  if (mode === 'jd') {
    context.push('# 本次任务：按目标岗位 JD 定制简历。先给出「匹配度分析 + 关键词缺口」，再输出所需的局部修改。');
  }
  context.push(`# 编辑器修改协议
当用户要求修改或生成文件内容时，返回一个标记为 typst-edit 的 Markdown 代码块，内容为 JSON 对象，格式为 {"edits":[{"search":"原文","replace":"修改后的文本"}]}。
search 必须逐字匹配当前文件中的原文且在文件中恰好出现一次，保留空格、换行和标点；如原文重复，加入足够的前后文以保证唯一。replace 是替换该 search 后的文本，未改动的前后文必须保留。所有修改必须基于当前文件，互不重叠。仅返回有变化的片段，不要输出完整文件，也不要把多处不相邻的修改合并成整份源码。
JSON 字符串中的换行和引号必须正确转义。不要额外添加或删除文件末尾的空行，除非用户明确要求。
只有当前文件完全为空时，才允许使用空 search，此时只能有一条修改，replace 包含完整新文件。对普通提问正常回答，不需要返回修改代码块。此协议用于编辑器安全校验，优先于其他关于输出完整文件的格式要求。`);
  const head: ChatMessage[] = [
    ...(sys ? [{ role: 'system' as const, content: sys }] : []),
    ...(context.length ? [{ role: 'system' as const, content: context.join('\n\n') }] : []),
  ];
  const rest = messages
    .filter((m): m is ChatMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !!m.content.trim())
    .slice(-24);
  if (rest.length === 0) {
    rest.push({ role: 'user', content: `请先通读我的简历，给出 3 条最重要的改进建议。${extra ? `\n${extra}` : ''}` });
  }
  return [...head, ...rest];
}
