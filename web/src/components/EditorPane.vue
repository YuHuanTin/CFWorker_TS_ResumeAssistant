<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { darkTheme, diagnosticLines, lightTheme, setDiagnosticLines, typstSupport } from '../lib/editor';
import { aiChanges, clearAiChanges, makeAiChanges, showAiChanges } from '../lib/aiChanges';
import { notify, requestRender, saveResume, setSelection, state } from '../composables/useWorkspace';

const host = ref<HTMLDivElement | null>(null);
const wrapper = ref<HTMLDivElement | null>(null);
const emit = defineEmits<{ (e: 'open-ai'): void }>();
const selectionPrompt = ref('');
const remainingChanges = ref(0);
const selectionBox = ref<{ top: number; left: number; from: number; to: number; text: string; path: string; docId: string } | null>(null);
const themeCompartment = new Compartment();
let view: EditorView | null = null;

function currentDoc(): string {
  return view?.state.doc.toString() ?? '';
}

function lineCount(text: string): number {
  return text ? text.split('\n').length : 0;
}

function updateSelectionBox(): void {
  if (!view || !wrapper.value) return;
  if (state.aiReview) { selectionBox.value = null; return; }
  const selection = view.state.selection.main;
  if (selection.empty) { selectionBox.value = null; return; }
  const coords = view.coordsAtPos(selection.to);
  if (!coords) return;
  const rect = wrapper.value.getBoundingClientRect();
  selectionBox.value = {
    top: Math.max(4, Math.min(coords.bottom - rect.top + 6, rect.height - 150)),
    left: Math.max(4, Math.min(coords.left - rect.left, rect.width - 290)),
    from: selection.from, to: selection.to,
    text: view.state.sliceDoc(selection.from, selection.to),
    path: state.activeFile, docId: state.docId,
  };
}

function addSelectionToDraft(): void {
  const selected = selectionBox.value;
  const instruction = selectionPrompt.value.trim();
  if (!selected || !instruction) return;
  if (state.aiDraftTarget && (state.aiDraftTarget.docId !== selected.docId || state.aiDraftTarget.path !== selected.path) && state.aiDraft.trim()) {
    notify('当前待发送内容属于另一个文件，请先发送或清空', 'info');
    return;
  }
  if (!view || state.docId !== selected.docId || state.activeFile !== selected.path || view.state.sliceDoc(selected.from, selected.to) !== selected.text) {
    notify('选中内容已变化，请重新选择', 'error');
    selectionBox.value = null;
    return;
  }
  const line = view.state.doc.lineAt(selected.from).number;
  const excerpt = selected.text.split('\n').map((part) => `> ${part}`).join('\n');
  const addition = `文件：${selected.path} · 第 ${line} 行\n选中内容：\n${excerpt}\n修改要求：${instruction}`;
  state.aiDraft = [state.aiDraft.trimEnd(), addition].filter(Boolean).join('\n\n');
  state.aiDraftTarget = { docId: selected.docId, path: selected.path };
  selectionPrompt.value = '';
  selectionBox.value = null;
  emit('open-ai');
  notify('已添加到 AI 输入框，确认后发送', 'ok');
}

function onSelectionPromptKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  addSelectionToDraft();
}

function onFileDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('application/x-resume-workspace-path')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function onFileDrop(event: DragEvent): void {
  const path = event.dataTransfer?.getData('application/x-resume-workspace-path');
  if (!path || !(path in state.files) || !view) return;
  event.preventDefault();
  event.stopPropagation();
  const from = state.activeFile.split('/').slice(0, -1);
  const to = path.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  const relative = [...from.map(() => '..'), ...to].join('/');
  const quoted = JSON.stringify(relative);
  const text = /\.(png|jpe?g|gif|webp|svg)$/i.test(path) ? `#image(${quoted})`
    : /\.typ$/i.test(path) ? `#include ${quoted}` : quoted;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
  view.dispatch({ changes: { from: position, insert: text }, selection: { anchor: position + text.length }, scrollIntoView: true });
  view.focus();
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: state.source,
      extensions: [
        basicSetup,
        typstSupport(),
        diagnosticLines,
        aiChanges((remaining) => {
          remainingChanges.value = remaining;
          if (!remaining) { state.aiReview = null; notify('已处理全部修改', 'ok'); }
        }),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        themeCompartment.of(state.theme === 'dark' ? darkTheme : lightTheme),
        keymap.of([
          indentWithTab,
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              saveResume();
              return true;
            },
          },
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              requestRender(currentDoc());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            if (text !== state.source) requestRender(text);
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            const text = update.state.sliceDoc(sel.from, sel.to);
            setSelection({ from: sel.from, to: sel.to, text, lines: lineCount(text) });
            if (update.selectionSet) requestAnimationFrame(updateSelectionBox);
          }
        }),
      ],
    }),
  });
  if (state.source) requestRender(state.source);
});

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

