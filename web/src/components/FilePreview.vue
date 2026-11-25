<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { state } from '../composables/useWorkspace';

const url = ref('');
const path = computed(() => state.filePreview ?? '');
const extension = computed(() => path.value.split('.').pop()?.toLowerCase() ?? '');
const imageTypes: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };
const audioTypes: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };
const videoTypes: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm' };
const kind = computed(() => extension.value in imageTypes ? 'image' : extension.value === 'pdf' ? 'pdf' : extension.value in audioTypes ? 'audio' : extension.value in videoTypes ? 'video' : 'other');

watch(() => [path.value, state.files[path.value]] as const, ([name, content]) => {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = '';
  if (!name || content === undefined) return;
  const type = imageTypes[extension.value] ?? audioTypes[extension.value] ?? videoTypes[extension.value] ?? (extension.value === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const data = typeof content === 'string' ? content : Uint8Array.from(atob(content.base64), (c) => c.charCodeAt(0));
  url.value = URL.createObjectURL(new Blob([data], { type }));
}, { immediate: true });
onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value); });
</script>

<template>
  <div class="file-preview">
    <img v-if="kind === 'image' && url" :src="url" :alt="path" />
    <iframe v-else-if="kind === 'pdf' && url" :src="url" :title="path" />
    <audio v-else-if="kind === 'audio' && url" :src="url" controls />
    <video v-else-if="kind === 'video' && url" :src="url" controls />
    <p v-else>此文件类型暂不支持预览，可从文件列表下载</p>
  </div>
</template>

<style scoped>
.file-preview { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 20px; background: var(--editor-bg); color: var(--text-dim); }
.file-preview img, .file-preview video { max-width: 100%; max-height: 100%; object-fit: contain; }
.file-preview iframe { width: 100%; height: 100%; border: 0; }
</style>
