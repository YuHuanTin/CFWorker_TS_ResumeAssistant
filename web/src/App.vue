<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EditorPane from './components/EditorPane.vue';
import FilePreview from './components/FilePreview.vue';
import PreviewPane from './components/PreviewPane.vue';
import AiPanel from './components/AiPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import TemplatesDialog from './components/TemplatesDialog.vue';
import FilesDialog from './components/FilesDialog.vue';
import WorkspaceFiles from './components/WorkspaceFiles.vue';
import { confirmation, finishConfirmation } from './composables/useConfirmation';
import { saveBlob } from './lib/api';
import {
  compilePdf,
  dismissToast,
  dirty,
  initWorkspace,
  notify,
  requestRender,
  saveResume,
  setEditorFontSize,
  state,
  toggleTheme,
} from './composables/useWorkspace';

const showTemplates = ref(false);
const showFiles = ref(false);
const previewCollapsed = ref(false);
const activePanel = ref<'files' | 'logs' | 'ai' | 'settings' | null>('files');
const exporting = ref(false);
const shell = ref<HTMLElement | null>(null);
const aiPanel = ref<InstanceType<typeof AiPanel> | null>(null);
/** 用户期望的编辑器宽度（拖动/记忆值），不以窗口大小为准 */
const preferredWidth = ref(Number(localStorage.getItem('resume-assistant:editorWidth') ?? 620));
/** 实际下发给 CSS 的宽度（被窗口大小夹紧后的结果） */
const editorWidth = ref(preferredWidth.value);

/** 编辑器最小宽度 / 预览区必须保住的宽度（窄屏时先压缩编辑器，而不是把预览挤没） */
const MIN_EDITOR = 300;
const MIN_PREVIEW = 300;
/** 与 AiPanel.vue 的 @media (max-width: 1100px) 保持一致：窄屏时 AI 面板是浮层，不占横向空间 */
const AI_PANEL_BREAKPOINT = 1100;
const SIDE_PANEL_WIDTH = 340;
const NAV_WIDTH = 68;

function togglePanel(panel: 'files' | 'logs' | 'ai' | 'settings'): void {
  activePanel.value = activePanel.value === panel ? null : panel;
}

async function openAiAndFocus(): Promise<void> {
  activePanel.value = 'ai';
  await nextTick();
  aiPanel.value?.focusInput();
}

function editorMax(shellWidth: number): number {
  const panel = activePanel.value && window.innerWidth > AI_PANEL_BREAKPOINT ? SIDE_PANEL_WIDTH : 0;
  return Math.max(MIN_EDITOR, shellWidth - NAV_WIDTH - panel - 5 - MIN_PREVIEW);
}

/**
 * 由「期望宽度」算出实际宽度。
 * 注意必须基于 preferredWidth 而不是 editorWidth：否则窄屏时夹紧后的值会被反复当输入，
 * 窗口一恢复原样、或反复开合 AI 面板，编辑器会被一路啃到 MIN_EDITOR 再也回不来。
 */
function clampEditor(): void {
  const width = shell.value?.getBoundingClientRect().width ?? window.innerWidth;
  editorWidth.value = Math.min(Math.max(preferredWidth.value, MIN_EDITOR), editorMax(width));
}

/** 窗口缩放、AI 面板开合后重新夹紧，避免预览被挤成 0 宽 */
let shellObserver: ResizeObserver | null = null;

onMounted(() => {
  void initWorkspace();
  clampEditor();
  if (shell.value) {
    shellObserver = new ResizeObserver(() => clampEditor());
    shellObserver.observe(shell.value);
  }
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', stopDrag);
});

onBeforeUnmount(() => {
  shellObserver?.disconnect();
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', stopDrag);
});

/* ------------------------------------------------------------- 分栏拖动 */

let dragging = false;
function startDrag(ev: PointerEvent): void {
  dragging = true;
  ev.preventDefault();
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}
function onDragMove(ev: PointerEvent): void {
  if (!dragging || !shell.value) return;
  const rect = shell.value.getBoundingClientRect();
  // 拖动记录的是「期望宽度」，再由 clampEditor 决定此刻实际能显示多少，
  // 这样窄屏拖过的值不会污染宽屏的表现
  const panel = activePanel.value && window.innerWidth > AI_PANEL_BREAKPOINT ? SIDE_PANEL_WIDTH : 0;
  preferredWidth.value = Math.min(Math.max(ev.clientX - rect.left - NAV_WIDTH - panel, MIN_EDITOR), editorMax(rect.width));
  clampEditor();
}
function stopDrag(): void {
  if (!dragging) return;
  dragging = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  try {
    localStorage.setItem('resume-assistant:editorWidth', String(Math.round(preferredWidth.value)));
  } catch {}
}

/* ------------------------------------------------------------- 顶部操作 */

