/**
 * Typst 编译 Web Worker —— 整个 Typst 编译器以 WASM 形式跑在浏览器里
 *
 * 为什么放在 Worker：编译是同步 CPU 活，放主线程会卡住打字；放 Worker 里，
 * 编辑器永远流畅，编译器复用同一实例享受增量缓存（改一个字通常十几毫秒）。
 *
 * 协议（主线程 <-> Worker）：
 *   -> { t: 'compile', seq, source }          latest-wins，连续输入只编最新一份
 *   -> { t: 'pdf', id, source }
 *   -> { t: 'fonts', fonts: Uint8Array[] }     追加用户字体（本机字体 / 上传）
 *   <- { t: 'status', phase, detail }
 *   <- { t: 'progress', loaded, total }      编译器 wasm 下载进度（字节）
 *   <- { t: 'ready', initMs }
 *   <- { t: 'result', seq, ok, svg, diagnostics, compileMs, renderMs }
 *   <- { t: 'pdf', id, ok, data?, diagnostics }
 */
import {
  createTypstCompiler,
  createTypstFontBuilder,
  createTypstRenderer,
  initOptions,
  type TypstCompiler,
} from '@myriaddreamin/typst.ts';

const { preloadFontAssets, loadFonts } = initOptions;
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';
import type { WorkspaceFile } from '../types';

/** 编译器 wasm 约 28MB，超过 Cloudflare 静态资源单文件 25MiB 上限，所以走 jsDelivr */
const COMPILER_WASM =
  'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm';

/** 中文字体（Noto Sans/Serif CJK SC，typst 官方同源）+ typst 自带西文字体 */
const CJK_FONTS = [
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
  'https://cdn.jsdelivr.net/gh/typst/typst-dev-assets@v0.13.1/files/fonts/NotoSerifCJKsc-Regular.otf',
];

const FONT_CACHE = 'resume-assistant-fonts-v1';

type Renderer = Awaited<ReturnType<typeof createTypstRenderer>> & {
  renderSvg(o: { format: 'vector'; artifactContent: Uint8Array }): Promise<string>;
};

interface Diag {
  severity: 'error' | 'warning';
  message: string;
  hint: string;
  line: number | null;
  column: number | null;
  path?: string;
}

let compiler: TypstCompiler | null = null;
let renderer: Renderer | null = null;
let pending: { seq: number; files: Record<string, WorkspaceFile>; mainFile: string } | null = null;
let mappedFiles = new Map<string, string>();
let busy = false;
const userFonts: Uint8Array[] = [];

const post = (msg: unknown, transfer?: Transferable[]): void =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

/* ------------------------------------------------------------ 字体缓存 */

/**
 * 同一次会话里同一个 URL 只下载一次。
 * 预热（下方 fontsReady）与 typst.ts 的字体加载器会同时请求同一批字体，
 * 没有这层去重时中文字体会被完整下载两遍（26MB → 多等十几秒）。
 */
const inflight = new Map<string, Promise<Uint8Array>>();

