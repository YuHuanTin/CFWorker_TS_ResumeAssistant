<script setup lang="ts">
import { ref } from 'vue';
import { createFile, deleteFile, notify, selectFile, setPreviewEntry, state } from '../composables/useWorkspace';
import { saveBlob } from '../lib/api';

const emit = defineEmits<{ (e: 'manage'): void; (e: 'templates'): void }>();
const newPath = ref('');
const adding = ref(false);
const input = ref<HTMLInputElement | null>(null);
const draggingFiles = ref(false);

function add(): void {
  if (createFile(newPath.value)) { newPath.value = ''; adding.value = false; }
}
async function importFiles(files: FileList): Promise<void> {
  for (const file of Array.from(files)) {
    let content: string | { base64: string };
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        if (bytes.includes(0)) throw new Error('binary');
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        content = { base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
      }
    }
    catch { notify(`读取文件失败：${file.name}`, 'error'); continue; }
    createFile(file.name, content);
  }
}
async function importFile(event: Event): Promise<void> {
  const el = event.target as HTMLInputElement;
  if (el.files?.length) await importFiles(el.files);
  el.value = '';
}
function onDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  draggingFiles.value = true;
}
function onDragLeave(event: DragEvent): void {
  if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) {
    draggingFiles.value = false;
  }
}
function onDrop(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  draggingFiles.value = false;
  if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files);
}
function remove(path: string): void {
  deleteFile(path);
}
function download(path: string): void {
  const content = state.files[path];
  const blob = typeof content === 'string'
    ? new Blob([content], { type: 'text/plain;charset=utf-8' })
    : new Blob([Uint8Array.from(atob(content?.base64 ?? ''), (c) => c.charCodeAt(0))]);
  saveBlob(blob, path.split('/').pop() || 'file');
}
function startFileDrag(event: DragEvent, path: string): void {
  event.dataTransfer?.setData('application/x-resume-workspace-path', path);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <section class="files-panel" :class="{ 'dragging-files': draggingFiles }" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <header class="panel-head"><strong>文件</strong><div><button class="btn btn-xs ghost" @click="emit('templates')">模板</button><button class="btn btn-xs ghost" @click="emit('manage')">管理简历</button></div></header>
    <div class="file-body">
      <div class="project-name">{{ state.name }}</div>
      <p class="hint">拖入文件以导入，拖动文件名到编辑器可插入引用。点击眼睛选择预览和导出的 Typst 文件</p>
      <div class="file-actions"><button class="btn btn-xs" @click="adding = !adding">＋ 新建文件</button><button class="btn btn-xs" @click="input?.click()">导入文件</button></div>
      <input ref="input" type="file" multiple hidden @change="importFile" />
      <form v-if="adding" class="add-file" @submit.prevent="add"><input v-model="newPath" autofocus placeholder="例如 sections/education.typ" aria-label="新文件路径" /><button class="btn btn-xs primary">创建</button></form>
      <ul class="files">
        <li v-for="path in Object.keys(state.files).sort()" :key="path" :class="{ selected: (state.filePreview ?? state.activeFile) === path }">
          <button class="file-name" :title="path" draggable="true" @dragstart="startFileDrag($event, path)" @click="selectFile(path)"><span>▤</span> {{ path }}</button>
          <button v-if="/\.typ$/i.test(path) && typeof state.files[path] === 'string'" class="btn btn-xs ghost eye" :title="state.previewEntry === path ? '隐藏预览' : '显示预览'" :aria-label="`${state.previewEntry === path ? '隐藏预览' : '显示预览'} ${path}`" :aria-pressed="state.previewEntry === path" @click="setPreviewEntry(path)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><template v-if="state.previewEntry === path"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></template><template v-else><path d="M3 9c2.3 3 5.3 4.5 9 4.5S18.7 12 21 9M5 12l-2 2M9 13.5l-1 3M15 13.5l1 3M19 12l2 2"/></template></svg></button>
          <button class="btn btn-xs ghost" title="下载文件" :aria-label="`下载 ${path}`" @click="download(path)">↓</button>
          <button v-if="path !== 'main.typ'" class="btn btn-xs ghost" title="删除文件" :aria-label="`删除 ${path}`" @click="remove(path)">×</button>
        </li>
      </ul>
      <p class="hint">在 main.typ 中使用 <code>#import "文件名.typ": *</code> 或 <code>#include "文件名.typ"</code></p>
    </div>
  </section>
</template>

<style scoped>
.files-panel { height: 100%; display: flex; flex-direction: column; min-width: 0; background: var(--panel-bg); }
.files-panel.dragging-files { outline: 2px dashed var(--accent); outline-offset: -4px; background: var(--accent-soft); }
.panel-head { height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid var(--border); }
.file-body { padding: 14px 10px; overflow: auto; }
.project-name { padding: 0 3px; font-weight: 650; overflow-wrap: anywhere; }
.hint { color: var(--text-faint); font-size: 11.5px; line-height: 1.6; padding: 0 3px; }
.hint code { color: var(--text-dim); overflow-wrap: anywhere; }
.file-actions, .add-file { display: flex; gap: 6px; margin: 12px 0; }
.add-file input { width: 0; flex: 1; border: 1px solid var(--border); border-radius: 6px; background: var(--input-bg); color: var(--text); padding: 5px; font: inherit; }
.files { list-style: none; padding: 0; margin: 0; }
.files li { display: flex; align-items: center; border-radius: 6px; }
.files li:hover { background: var(--hover); }
.files li.selected { background: var(--accent-soft); color: var(--accent-strong); }
.file-name { flex: 1; min-width: 0; padding: 8px 6px; border: 0; color: inherit; background: none; font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-name span { color: var(--accent); }
.eye svg { width: 16px; height: 16px; }
</style>
