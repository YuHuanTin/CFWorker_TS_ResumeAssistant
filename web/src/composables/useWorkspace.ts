/**
 * 全局工作区状态
 *
 * 数据流：编辑器 -> source -> Web Worker（Typst WASM）-> SVG -> 预览
 * 简历存储在 IndexedDB，设置存储在 localStorage。
 */
import { computed, reactive, watch } from 'vue';
import { splitSvgDocument, type PageSlice } from '../lib/svgPages';
import { TEMPLATES } from '../lib/templates';
import { DEFAULT_SYSTEM_PROMPT } from '../lib/systemPrompt';
import type { ChatMessage, Diagnostic, ResumeRecord, ResumeSummary, Selection, Template, WorkspaceFile } from '../types';

const PREFS_KEY = 'resume-assistant:prefs';
const DOCS_KEY = 'resume-assistant:docs';
const AI_KEY = 'resume-assistant:ai';

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiStyle: 'auto' | 'openai' | 'anthropic';
  temperature: number;
  maxTokens: number;
  systemExtra: string;
  systemPrompt: string;
  accessToken: string;
}

const DEFAULT_AI: AiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  apiStyle: 'auto',
  temperature: 0.6,
  maxTokens: 8192,
  systemExtra: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  accessToken: '',
};

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

interface Prefs {
  theme: 'light' | 'dark';
  aiOpen: boolean;
  editorFontSize: number;
  zoom: number;
  zoomMode: 'fit' | 'manual';
  lastDocId: string;
}

const prefs = readLS<Prefs>(PREFS_KEY, {
  theme: matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  aiOpen: true,
  editorFontSize: 13,
  zoom: 1,
  zoomMode: 'fit',
  lastDocId: '',
});

export type EngineStatus = 'loading' | 'ready' | 'error';

export const state = reactive({
  /* 文档 */
  docId: '',
  name: '我的简历',
  source: '',
  savedSource: '',
  files: {} as Record<string, WorkspaceFile>,
  activeFile: 'main.typ',
  previewEntry: 'main.typ' as string | null,
  filePreview: null as string | null,
  lastSavedAt: 0,
  saving: false,

  resumeList: [] as ResumeSummary[],
  templates: TEMPLATES as Template[],

  /* 渲染 */
  pages: [] as PageSlice[],
  hasRender: false,
  /** 已经收到过至少一次编译结果（哪怕是错误），用于区分「还没编译」和「编译失败」 */
  firstResult: false,
  ok: true,
  diagnostics: [] as Diagnostic[],
  stats: { compileMs: 0, renderMs: 0, rttMs: 0, bytes: 0, count: 0 },
  engine: 'loading' as EngineStatus,
  engineDetail: '启动 Typst 编译器…',
  engineInitMs: 0,
  /** 编译器下载进度 0–1，null 表示还没开始或已就绪 */
  engineProgress: null as number | null,

  /* 交互 */
  selection: { from: 0, to: 0, text: '', lines: 0 } as Selection,
  jumpTarget: { line: 0, nonce: 0 },
  applyRequest: { code: '', nonce: 0, label: '' },
  theme: prefs.theme,
  aiOpen: prefs.aiOpen,
  editorFontSize: prefs.editorFontSize,
  zoom: prefs.zoom,
  zoomMode: prefs.zoomMode,

  /* AI */
  ai: readLS<AiSettings>(AI_KEY, DEFAULT_AI),
  serverAi: { serverDefault: false, model: '', needsToken: false },
  messages: [] as ChatMessage[],
  generating: false,
  aiDraft: '',
  aiDraftTarget: null as { docId: string; path: string } | null,
  aiReview: null as { docId: string; path: string; source: string; proposed: string } | null,

  toasts: [] as { id: number; text: string; kind: 'info' | 'ok' | 'error' }[],
  logs: [] as { id: number; text: string; kind: 'info' | 'ok' | 'error'; time: number }[],
});

export const dirty = computed(() => state.source !== state.savedSource);

/* ------------------------------------------------------------ 提示气泡 */

