<script setup lang="ts">
import { computed, ref } from 'vue';
import ModalShell from './ModalShell.vue';
import { applySource, state } from '../composables/useWorkspace';
import { confirmAction } from '../composables/useConfirmation';

const emit = defineEmits<{ (e: 'close'): void }>();

const selected = ref<string>(state.templates[0]?.id ?? '');
const current = computed(() => state.templates.find((t) => t.id === selected.value));

async function use(): Promise<void> {
  const tpl = state.templates.find((t) => t.id === selected.value);
  if (!tpl) return;
  const hasContent = state.source.trim().length > 0;
  if (hasContent) {
    const ok = await confirmAction('用模板覆盖当前编辑器内容？', '可以用 Ctrl+Z 撤销');
    if (!ok) return;
  }
  applySource(tpl.source, `套用模板「${tpl.title}」`);
  emit('close');
}
</script>

<template>
  <ModalShell title="选择模板" subtitle="模板就是一份完整的 Typst 源码，套用后右侧立即实时渲染，可 Ctrl+Z 撤销" width="880px" @close="emit('close')">
    <div class="tpl-wrap">
      <ul class="tpl-list">
        <li
          v-for="tpl in state.templates"
          :key="tpl.id"
          :class="{ active: selected === tpl.id }"
          @click="selected = tpl.id"
        >
          <strong>{{ tpl.title }}</strong>
          <span>{{ tpl.desc }}</span>
        </li>
      </ul>
      <div class="tpl-preview">
        <pre v-if="current" class="src">{{ current.source }}</pre>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-sm" @click="emit('close')">取消</button>
      <button class="btn btn-sm primary" @click="use">套用这个模板</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.tpl-wrap {
  display: grid;
  grid-template-columns: 268px 1fr;
  gap: 16px;
}
.tpl-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tpl-list li {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tpl-list li:hover {
  border-color: var(--accent);
}
.tpl-list li.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.tpl-list strong {
  font-size: 13px;
}
.tpl-list span {
  font-size: 11.5px;
  color: var(--text-dim);
  line-height: 1.5;
}
.tpl-preview {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--preview-bg);
  padding: 10px;
  height: 460px;
  overflow: auto;
  display: flex;
  justify-content: center;
}
.loading {
  color: var(--text-dim);
  font-size: 12.5px;
  margin: auto;
}
.src {
  margin: 0;
  width: 100%;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--text-dim);
}
</style>
