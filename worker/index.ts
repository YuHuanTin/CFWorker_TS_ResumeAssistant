/**
 * ResumeAssistant —— Cloudflare Worker
 *
 * 静态页面由 Workers Static Assets 托管；Typst 编译在浏览器 WASM 里完成。
 * Worker 只做一件事：AI 代理（解决浏览器 CORS、隐藏服务端默认 Key）。
 *
 *   GET  /api/ai/info   服务端是否配置了默认 AI（不泄露 Key）
 *   POST /api/ai/test   测试连通性
 *   POST /api/ai/chat   流式对话（SSE，统一成 {type:'delta'|...} 事件）
 *
 * Key 的两种来源：
 *   1) 用户在网页「设置」里填自己的 baseUrl/apiKey/model（存浏览器本地，请求时随 body 发送）
 *   2) 站长用 `wrangler secret put AI_API_KEY` 配置的默认值（AI_BASE_URL / AI_MODEL 写在 vars）
 * 若设置了 ACCESS_TOKEN，则使用服务端默认 Key 时必须带 x-access-token，防止被白嫖。
 */
import { buildMessages, endpointFor, listModels, streamChat, testConnection, type AiConfig, type ChatMessage } from './ai';

export interface Env {
  ASSETS: Fetcher;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_API_STYLE?: string;
  ACCESS_TOKEN?: string;
}

type ClientAi = Partial<AiConfig>;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** 合并：用户自带配置优先；用户没给 Key 时才回落到服务端默认 */
function resolveAi(env: Env, client: ClientAi, req: Request): { ai: AiConfig } | { error: string; status: number } {
  const userHasKey = !!client.apiKey?.trim();
  if (!userHasKey) {
    if (!env.AI_API_KEY) return { error: '还没有配置 AI：请在「设置」里填写接口地址和 API Key', status: 400 };
    if (env.ACCESS_TOKEN && req.headers.get('x-access-token') !== env.ACCESS_TOKEN) {
      return { error: '使用站点默认 AI 需要访问口令（设置 → 访问口令），或填写你自己的 API Key', status: 401 };
    }
  }
  return {
    ai: {
      baseUrl: (userHasKey ? client.baseUrl : client.baseUrl || env.AI_BASE_URL) ?? '',
      apiKey: userHasKey ? client.apiKey!.trim() : env.AI_API_KEY!,
      model: client.model || env.AI_MODEL || '',
      apiStyle: (client.apiStyle || env.AI_API_STYLE || 'auto') as AiConfig['apiStyle'],
      temperature: typeof client.temperature === 'number' ? client.temperature : 0.6,
      maxTokens: Number(client.maxTokens) > 0 ? Number(client.maxTokens) : 8192,
      systemExtra: client.systemExtra ?? '',
      systemPrompt: client.systemPrompt,
    },
  };
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/api/ai/info' && req.method === 'GET') {
    let endpoint: string | null = null;
    try {
      if (env.AI_BASE_URL) endpoint = endpointFor({ baseUrl: env.AI_BASE_URL, apiStyle: (env.AI_API_STYLE ?? 'auto') as AiConfig['apiStyle'] } as AiConfig).url;
    } catch {}
    return json({ serverDefault: !!env.AI_API_KEY, model: env.AI_MODEL ?? '', endpoint, needsToken: !!env.ACCESS_TOKEN });
  }

  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  let body: { ai?: ClientAi; messages?: ChatMessage[]; document?: string; selection?: { text?: string } | null; mode?: 'chat' | 'jd' };
  try {
    body = await req.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }
  const resolved = resolveAi(env, body.ai ?? {}, req);
  if ('error' in resolved) return json({ ok: false, error: resolved.error, message: resolved.error }, resolved.status);

  if (url.pathname === '/api/ai/test') return json(await testConnection(resolved.ai));
  if (url.pathname === '/api/ai/models') return json(await listModels(resolved.ai, req.signal));

  if (url.pathname === '/api/ai/chat') {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (evt: unknown): void => void writer.write(enc.encode(`data: ${JSON.stringify(evt)}\n\n`)).catch(() => {});
    const run = async (): Promise<void> => {
      try {
        const messages = buildMessages({
          messages: body.messages ?? [],
          document: body.document,
          selection: body.selection ?? null,
          mode: body.mode ?? 'chat',
          systemExtra: resolved.ai.systemExtra,
          systemPrompt: resolved.ai.systemPrompt,
        });
        await streamChat({ ai: resolved.ai, messages, onEvent: send, signal: req.signal });
      } catch (err) {
        send({ type: 'error', message: String((err as Error)?.message ?? err) });
      } finally {
        send({ type: 'end' });
        await writer.close().catch(() => {});
      }
    };
    // 流在后台持续写入，Response 立刻返回
    void run();
    return new Response(readable, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform' },
    });
  }
  return json({ error: 'Not Found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, url);
      } catch (err) {
        return json({ error: String((err as Error)?.message ?? err) }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
