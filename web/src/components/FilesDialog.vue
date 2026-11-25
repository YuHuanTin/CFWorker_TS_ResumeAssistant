<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ModalShell from './ModalShell.vue';
import { downloadText } from '../lib/api';
import { loadResume, notify, refreshResumes, removeResume, renameResume, saveAs, state } from '../composables/useWorkspace';
import { confirmAction } from '../composables/useConfirmation';

const emit = defineEmits<{ (e: 'close'): void }>();
const renaming = ref<string | null>(null);
const renameValue = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(() => refreshResumes());

function fmt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function open(id: string): Promise<void> {
  if (id === state.docId) return emit('close');
  if (state.source !== state.savedSource) {
    const ok = await confirmAction('切换简历？', '当前简历有未保存的改动（会自动保存）');
    if (!ok) return;
  }
  loadResume(id);
  emit('close');
}

async function createNew(): Promise<void> {
  const tpl = state.templates.find((t) => t.id === 'classic');
  const source = tpl?.source ?? '= 你的名字\n';
  const id = saveAs('新简历', source);
  loadResume(id);
  notify('已新建一份简历（经典单栏模板）', 'ok');
  emit('close');
}

async function duplicate(): Promise<void> {
  const main = state.files['main.typ'];
  const id = saveAs(`${state.name} 副本`, typeof main === 'string' ? main : '', state.files, state.previewEntry);
  loadResume(id);
  notify('已另存为副本', 'ok');
  emit('close');
}

async function doRename(id: string): Promise<void> {
  const name = renameValue.value.trim();
  if (!name) return;
  renameResume(id, name);
  renaming.value = null;
  notify('已重命名', 'ok');
}

async function doDelete(id: string, name: string): Promise<void> {
  if (!await confirmAction(`删除「${name}」？`, '此操作不可撤销')) return;
  const wasCurrent = id === state.docId;
  removeResume(id);
  if (wasCurrent) {
    const next = state.resumeList[0];
    if (next) loadResume(next.id);
    else {
      const source = state.templates.find((t) => t.id === 'classic')?.source ?? '';
      loadResume(saveAs('新简历', source));
    }
  }
  notify('已删除', 'ok');
}

function exportTyp(): void {
  downloadText(state.source, `${state.name || 'resume'}.typ`, 'text/plain;charset=utf-8');
}

function onImport(ev: Event): void {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const text = String(reader.result ?? '');
    const name = file.name.replace(/\.(typ|txt)$/i, '') || '导入的简历';
    const id = saveAs(name, text);
    loadResume(id);
    notify(`已导入 ${file.name}`, 'ok');
    emit('close');
  };
  reader.readAsText(file, 'utf-8');
}
</script>

<template>
  <ModalShell title="我的简历" subtitle="简历保存在本浏览器，换设备或清除浏览器数据前请下载文件备份" width="720px" @close="emit('close')">
    <ul class="file-list">
      <li v-for="r in state.resumeList" :key="r.id" :class="{ current: r.id === state.docId }">
        <div class="file-main">
          <input
            v-if="renaming === r.id"
            v-model="renameValue"
            class="rename-input"
            @keydown.enter="doRename(r.id)"
            @keydown.esc="renaming = null"
          />
          <template v-else>
            <strong>{{ r.name }}</strong>
            <span v-if="r.id === state.docId" class="tag">当前</span>
          </template>
        </div>
        <span class="meta">{{ r.chars }} 字 · {{ fmt(r.updatedAt) }}</span>
        <div class="file-actions">
          <template v-if="renaming === r.id">
            <button class="btn btn-xs primary" @click="doRename(r.id)">确定</button>
            <button class="btn btn-xs ghost" @click="renaming = null">取消</button>
          </template>
          <template v-else>
            <button class="btn btn-xs" @click="open(r.id)">打开</button>
            <button
              class="btn btn-xs ghost"
              @click="((renaming = r.id), (renameValue = r.name))"
            >
              重命名
            </button>
            <button class="btn btn-xs ghost danger" @click="doDelete(r.id, r.name)">删除</button>
          </template>
        </div>
      </li>
      <li v-if="state.resumeList.length === 0" class="empty">还没有简历，点下面的「新建简历」开始</li>
    </ul>

    <template #footer>
      <input ref="fileInput" type="file" accept=".typ,.txt" class="hidden-input" @change="onImport" />
      <span class="foot-left">
        <button class="btn btn-xs" @click="fileInput?.click()">导入 .typ</button>
        <button class="btn btn-xs" @click="exportTyp">导出当前 .typ</button>
        <button class="btn btn-xs" @click="duplicate">另存为副本</button>
      </span>
      <button class="btn btn-sm primary" @click="createNew">新建简历</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.file-list li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.file-list li.current {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.file-list li.empty {
  display: block;
  color: var(--text-dim);
  font-size: 12.5px;
  border-style: dashed;
}
.file-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.file-main strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}
.meta {
  font-size: 11.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.file-actions {
  display: flex;
  gap: 4px;
}
.rename-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 13px;
}
.hidden-input {
  display: none;
}
.foot-left {
  margin-right: auto;
  display: flex;
  gap: 5px;
}
.btn.danger:hover {
  color: #d1242f;
  border-color: #d1242f;
}
</style>