watch(() => [state.docId, state.activeFile] as const, () => {
  selectionBox.value = null;
  selectionPrompt.value = '';
  if (state.aiReview && (state.aiReview.docId !== state.docId || state.aiReview.path !== state.activeFile)) {
    state.aiReview = null;
    notify('已放弃尚未处理的 AI 修改', 'info');
  }
});

watch(() => state.aiReview, (review) => {
  if (!view) return;
  selectionBox.value = null;
  if (!review) { remainingChanges.value = 0; view.dispatch({ effects: clearAiChanges.of() }); return; }
  if (review.docId !== state.docId || review.path !== state.activeFile || view.state.doc.toString() !== review.source) {
    state.aiReview = null;
    notify('目标文件已变化，请重新发送请求', 'error');
    return;
  }
  const chunks = makeAiChanges(review.source, review.proposed);
  if (!chunks.length) { state.aiReview = null; notify('AI 返回的内容没有变化', 'info'); return; }
  remainingChanges.value = chunks.length;
  view.dispatch({ effects: showAiChanges.of(chunks) });
});

/** 外部改稿（换模板 / 载入文件 / AI 应用）：走编辑器事务，可撤销 */
watch(
  () => state.applyRequest.nonce,
  () => {
    if (!view) return;
    const { code, label } = state.applyRequest;
    if (code === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
      scrollIntoView: true,
    });
    if (label) notify(`${label}：已写入编辑器（Ctrl+Z 可撤销）`, 'ok', 2600);
  }
);

watch(
  () => state.theme,
  (theme) => {
    view?.dispatch({ effects: themeCompartment.reconfigure(theme === 'dark' ? darkTheme : lightTheme) });
  }
);

/** 服务端语义诊断 -> 行底色标记 */
watch(
  () => [state.diagnostics, state.activeFile] as const,
  ([list, activeFile]) => {
    if (!view) return;
    const lines = list.filter((d) => d.line !== null && (d.path ?? 'main.typ') === activeFile).map((d) => d.line as number);
    view.dispatch({ effects: setDiagnosticLines.of(lines) });
  }
);

/** 诊断面板点击 -> 跳到对应行 */
watch(
  () => state.jumpTarget.nonce,
  () => {
    if (!view || !state.jumpTarget.line) return;
    const total = view.state.doc.lines;
    const lineNo = Math.min(Math.max(1, state.jumpTarget.line), total);
    const line = view.state.doc.line(lineNo);
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }
);
</script>

<template>
  <div ref="wrapper" class="editor-wrapper">
    <div v-if="state.aiReview" class="review-banner"><span>AI 建议 · 待处理 {{ remainingChanges }} 处</span><button class="btn btn-xs ghost" type="button" @click="state.aiReview = null">放弃剩余修改</button></div>
    <div ref="host" class="editor-host" :style="{ '--editor-font-size': state.editorFontSize + 'px' }" @dragover.capture="onFileDragOver" @drop.capture="onFileDrop" spellcheck="false" />
    <form v-if="selectionBox" class="selection-popover" :style="{ top: selectionBox.top + 'px', left: selectionBox.left + 'px' }" @submit.prevent="addSelectionToDraft" @keydown.esc.stop="selectionBox = null" @mousedown.stop>
      <div class="selection-head"><strong>选中内容交给 AI</strong><button type="button" class="btn btn-xs ghost" aria-label="关闭" @click="selectionBox = null">×</button></div>
      <textarea v-model="selectionPrompt" rows="2" placeholder="输入修改要求，Enter 添加，Shift+Enter 换行" aria-label="选中内容的修改要求" @keydown="onSelectionPromptKeydown" />
    </form>
  </div>
</template>

<style scoped>
.editor-wrapper { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.review-banner { flex: none; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 12px; background: var(--accent-soft); color: var(--accent-strong); font-size: 12px; }
.editor-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--editor-bg);
  contain: strict;
}
.selection-popover { position: absolute; z-index: 10; width: min(280px, calc(100% - 8px)); padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel-bg); box-shadow: 0 8px 24px rgba(15, 23, 42, .14); }
.selection-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px; }
.selection-popover textarea { display: block; min-height: 48px; }
.editor-host :deep(.cm-editor) {
  height: 100%;
}
.editor-host :deep(.cm-editor.cm-focused) {
  outline: none;
}
.editor-host :deep(.cm-ai-removed) { background: rgba(229, 72, 77, .15); }
.editor-host :deep(.cm-ai-change) { padding: 5px 0; font: 12px/1.6 var(--mono); }
.editor-host :deep(.cm-ai-change-bar) { display: flex; align-items: center; gap: 6px; padding: 3px 12px; color: var(--text-dim); background: var(--bar-bg); }
.editor-host :deep(.cm-ai-change-bar span) { margin-right: auto; }
.editor-host :deep(.cm-ai-change-bar button) { padding: 2px 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--panel-bg); color: var(--text); font: inherit; cursor: pointer; }
.editor-host :deep(.cm-ai-change-bar button:disabled) { opacity: .5; cursor: not-allowed; }
.editor-host :deep(.cm-ai-added) { margin: 0; padding: 4px 12px; background: rgba(46, 160, 67, .16); color: var(--text); font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
