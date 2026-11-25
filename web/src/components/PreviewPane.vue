<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { persistPrefs, state } from '../composables/useWorkspace';

const scroller = ref<HTMLElement | null>(null);
const containerWidth = ref(900);
const A4_PX = 794;

const pageWidth = computed(() => {
  if (state.zoomMode === 'fit') return Math.round(Math.max(300, Math.min(containerWidth.value - 60, 1400)));
  return Math.round(A4_PX * state.zoom);
});

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!scroller.value) return;
  observer = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 0;
    if (w) containerWidth.value = w;
  });
  observer.observe(scroller.value);
});

onBeforeUnmount(() => observer?.disconnect());


function zoomBy(delta: number): void {
  state.zoomMode = 'manual';
  state.zoom = Math.min(2.5, Math.max(0.4, +(state.zoom + delta).toFixed(2)));
  persistPrefs();
}

function setFit(): void {
  state.zoomMode = 'fit';
  persistPrefs();
}

function setActual(): void {
  state.zoomMode = 'manual';
  state.zoom = 1;
  persistPrefs();
}

function onWheel(ev: WheelEvent): void {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  zoomBy(ev.deltaY > 0 ? -0.08 : 0.08);
}

</script>

<template>
  <section class="preview">
    <header class="preview-bar">
      <div class="preview-bar-right">
        <button class="btn btn-xs ghost" title="缩小 (Ctrl+滚轮)" @click="zoomBy(-0.1)">−</button>
        <button class="btn btn-xs ghost" title="适应宽度" @click="setFit">适应宽度</button>
        <button class="btn btn-xs ghost" title="实际大小" @click="setActual">100%</button>
        <button class="btn btn-xs ghost" title="放大" @click="zoomBy(0.1)">＋</button>
      </div>
    </header>

    <div ref="scroller" class="paper-scroller" @wheel="onWheel">
      <div v-if="!state.hasRender" class="paper-empty">
        <template v-if="!state.previewEntry">
          <p>预览已隐藏，点击文件旁的眼睛可显示预览</p>
        </template>
        <template v-else-if="state.engine === 'error'">
          <div class="empty-mark">!</div>
          <p>{{ state.engineDetail || 'Typst 编译器初始化失败' }}</p>
          <p class="dim-tip">
            编译器从 jsDelivr 加载，被网络策略拦截时会失败。检查网络后刷新页面重试
          </p>
        </template>
        <template v-else-if="state.engine === 'loading' || !state.firstResult">
          <div class="spinner" />
          <p>{{ state.engineDetail || '正在编译第一版…' }}</p>
          <div v-if="state.engineProgress !== null" class="progress">
            <i :style="{ width: Math.round(state.engineProgress * 100) + '%' }" />
          </div>
          <p v-if="state.engine === 'loading'" class="dim-tip">
            首次打开需下载编译器与中文字体（约 27MB），之后浏览器缓存秒开
          </p>
        </template>
        <template v-else>
          <div class="empty-mark">!</div>
          <p>这一版没能编译成功，请在左侧日志中查看具体错误</p>
          <p class="dim-tip">修好之后预览会自动恢复；编译出错时不会清空上一版的画面</p>
        </template>
      </div>

      <div v-else class="papers">
        <article
          v-for="page in state.pages"
          :key="page.index"
          class="paper"
          :style="{ width: pageWidth + 'px', '--paper-ratio': page.width / page.height }"
        >
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="paper-inner" v-html="page.html" />
          <span class="paper-no">{{ page.index + 1 }}</span>
        </article>
      </div>
    </div>

  </section>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  background: var(--preview-bg);
  border-left: 1px solid var(--border);
}

.preview-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  height: 40px;
  padding: 0 10px 0 14px;
  background: var(--bar-bg);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
}
.preview-bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.paper-scroller {
  flex: 1;
  overflow: auto;
  padding: 24px 0 60px;
  scrollbar-gutter: stable;
}
.papers {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}
.paper {
  position: relative;
  background: #fff;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12), 0 8px 24px rgba(15, 23, 42, 0.1);
  overflow: hidden;
}
.paper-inner :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
.paper-no {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 10px;
  color: #9aa3af;
}
.paper-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 80px;
  color: var(--text-dim);
  font-size: 13px;
}
.dim-tip {
  font-size: 11.5px;
  color: var(--text-faint);
  margin: 0;
}
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.empty-mark {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(229, 72, 77, 0.12);
  color: #d1242f;
  font-weight: 700;
}
.progress {
  width: 220px;
  max-width: 70%;
  height: 4px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}
.progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.25s ease-out;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

</style>