let toastSeq = 0;
export function notify(text: string, kind: 'info' | 'ok' | 'error' = 'info', ms = 3600): void {
  const id = ++toastSeq;
  state.toasts.push({ id, text, kind });
  state.logs.unshift({ id, text, kind, time: Date.now() });
  if (state.logs.length > 100) state.logs.pop();
  window.setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  const i = state.toasts.findIndex((t) => t.id === id);
  if (i >= 0) state.toasts.splice(i, 1);
}

/* ------------------------------------------------------------ 偏好 */

export function persistPrefs(): void {
  writeLS(PREFS_KEY, {
    theme: state.theme,
    aiOpen: state.aiOpen,
    editorFontSize: state.editorFontSize,
    zoom: state.zoom,
    zoomMode: state.zoomMode,
    lastDocId: state.docId,
  } satisfies Prefs);
}

export function toggleTheme(): void {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  persistPrefs();
}

export function setEditorFontSize(size: number): void {
  state.editorFontSize = Math.min(22, Math.max(11, size));
  persistPrefs();
}

export function saveAiSettings(next: AiSettings): boolean {
  if (!writeLS(AI_KEY, next)) return false;
  state.ai = { ...next };
  return true;
}

/* ------------------------------------------------------------ 编译 Worker */

let worker: Worker | null = null;
let seq = 0;
let lastApplied = 0;
let lastSvg = '';
const sentAt = new Map<number, number>();
let pdfSeq = 0;
const pdfWaiters = new Map<number, (r: { ok: boolean; data?: Uint8Array; diagnostics: Diagnostic[] }) => void>();

function applyResult(msg: {
  seq: number;
  ok: boolean;
  svg: string | null;
  diagnostics: Diagnostic[];
  compileMs: number;
  renderMs: number;
}): void {
  if (msg.seq < lastApplied) return;
  lastApplied = msg.seq;
  const t = sentAt.get(msg.seq);
  sentAt.clear();

  state.firstResult = true;
  state.ok = msg.ok;
  state.diagnostics = msg.diagnostics ?? [];
  state.stats = {
    compileMs: msg.compileMs,
    renderMs: msg.renderMs,
    rttMs: t ? performance.now() - t : 0,
    bytes: msg.svg?.length ?? 0,
    count: state.stats.count + 1,
  };
  // 有错误时保留上一版画面，避免打字过程中预览闪白
  if (msg.svg && msg.svg !== lastSvg) {
    lastSvg = msg.svg;
    const next = splitSvgDocument(msg.svg);
    state.pages = next.map((page, i) => {
      const prev = state.pages[i];
      return prev && prev.html === page.html ? prev : page;
    });
  }
  state.hasRender = state.pages.length > 0;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../lib/typst.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as Record<string, unknown> & { t: string };
    switch (msg.t) {
      case 'status':
        if (msg.phase === 'warn') notify(String(msg.detail), 'error', 6000);
        else if (msg.phase === 'fonts-added') notify(String(msg.detail), 'ok');
        else state.engineDetail = String(msg.detail);
        break;
      case 'ready':
        state.engine = 'ready';
        state.engineInitMs = Number(msg.initMs);
        state.engineDetail = '';
        state.engineProgress = null;
        break;
      case 'progress': {
        const total = Number(msg.total) || 0;
        const loaded = Number(msg.loaded) || 0;
        // 压缩传输时 total=0：只显示已下载量，完成时（loaded===total>0）由 ready 收尾
        if (total > 0 && loaded >= total) {
          state.engineProgress = 1;
          state.engineDetail = `编译器已下载（${(loaded / 1048576).toFixed(0)} MB），正在初始化…`;
        } else {
          state.engineDetail = `下载 Typst 编译器 ${(loaded / 1048576).toFixed(1)} MB`;
          // 无总量信息时用 27MB 作为参照做个近似进度，只用于视觉反馈
          state.engineProgress = total > 0 ? Math.min(0.99, loaded / total) : Math.min(0.95, loaded / (27 * 1048576));
        }
        break;
      }
      case 'fatal':
        state.engine = 'error';
        state.engineDetail = String(msg.message);
        state.engineProgress = null;
        notify(String(msg.message), 'error', 10000);
        break;
      case 'result':
        applyResult(msg as never);
        break;
      case 'pdf': {
        const cb = pdfWaiters.get(Number(msg.id));
        pdfWaiters.delete(Number(msg.id));
        cb?.(msg as never);
        break;
      }
    }
  };
  worker.onerror = (e) => {
    state.engine = 'error';
    state.engineDetail = `编译 Worker 崩溃：${e.message}`;
    state.engineProgress = null;
  };
  return worker;
}