const saveStatus = computed(() => {
  if (state.saving) return '保存中…';
  if (!state.docId) return '未加载文档';
  if (dirty.value) return '改动待保存（自动保存已开启）';
  if (!state.lastSavedAt) return '已保存';
  const d = new Date(state.lastSavedAt);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `已保存 · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

async function exportPdf(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const out = await compilePdf(state.source);
    if (!out.ok || !out.data) {
      notify(`导出失败：${out.diagnostics.find((d) => d.severity === 'error')?.message ?? '编译错误'}`, 'error', 6000);
      return;
    }
    saveBlob(new Blob([out.data as BlobPart], { type: 'application/pdf' }), `${state.name || 'resume'}.pdf`);
    notify('PDF 已开始下载', 'ok');
  } catch (err) {
    notify(`导出失败：${(err as Error).message}`, 'error');
  } finally {
    exporting.value = false;
  }
}

function manualSave(): void {
  saveResume();
}

function refresh(): void {
  requestRender(state.source);
}

watch(
  () => activePanel.value,
  () => clampEditor()
);

watch(
  () => state.name,
  (name) => {
    document.title = `${name} · ResumeAssistant`;
  },
  { immediate: true }
);
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-name">ResumeAssistant</span>
        <span class="brand-sub">Typst 实时简历编辑器</span>
      </div>

      <div class="doc-info">
        <input v-model="state.name" class="doc-name" spellcheck="false" />
        <span class="save-status" :class="{ dirty: dirty }">{{ saveStatus }}</span>
      </div>

      <div class="topbar-actions">
        <button class="btn btn-sm" title="重新编译一次" @click="refresh">刷新预览</button>
        <button class="btn btn-sm" title="Ctrl+S" @click="manualSave">保存</button>
        <button class="btn btn-sm primary" :disabled="exporting || state.engine !== 'ready' || !state.previewEntry" @click="exportPdf">
          {{ exporting ? '导出中…' : '导出 PDF' }}
        </button>
        <span class="divider" />
        <button class="btn btn-sm ghost" :title="state.theme === 'dark' ? '切换浅色' : '切换深色'" @click="toggleTheme">
          {{ state.theme === 'dark' ? '☀' : '☾' }}
        </button>
      </div>
    </header>

    <main ref="shell" class="shell" :class="{ 'preview-collapsed': previewCollapsed }" :style="{ '--editor-w': editorWidth + 'px' }">
      <nav class="side-nav" aria-label="工作区导航">
        <button class="nav-item" :class="{ selected: activePanel === 'files' }" :aria-expanded="activePanel === 'files'" type="button" @click="togglePanel('files')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /></svg>
          <span>文件</span>
        </button>
        <button class="nav-item" :class="{ selected: activePanel === 'logs' }" :aria-expanded="activePanel === 'logs'" type="button" @click="togglePanel('logs')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
          <span>日志</span>
          <i v-if="state.diagnostics.length || state.engine === 'error'" class="nav-dot" />
        </button>
        <button class="nav-item" :class="{ selected: activePanel === 'ai' }" :aria-expanded="activePanel === 'ai'" type="button" @click="togglePanel('ai')">
          <span class="nav-spark" aria-hidden="true">✦</span><span>AI 助手</span>
        </button>
        <button class="nav-item" :class="{ selected: activePanel === 'settings' }" :aria-expanded="activePanel === 'settings'" type="button" @click="togglePanel('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.1l1.6-1.3-1.6-2.8-2 .7a7 7 0 0 0-1.9-1.1L14.7 4h-3.4l-.4 2.4a7 7 0 0 0-1.9 1.1l-2-.7-1.6 2.8L7 10.9a7 7 0 0 0 0 2.2l-1.6 1.3L7 17.2l2-.7a7 7 0 0 0 1.9 1.1l.4 2.4h3.4l.4-2.4a7 7 0 0 0 1.9-1.1l2 .7 1.6-2.8-1.6-1.3A7 7 0 0 0 19 12z"/></svg>
          <span>设置</span>
        </button>
      </nav>
      <aside v-show="activePanel" class="workspace-panel">
        <WorkspaceFiles v-show="activePanel === 'files'" @manage="showFiles = true" @templates="showTemplates = true" />
        <div v-show="activePanel === 'logs'" class="logs-panel">
          <header class="logs-head"><strong>日志</strong><button class="btn btn-xs ghost" @click="activePanel = null">收起</button></header>
          <div class="logs-content">
            <section class="log-section">
              <h3>编译状态</h3>
              <p class="log-meta">预览文件：{{ state.previewEntry || '未选择' }}</p>
              <p v-if="state.engine === 'loading'">{{ state.engineDetail || '正在加载编译器…' }}</p>
              <p v-else-if="state.engine === 'error'" class="log-error">{{ state.engineDetail || '编译器加载失败' }}</p>
              <p v-else-if="!state.firstResult">正在等待首次编译…</p>
              <p v-else-if="!state.diagnostics.length">编译通过，没有错误或警告</p>
              <p v-if="state.engine === 'ready'" class="log-meta">浏览器内 Typst 编译器就绪（启动 {{ (state.engineInitMs / 1000).toFixed(1) }}s）</p>
              <p v-if="state.firstResult" class="log-meta">共 {{ state.pages.length }} 页 · 第 {{ state.stats.count }} 次编译<br />编译 {{ state.stats.compileMs.toFixed(1) }} ms · 渲染 {{ state.stats.renderMs.toFixed(1) }} ms · 总计 {{ Math.round(state.stats.rttMs) }} ms</p>
              <ul v-if="state.diagnostics.length" class="log-list"><li v-for="(item, index) in state.diagnostics" :key="index" :class="{ 'log-error': item.severity === 'error' }">{{ item.severity === 'error' ? '错误' : '警告' }}<span v-if="item.path"> · {{ item.path }}</span><span v-if="item.line"> · 第 {{ item.line }} 行</span>：{{ item.message }}<div v-if="item.hint" class="log-meta">{{ item.hint }}</div></li></ul>
            </section>
            <section class="log-section"><div class="log-heading"><h3>会话消息</h3><button v-if="state.logs.length" class="btn btn-xs ghost" @click="state.logs.splice(0)">清空</button></div><p v-if="!state.logs.length" class="log-meta">暂无消息</p><ul v-else class="log-list"><li v-for="item in state.logs" :key="item.id" :class="{ 'log-error': item.kind === 'error' }"><span class="log-meta">{{ new Date(item.time).toLocaleTimeString() }}</span> {{ item.text }}</li></ul></section>
          </div>
        </div>
        <SettingsPanel v-if="activePanel === 'settings'" @close="activePanel = null" />
        <AiPanel ref="aiPanel" v-show="activePanel === 'ai'" @open-settings="activePanel = 'settings'" @close="activePanel = null" />
      </aside>
      <section class="editor-pane">
        <div class="editor-bar">
          <span class="editor-filename">{{ state.filePreview ?? state.activeFile }}</span>
          <button class="btn btn-sm ghost" title="编辑器字号" @click="setEditorFontSize(state.editorFontSize - 1)">A−</button>
          <button class="btn btn-sm ghost" title="编辑器字号" @click="setEditorFontSize(state.editorFontSize + 1)">A＋</button>
        </div>
        <EditorPane v-show="!state.filePreview" @open-ai="openAiAndFocus" />
        <FilePreview v-if="state.filePreview" />
      </section>

      <div v-show="!previewCollapsed" class="splitter-wrap">
        <div class="splitter" title="拖动调整宽度" @pointerdown="startDrag" />
        <div class="preview-collapse-zone" role="button" tabindex="0" title="折叠预览" aria-label="折叠预览" @click="previewCollapsed = true" @keydown.enter.prevent="previewCollapsed = true" @keydown.space.prevent="previewCollapsed = true" />
      </div>
      <PreviewPane v-show="!previewCollapsed" />
      <div v-if="previewCollapsed" class="preview-collapse-zone preview-expand-zone" role="button" tabindex="0" title="展开预览" aria-label="展开预览" @click="previewCollapsed = false" @keydown.enter.prevent="previewCollapsed = false" @keydown.space.prevent="previewCollapsed = false" />

    </main>

    <TemplatesDialog v-if="showTemplates" @close="showTemplates = false" />
    <FilesDialog v-if="showFiles" @close="showFiles = false" />

    <div v-if="confirmation" class="confirm-backdrop" @click.self="finishConfirmation(false)" @keydown.esc="finishConfirmation(false)">
      <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" :aria-describedby="confirmation.detail ? 'confirm-detail' : undefined">
        <strong id="confirm-title">{{ confirmation.title }}</strong>
        <p v-if="confirmation.detail" id="confirm-detail">{{ confirmation.detail }}</p>
        <div class="confirm-actions">
          <button class="btn btn-sm" autofocus @click="finishConfirmation(false)">取消</button>
          <button class="btn btn-sm primary" @click="finishConfirmation(true)">确定</button>
        </div>
      </div>
    </div>

    <div class="toasts">
      <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.kind" @click="dismissToast(t.id)">
        {{ t.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 50px;
  padding: 0 12px 0 14px;
  background: var(--topbar-bg);
  border-bottom: 1px solid var(--border);
  z-index: 20;
  overflow-x: auto;
  scrollbar-width: none;
}
.topbar::-webkit-scrollbar {
  display: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.brand-name {
  font-weight: 650;
  font-size: 14px;
  letter-spacing: 0.2px;
}
.brand-sub {
  font-size: 11.5px;
  color: var(--text-faint);
  padding-left: 8px;
  border-left: 1px solid var(--border);
}
.doc-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}
.doc-name {
  min-width: 130px;
  max-width: 240px;
  flex: 0 1 auto;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.doc-name:hover {
  border-color: var(--border);
}
.doc-name:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--input-bg);
}
.save-status {
  font-size: 11.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.save-status.dirty {
  color: #9a6700;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 2px;
}

.shell {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.side-nav {
  flex: 0 0 68px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  background: var(--bar-bg);
  border-right: 1px solid var(--border);
}
.nav-item {
  position: relative;
  width: 56px;
  min-height: 58px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.nav-item:hover, .nav-item:focus-visible { background: var(--hover); color: var(--accent); }
.nav-item.selected { background: var(--accent-soft); color: var(--accent-strong); }
.nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.nav-item svg { width: 20px; height: 20px; }
.nav-spark { font-size: 21px; line-height: 20px; }
.nav-dot { position: absolute; top: 8px; right: 12px; width: 7px; height: 7px; border-radius: 50%; background: #d97706; }
.workspace-panel { flex: 0 0 340px; width: 340px; min-width: 0; border-right: 1px solid var(--border); background: var(--panel-bg); }
.logs-panel { height: 100%; display: flex; flex-direction: column; }
.logs-head { height: 42px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
.logs-content { padding: 14px; overflow: auto; }
.log-section + .log-section { margin-top: 22px; }
.log-section h3 { margin: 0; font-size: 13px; }
.log-section p { color: var(--text-dim); }
.log-heading { display: flex; align-items: center; justify-content: space-between; }
.log-list { margin: 10px 0 0; padding: 0; list-style: none; }
.log-list li { padding: 8px 0; border-bottom: 1px solid var(--border-soft); line-height: 1.6; overflow-wrap: anywhere; }
.log-meta { color: var(--text-faint); font-size: 12px; }
.log-section .log-error { color: #d1242f; }
.editor-pane {
  position: relative;
  flex: 0 1 var(--editor-w, 620px);
  min-width: 240px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.shell.preview-collapsed .editor-pane { flex: 1 1 0; }
.splitter-wrap { position: relative; flex: none; width: 5px; z-index: 2; }
.preview-collapse-zone { position: absolute; z-index: 3; top: 0; bottom: 0; left: 100%; width: 56px; background: transparent; cursor: pointer; transition: background .15s; }
.preview-collapse-zone:hover, .preview-collapse-zone:focus-visible { background: var(--accent-soft); }
.preview-collapse-zone:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.preview-expand-zone { left: auto; right: 0; }
@media (max-width: 1100px) {
  .workspace-panel { position: absolute; left: 68px; top: 0; bottom: 0; z-index: 30; width: min(340px, calc(100vw - 68px)); box-shadow: 8px 0 28px rgba(15, 23, 42, 0.18); }
  .editor-pane {
    flex: 0 1 300px;
    min-width: 240px;
  }
  /* 窄屏下编辑器宽度由固定比例决定，拖动没有意义，直接隐藏避免误操作 */
  .splitter-wrap { width: 0; }
  .splitter { display: none; }
}
.editor-bar {
  flex: none;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px 0 14px;
  background: var(--bar-bg);
  border-bottom: 1px solid var(--border);
}
.editor-filename {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: 12px;
}
.splitter {
  height: 100%;
  width: 5px;
  cursor: col-resize;
  background: var(--border);
  transition: background 0.15s;
}
.splitter:hover {
  background: var(--accent);
}

.btn.accent-on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 90;
  max-width: 380px;
}
.confirm-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, 0.4); }
.confirm-card { width: 360px; max-width: 100%; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-bg); box-shadow: 0 12px 36px rgba(15, 23, 42, 0.2); }
.confirm-card strong { display: block; font-size: 14px; overflow-wrap: anywhere; }
.confirm-card p { margin: 8px 0 0; color: var(--text-dim); line-height: 1.6; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.toast {
  padding: 9px 13px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18);
  font-size: 12.5px;
  line-height: 1.6;
  cursor: pointer;
  animation: slide-in 0.16s ease-out;
}
.toast.ok {
  border-color: rgba(46, 160, 67, 0.5);
  color: #1a7f37;
}
.toast.error {
  border-color: rgba(229, 72, 77, 0.5);
  color: #d1242f;
}
@keyframes slide-in {
  from {
    transform: translateY(6px);
    opacity: 0;
  }
}

@media (max-width: 1100px) {
  .brand-sub {
    display: none;
  }
  /* 窄屏时保存状态文字优先让位，别把它挤成断行 */
  .save-status {
    display: none;
  }
}
</style>