async function fetchAndCache(url: string): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(FONT_CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {}
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** 带 Cache Storage + 并发去重的 fetch：字体只下载一次，之后秒开 */
function cachedFetch(url: string): Promise<Uint8Array> {
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = fetchAndCache(url).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/**
 * 带进度上报的下载：进度条要能反映真实字节数，
 * 否则首次打开 27MB 会一直卡在一句「正在下载」，看起来像死了。
 */
function reportProgress(): (loaded: number, total: number) => void {
  let last = 0;
  return (loaded, total) => {
    const now = performance.now();
    const done = total > 0 && loaded >= total;
    if (!done && now - last < 120) return;
    last = now;
    post({ t: 'progress', loaded, total });
  };
}

/** 流式下载并累计进度 */
async function fetchWithProgress(url: string): Promise<Uint8Array> {
  const onProgress = reportProgress();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  // 注意：CDN 会带 content-encoding，content-length 是压缩后的字节数，
  // 而 reader 读到的是解压后的字节数，两者不能直接相除（会出现 27/9MB 这种进度）。
  // 所以只用 content-length 判断「是不是压缩传输」，进度按读到解压字节的绝对量上报，
  // 由主线程在完成时收尾到 100%。
  const encoded = !!res.headers.get('content-encoding');
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    onProgress(0, all.length);
    onProgress(all.length, all.length);
    return all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      // 压缩传输时总量不可知，传 0 表示「只有已下载量」
      onProgress(loaded, encoded ? 0 : Number(res.headers.get('content-length')) || 0);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  onProgress(loaded, loaded);
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const cachedFetcher = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const bytes = await cachedFetch(url);
  return new Response(bytes as BlobPart);
}) as typeof fetch;

/* ------------------------------------------------------------ 初始化 */

async function init(): Promise<void> {
  const t0 = performance.now();
  post({ t: 'status', phase: 'wasm', detail: '准备 Typst 编译器…' });

  // 字体与 wasm 并行搬运：字体先走 Cache Storage 预热，避免与 wasm 串行等待
  const fontsReady = Promise.all(CJK_FONTS.map((u) => cachedFetch(u).catch(() => null)));

  const c = createTypstCompiler();
  await c.init({
    // 编译器 wasm 走自带进度的下载；重复访问由 HTTP 缓存命中（没有再包一层 Cache Storage）
    getModule: async () => {
      const bytes = await fetchWithProgress(COMPILER_WASM);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    beforeBuild: [
      preloadFontAssets({ assets: ['text'], fetcher: cachedFetcher }),
      // 官方路径：给 URL 列表 + 自定义 fetcher（带 Cache Storage），由 typst.ts 自己抓取并注册
      loadFonts(CJK_FONTS, { assets: false, fetcher: cachedFetcher }),
    ] as never,
  });
  compiler = c;

  const r = createTypstRenderer();
  await r.init({ getModule: () => rendererWasmUrl });
  renderer = r as Renderer;
  await fontsReady;

  post({ t: 'ready', initMs: Math.round(performance.now() - t0) });
  void drain();
}

/** 用户追加字体：重建字体解析器后挂到编译器上 */
async function addFonts(fonts: Uint8Array[]): Promise<void> {
  userFonts.push(...fonts);
  if (!compiler) return;
  const fb = createTypstFontBuilder();
  await fb.init();
  for (const u of await Promise.all(CJK_FONTS.map((x) => cachedFetch(x).catch(() => null)))) {
    if (u) await fb.addFontData(u);
  }
  for (const f of userFonts) await fb.addFontData(f);
  await fb.build(async (resolver) => compiler!.setFonts(resolver));
  post({ t: 'status', phase: 'fonts-added', detail: `已加载 ${fonts.length} 款本机字体` });
}

/* ------------------------------------------------------------ 诊断 */

interface RawDiag {
  severity?: string;
  message?: string;
  range?: string;
  path?: string;
}

/** range 形如 "3:4-3:12"（行列从 0 开始） */
function normalize(list: unknown[] | undefined): Diag[] {
  const out: Diag[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const d = (typeof raw === 'string' ? { message: raw } : raw) as RawDiag;
    const msg = String(d.message ?? '').trim();
    if (!msg) continue;
    const [main, ...hints] = msg.split(/, hints?: /);
    const m = /^(\d+):(\d+)/.exec(String(d.range ?? ''));
    const line = m ? Number(m[1]) + 1 : null;
    const column = m ? Number(m[2]) + 1 : null;
    const severity: Diag['severity'] = /warn/i.test(String(d.severity)) ? 'warning' : 'error';
    const path = d.path?.replace(/^\/+/, '') || undefined;
    const key = `${severity}|${main}|${path}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity, message: main!.trim(), hint: hints.join('; ').trim(), line, column, path });
  }
  return out;
}

/* ------------------------------------------------------------ 编译 */

function syncFiles(files: Record<string, WorkspaceFile>): void {
  if (!compiler) return;
  for (const path of mappedFiles.keys()) {
    if (!(path in files)) compiler.unmapShadow('/' + path);
  }
  for (const [path, content] of Object.entries(files)) {
    const key = typeof content === 'string' ? `text:${content}` : `binary:${content.base64}`;
    if (mappedFiles.get(path) === key) continue;
    if (typeof content === 'string') compiler.addSource('/' + path, content);
    else compiler.mapShadow('/' + path, Uint8Array.from(atob(content.base64), (c) => c.charCodeAt(0)));
    mappedFiles.set(path, key);
  }
  for (const path of mappedFiles.keys()) if (!(path in files)) mappedFiles.delete(path);
}

async function drain(): Promise<void> {
  if (busy || !compiler || !renderer) return;
  busy = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      const t0 = performance.now();
      syncFiles(job.files);
      let vector: Uint8Array | undefined;
      let diagnostics: Diag[] = [];
      try {
        const res = await compiler.compile({ mainFilePath: '/' + job.mainFile, format: 0, diagnostics: 'full' } as never);
        vector = (res as { result?: Uint8Array }).result;
        diagnostics = normalize((res as { diagnostics?: unknown[] }).diagnostics);
      } catch (err) {
        diagnostics = [{ severity: 'error', message: String((err as Error)?.message ?? err), hint: '', line: null, column: null }];
      }
      const compileMs = performance.now() - t0;
      const ok = !!vector && !diagnostics.some((d) => d.severity === 'error');
      let svg: string | null = null;
      const t1 = performance.now();
      if (vector && vector.length) {
        try {
          svg = await renderer.renderSvg({ format: 'vector', artifactContent: vector });
        } catch (err) {
          diagnostics.push({ severity: 'error', message: `渲染失败：${(err as Error).message}`, hint: '', line: null, column: null });
        }
      }
      post({
        t: 'result',
        seq: job.seq,
        ok: ok && !!svg,
        svg,
        diagnostics,
        compileMs: +compileMs.toFixed(1),
        renderMs: +(performance.now() - t1).toFixed(1),
      });
    }
  } finally {
    busy = false;
  }
}

async function exportPdf(id: number, files: Record<string, WorkspaceFile>, mainFile: string): Promise<void> {
  if (!compiler) {
    post({ t: 'pdf', id, ok: false, diagnostics: [{ severity: 'error', message: '编译器尚未就绪', hint: '', line: null, column: null }] });
    return;
  }
  syncFiles(files);
  try {
    const res = await compiler.compile({ mainFilePath: '/' + mainFile, format: 1, diagnostics: 'full' } as never);
    const data = (res as { result?: Uint8Array }).result;
    const diagnostics = normalize((res as { diagnostics?: unknown[] }).diagnostics);
    if (!data) {
      post({ t: 'pdf', id, ok: false, diagnostics });
      return;
    }
    post({ t: 'pdf', id, ok: true, data, diagnostics }, [data.buffer as ArrayBuffer]);
  } catch (err) {
    post({ t: 'pdf', id, ok: false, diagnostics: [{ severity: 'error', message: String((err as Error).message), hint: '', line: null, column: null }] });
  }
}

/* ------------------------------------------------------------ 入口 */

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as { t: string; seq?: number; id?: number; files?: Record<string, WorkspaceFile>; mainFile?: string; fonts?: Uint8Array[] };
  if (msg.t === 'compile' && msg.files) {
    pending = { seq: msg.seq ?? 0, files: msg.files, mainFile: msg.mainFile ?? 'main.typ' };
    void drain();
  } else if (msg.t === 'pdf' && msg.files) {
    void exportPdf(msg.id ?? 0, msg.files, msg.mainFile ?? 'main.typ');
  } else if (msg.t === 'fonts' && msg.fonts) {
    void addFonts(msg.fonts).catch((e: Error) => post({ t: 'status', phase: 'warn', detail: `字体加载失败：${e.message}` }));
  }
};

init().catch((err: Error) => post({ t: 'fatal', message: `Typst 编译器初始化失败：${err?.message ?? err}` }));