/** 每次内容变化都调用；Worker 内部 latest-wins，无需防抖 */
export function requestRender(source: string): void {
  state.source = source;
  state.files[state.activeFile] = source;
  const s = ++seq;
  if (!state.previewEntry) {
    lastApplied = s;
    sentAt.clear();
    return;
  }
  sentAt.set(s, performance.now());
  ensureWorker().postMessage({ t: 'compile', seq: s, files: snapshotFiles(), mainFile: state.previewEntry });
}

function snapshotFiles(): Record<string, WorkspaceFile> {
  return Object.fromEntries(Object.entries(state.files).map(([path, file]) => [path, typeof file === 'string' ? file : { base64: file.base64 }]));
}

export function compilePdf(source: string): Promise<{ ok: boolean; data?: Uint8Array; diagnostics: Diagnostic[] }> {
  if (!state.previewEntry) return Promise.resolve({ ok: false, diagnostics: [{ severity: 'error', message: '请先选择预览文件', hint: '', line: null }] });
  const id = ++pdfSeq;
  return new Promise((resolve) => {
    pdfWaiters.set(id, resolve);
    const files = { ...snapshotFiles(), [state.activeFile]: source };
    ensureWorker().postMessage({ t: 'pdf', id, files, mainFile: state.previewEntry });
  });
}

/** 把本机字体文件喂给编译器（浏览器无法直接读系统字体） */
export async function addFontFiles(files: FileList | File[]): Promise<void> {
  const buffers = await Promise.all(Array.from(files).map(async (f) => new Uint8Array(await f.arrayBuffer())));
  ensureWorker().postMessage({ t: 'fonts', fonts: buffers }, buffers.map((b) => b.buffer));
  requestRender(state.source);
}

/* ------------------------------------------------------------ 文档存储 */

type DocStore = Record<string, ResumeRecord>;

let docsCache: DocStore = {};
let db: IDBDatabase | null = null;
let writes: Promise<void> = Promise.resolve();
const readDocs = (): DocStore => ({ ...docsCache });

function snapshotMessages(): ChatMessage[] {
  return state.messages.map((message) => ({
    ...message,
    ...(message.editTarget ? { editTarget: { ...message.editTarget } } : {}),
    ...(message.streaming ? { streaming: false, error: true, completionNotice: '回复未完成，可重新发送请求' } : {}),
  }));
}

async function initDocs(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('resume-assistant', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db = database;
  const stored = await new Promise<DocStore | undefined>((resolve, reject) => {
    const request = database.transaction('documents').objectStore('documents').get('all');
    request.onsuccess = () => resolve(request.result as DocStore | undefined);
    request.onerror = () => reject(request.error);
  });
  if (stored) docsCache = stored;
  else {
    docsCache = readLS<DocStore>(DOCS_KEY, {});
    await writeDocs(docsCache);
  }
}

function writeDocs(docs: DocStore): Promise<boolean> {
  const snapshot = JSON.parse(JSON.stringify(docs)) as DocStore;
  docsCache = snapshot;
  const operation = writes.then(() => new Promise<void>((resolve, reject) => {
    if (!db) { reject(new Error('IndexedDB unavailable')); return; }
    const transaction = db.transaction('documents', 'readwrite');
    transaction.objectStore('documents').put(snapshot, 'all');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
  writes = operation.catch(() => {});
  return operation.then(() => true, () => {
    notify('浏览器存储不可用或空间不足，文件尚未保存，请下载文件备份', 'error', 8000);
    return false;
  });
}

const newId = (): string =>
  typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function refreshResumes(): void {
  state.resumeList = Object.values(readDocs())
    .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, chars: r.source.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadResume(id: string): void {
  if (chatSaveTimer !== null) { window.clearTimeout(chatSaveTimer); chatSaveTimer = null; }
  if (state.docId && state.docId !== id) saveResume(true);
  const rec = readDocs()[id];
  if (!rec) return;
  state.docId = rec.id;
  state.name = rec.name;
  state.messages = (rec.messages ?? []).map((message) => ({ ...message, streaming: false }));
  state.aiDraft = rec.aiDraft ?? '';
  state.aiDraftTarget = rec.aiDraftTarget?.docId === rec.id ? { ...rec.aiDraftTarget } : null;
  state.files = { ...(rec.files ?? {}), 'main.typ': rec.source };
  state.previewEntry = rec.previewEntry === null ? null : rec.previewEntry && typeof state.files[rec.previewEntry] === 'string' && /\.typ$/i.test(rec.previewEntry) ? rec.previewEntry : 'main.typ';
  state.filePreview = null;
  state.activeFile = 'main.typ';
  state.savedSource = rec.source;
  state.lastSavedAt = rec.updatedAt;
  state.pages = [];
  state.hasRender = false;
  state.firstResult = false;
  lastSvg = '';
  persistPrefs();
  // 走编辑器事务替换内容（EditorPane 监听 applyRequest）
  state.source = rec.source;
  state.applyRequest = { code: rec.source, nonce: state.applyRequest.nonce + 1, label: '' };
  requestRender(rec.source);
}

export function saveResume(silent = false): void {
  if (!state.docId) return;
  const docs = readDocs();
  const prev = docs[state.docId];
  const now = Date.now();
  docs[state.docId] = {
    id: state.docId,
    name: state.name.trim() || '未命名简历',
    source: typeof state.files['main.typ'] === 'string' ? state.files['main.typ'] : '',
    files: snapshotFiles(),
    previewEntry: state.previewEntry,
    messages: snapshotMessages(),
    aiDraft: state.aiDraft,
    aiDraftTarget: state.aiDraftTarget ? { ...state.aiDraftTarget } : null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    chars: state.source.length,
  };
  const docId = state.docId;
  const source = state.source;
  void writeDocs(docs).then((saved) => {
    if (!saved || state.docId !== docId) return;
    state.savedSource = source;
    state.lastSavedAt = now;
    if (!silent) notify('已保存到本浏览器', 'ok', 1600);
  });
  refreshResumes();
}

export function saveAs(name: string, source: string, files?: Record<string, WorkspaceFile>, previewEntry?: string | null): string {
  const docs = readDocs();
  const id = newId();
  const now = Date.now();
  docs[id] = { id, name, source, files: files ? { ...files, 'main.typ': source } : undefined, previewEntry, createdAt: now, updatedAt: now, chars: source.length };
  writeDocs(docs);
  refreshResumes();
  return id;
}

export function removeResume(id: string): void {
  const docs = readDocs();
  delete docs[id];
  if (id === state.docId) state.docId = '';
  writeDocs(docs);
  refreshResumes();
}

export function renameResume(id: string, name: string): void {
  const docs = readDocs();
  const rec = docs[id];
  if (!rec) return;
  rec.name = name;
  if (id === state.docId) {
    state.name = name;
    rec.source = typeof state.files['main.typ'] === 'string' ? state.files['main.typ'] : '';
    rec.files = snapshotFiles();
    rec.previewEntry = state.previewEntry;
    rec.messages = snapshotMessages();
    rec.aiDraft = state.aiDraft;
    rec.aiDraftTarget = state.aiDraftTarget ? { ...state.aiDraftTarget } : null;
  }
  rec.updatedAt = Date.now();
  writeDocs(docs);
  refreshResumes();
}

export function selectFile(path: string): void {
  if (!(path in state.files)) return;
  if (typeof state.files[path] !== 'string' || /\.(svg|png|jpe?g|gif|webp|bmp|avif|pdf|mp3|wav|ogg|mp4|webm)$/i.test(path)) {
    state.filePreview = path;
    return;
  }
  state.filePreview = null;
  if (path === state.activeFile) return;
  saveResume(true);
  state.activeFile = path;
  state.source = state.files[path]!;
  state.savedSource = state.source;
  state.applyRequest = { code: state.source, nonce: state.applyRequest.nonce + 1, label: '' };
}

export function setPreviewEntry(path: string): void {
  if (!/\.typ$/i.test(path) || typeof state.files[path] !== 'string') return;
  state.previewEntry = path === state.previewEntry ? null : path;
  if (!state.previewEntry) {
    state.pages = [];
    state.hasRender = false;
    state.firstResult = false;
    state.diagnostics = [];
    lastSvg = '';
  }
  saveResume(true);
  requestRender(state.source);
}

export function createFile(path: string, content: WorkspaceFile = ''): boolean {
  path = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    notify('请输入有效的文件路径', 'error');
    return false;
  }
  if (path in state.files) {
    notify('文件已存在', 'error');
    return false;
  }
  state.files[path] = content;
  if (typeof content === 'string') selectFile(path);
  saveResume(true);
  requestRender(state.source);
  return true;
}

export function deleteFile(path: string): void {
  if (path === 'main.typ' || !(path in state.files)) return;
  if (state.activeFile === path) selectFile('main.typ');
  if (state.filePreview === path) state.filePreview = null;
  if (state.previewEntry === path) state.previewEntry = 'main.typ';
  delete state.files[path];
  saveResume(true);
  requestRender(state.source);
}

/* ------------------------------------------------------------ 交互 */

export function setSelection(sel: Selection): void {
  state.selection = sel;
}

export function jumpToLine(line: number): void {
  state.jumpTarget = { line, nonce: state.jumpTarget.nonce + 1 };
}

/** 用编辑器事务替换全文（保留撤销历史） */
export function applySource(code: string, label = '应用修改'): void {
  state.applyRequest = { code, nonce: state.applyRequest.nonce + 1, label };
}

/* ------------------------------------------------------------ 启动 */

let initialised = false;

export async function initWorkspace(): Promise<void> {
  if (initialised) return;
  initialised = true;
  document.documentElement.dataset.theme = state.theme;
  ensureWorker();

  try {
    await initDocs();
  } catch {
    docsCache = readLS<DocStore>(DOCS_KEY, {});
    notify('无法打开浏览器文档存储，修改暂时无法保存', 'error', 8000);
  }

  refreshResumes();
  if (state.resumeList.length === 0) {
    const tpl = TEMPLATES.find((t) => t.id === 'classic') ?? TEMPLATES[0];
    saveAs('我的简历', tpl?.source ?? '= 你的名字\n');
  }
  const target = state.resumeList.find((r) => r.id === prefs.lastDocId) ?? state.resumeList[0];
  if (target) loadResume(target.id);

  try {
    const res = await fetch('/api/ai/info');
    if (res.ok) state.serverAi = await res.json();
  } catch {}
}

/* 自动保存：停止输入 1s 后落盘 */
let autoSaveTimer: number | null = null;
watch(
  () => state.source,
  () => {
    if (!state.docId || state.source === state.savedSource) return;
    if (autoSaveTimer !== null) window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => saveResume(true), 1000);
  }
);

// 对话流式更新时定期保存，避免每个 token 都写入 IndexedDB
let chatSaveTimer: number | null = null;
watch(
  () => [state.messages, state.aiDraft, state.aiDraftTarget] as const,
  () => {
    if (!state.docId || chatSaveTimer !== null) return;
    const docId = state.docId;
    chatSaveTimer = window.setTimeout(() => {
      chatSaveTimer = null;
      if (state.docId === docId) saveResume(true);
    }, 1000);
  },
  { deep: true, flush: 'sync' }
);
