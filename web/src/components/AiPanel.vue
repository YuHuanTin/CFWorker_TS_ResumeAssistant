<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { renderMarkdown } from '../lib/markdown';
import { applyAiPatch, preserveFinalNewlines } from '../lib/aiPatch';
import { QUICK_ACTIONS, type QuickAction } from '../lib/prompts';
import { notify, saveResume, selectFile, state } from '../composables/useWorkspace';
import type { ChatMessage } from '../types';

const emit = defineEmits<{ (e: 'open-settings'): void; (e: 'close'): void }>();

const input = computed({ get: () => state.aiDraft, set: (value: string) => { state.aiDraft = value; if (!value.trim()) state.aiDraftTarget = null; } });
const inputEl = ref<HTMLTextAreaElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const quickOpen = ref(true);
let panelObserver: ResizeObserver | null = null;
let controller: AbortController | null = null;
let jdMode = false;

const rendered = computed(() =>
  state.messages.map((m) => (m.role === 'assistant' ? renderMarkdown(m.content) : { html: '', blocks: [] }))
);

const endpointLabel = computed(() => {
  if (state.ai.apiKey) return state.ai.model || '未选择模型';
  if (state.serverAi.serverDefault) return `${state.serverAi.model || '站点默认'}（站点）`;
  return '未配置';
});

const contextInfo = computed(() => {
  const target = state.aiDraftTarget;
  const source = target?.docId === state.docId ? state.files[target.path] : state.source;
  const docChars = typeof source === 'string' ? source.length : 0;
  if (target) return `附带文件：${target.path} · ${docChars} 字`;
  const sel = state.selection.text.trim();
  return sel ? `附带上文：简历 ${docChars} 字 + 选中 ${state.selection.lines} 行` : `附带上文：简历 ${docChars} 字`;
});

function scrollToBottom(force = false): void {
  const el = listEl.value;
  if (!el) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  if (force || near) el.scrollTop = el.scrollHeight;
}

watch(
  () => state.messages.length,
  () => void nextTick(() => scrollToBottom(true))
);

watch(input, () => void nextTick(autoGrow));
watch(() => state.docId, (id, previous) => {
  if (id === previous || !controller) return;
  controller.abort();
  controller = null;
  state.generating = false;
  jdMode = false;
}, { flush: 'sync' });
onMounted(() => {
  if (!panelEl.value) return;
  panelObserver = new ResizeObserver(() => autoGrow());
  panelObserver.observe(panelEl.value);
  autoGrow();
});
onBeforeUnmount(() => panelObserver?.disconnect());

watch(
  () => state.messages[state.messages.length - 1]?.content.length ?? 0,
  () => void nextTick(() => scrollToBottom())
);

async function send(text?: string): Promise<void> {
  const content = (text ?? input.value).trim();
  if (!content) return;
  if (state.generating) {
    notify('正在生成中，先点「停止」再发送新内容', 'info');
    return;
  }
  if (!state.ai.apiKey && !state.serverAi.serverDefault) {
    notify('先去「设置」里配置 AI 接口地址与 Key', 'error');
    emit('open-settings');
    return;
  }
  const draftTarget = state.aiDraftTarget;
  const target = draftTarget ?? { docId: state.docId, path: state.activeFile };
  const targetSource = state.files[target.path];
  if (target.docId !== state.docId || typeof targetSource !== 'string') {
    notify('待发送内容对应的文件不可用，请切回该简历或清空输入框', 'error');
    return;
  }
  const history: ChatMessage[] = [
    ...state.messages.filter((m) => !m.error && m.content.trim()).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content },
  ];
  state.messages.push({ role: 'user', content });
  input.value = '';
  autoGrow();

  // 必须是响应式对象：push 进 reactive 数组后，直接改这个对象也要能触发流式渲染
  const assistant = reactive<ChatMessage>({ role: 'assistant', content: '', streaming: true, model: state.ai.model || state.serverAi.model, editTarget: { ...target, source: targetSource } });
  state.messages.push(assistant);
  state.generating = true;
  saveResume(true);
  let completed = false;
  let stopReason: string | null = null;
  // 每次请求独享自己的 controller 和消息对象：
  // 点「停止」后立刻再发一条时，上一条请求的 finally 不能去清掉这一条的 generating/controller
  const myController = new AbortController();
  controller = myController;

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-token': state.ai.accessToken },
      body: JSON.stringify({
        messages: history,
        document: targetSource,
        selection: !draftTarget && target.path === state.activeFile && state.selection.text.trim() ? { text: state.selection.text } : null,
        mode: jdMode ? 'jd' : 'chat',
        ai: aiPayload(),
      }),
      signal: myController.signal,
    });
    if (!res.ok || !res.body) {
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: string }).error ?? '';
      } catch {}
      throw new Error(detail || `服务端返回 ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt: { type?: string; text?: string; message?: string; model?: string; style?: string; stopReason?: string | null };
          try {
            evt = JSON.parse(payload) as typeof evt;
          } catch {
            continue;
          }
          if (evt.type === 'delta' && evt.text) assistant.content += evt.text;
          else if (evt.type === 'thinking' && evt.text) assistant.thinking = (assistant.thinking ?? '') + evt.text;
          else if (evt.type === 'start' && evt.model) assistant.model = evt.model;
          else if (evt.type === 'done') stopReason = evt.stopReason ?? null;
          else if (evt.type === 'error') {
            assistant.error = true;
            assistant.content += `${assistant.content ? '\n\n' : ''}⚠️ ${evt.message ?? '请求失败'}`;
          }
        }
      }
    }
    if (!assistant.error) {
      if (stopReason === 'length' || stopReason === 'max_tokens') {
        assistant.completionNotice = assistant.content
          ? '输出达到 token 上限，回复可能不完整；可在设置中提高最大输出 tokens 后重试'
          : '输出达到 token 上限，尚未生成正文；思考内容可能占用了输出额度，可在设置中提高最大输出 tokens 后重试';
      } else if (!assistant.content && assistant.thinking) {
        assistant.completionNotice = '模型返回了思考内容，但没有返回正文；上游未明确报告输出上限，可检查模型配置或重试';
      } else if (!assistant.content) {
        assistant.completionNotice = '模型没有返回正文；请检查模型配置、接口响应或重试';
      }
    }
    completed = true;
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    if (!aborted) {
      assistant.error = true;
      assistant.content += `${assistant.content ? '\n\n' : ''}⚠️ ${(err as Error).message}`;
    } else if (!assistant.content) {
      assistant.content = '（已停止生成）';
    }
  } finally {
    assistant.streaming = false;
    // 只有当前这条请求才有权关掉全局的「生成中」状态，
    // 否则「停止后立刻重发」会被上一条的收尾误伤（按钮变回「发送」、无法中止）
    if (controller === myController) {
      state.generating = false;
      controller = null;
      jdMode = false;
    }
    if (completed && !assistant.error && !assistant.completionNotice && !state.aiReview && !state.filePreview && state.docId === target.docId && state.activeFile === target.path && state.files[target.path] === targetSource) {
      const blocks = renderMarkdown(assistant.content).blocks;
      if (blocks.length === 1 && !blocks[0]!.open) {
        try {
          const block = blocks[0]!;
          const proposed = preserveFinalNewlines(targetSource, block.kind === 'patch' ? applyAiPatch(targetSource, block.code) : block.code);
          state.aiReview = { ...target, source: targetSource, proposed };
        } catch (err) {
          assistant.completionNotice = (err as Error).message;
        }
      }
    }
    if (state.docId === target.docId && state.messages.includes(assistant)) saveResume(true);
    void nextTick(() => scrollToBottom(true));
  }
}

function aiPayload(): Record<string, unknown> {
  const { accessToken: _t, ...rest } = state.ai;
  return rest;
}

function stop(): void {
  controller?.abort();
  // 立刻放开按钮，让用户可以马上重发；真正的收尾在 send() 的 finally 里按 controller 归属判断
  state.generating = false;
}

function runQuick(action: QuickAction): void {
  if (action.needsSelection && !state.selection.text.trim()) {
    notify('先在编辑器里选中一段文字，再用这个动作', 'info');
    return;
  }
  if (action.id === 'jd') jdMode = true;
  input.value = [input.value.trimEnd(), action.prompt].filter(Boolean).join('\n\n');
  autoGrow();
  inputEl.value?.focus();
  notify('提示词已添加，确认后发送', 'info');
}

async function onMessageClick(ev: MouseEvent, msgIndex: number): Promise<void> {
  const target = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action;
  const blockIndex = Number(target.dataset.block ?? 0);
  const block = rendered.value[msgIndex]?.blocks[blockIndex];
  if (!block || block.open) return;

  if (action === 'copy') {
    void navigator.clipboard.writeText(block.code).then(
      () => notify('源码已复制到剪贴板', 'ok', 1800),
      () => notify('复制失败，请手动选择', 'error')
    );
    return;
  }
  if (action === 'apply') {
    const target = state.messages[msgIndex]?.editTarget;
    if (!target) { notify('无法确定这条回复对应的文件，请重新发送请求', 'error'); return; }
    if (state.aiReview) { notify('请先处理当前未完成的修改', 'info'); return; }
    if (state.docId !== target.docId || state.files[target.path] !== target.source) {
      notify('目标文件已变化，请重新发送请求，避免覆盖现有内容', 'error'); return;
    }
    let proposed: string;
    try {
      proposed = preserveFinalNewlines(target.source, block.kind === 'patch' ? applyAiPatch(target.source, block.code) : block.code);
    } catch (err) {
      notify((err as Error).message, 'error', 6000);
      return;
    }
    selectFile(target.path);
    await nextTick();
    if (state.docId !== target.docId || state.files[target.path] !== target.source || state.activeFile !== target.path) {
      notify('目标文件已变化，请重新发送请求', 'error'); return;
    }
    state.aiReview = { ...target, proposed };
  }
}

function autoGrow(): void {
  const el = inputEl.value;
  const panelHeight = panelEl.value?.clientHeight ?? 0;
  if (!el || !panelHeight) return;
  el.style.height = 'auto';
  const maxHeight = Math.max(0, Math.floor(panelHeight * 0.4) - 23);
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
}

function focusInput(): void {
  const el = inputEl.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}
defineExpose({ focusInput });

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    void send();
  }
}

function clearChat(): void {
  if (state.generating) stop();
  state.messages = [];
  saveResume(true);
}
</script>

<template>
  <aside ref="panelEl" class="ai-panel">
    <header class="ai-head">
      <div class="ai-title">
        <span class="spark">✦</span>
        <span>AI 简历助手</span>
        <span class="model-chip" :title="state.ai.baseUrl || '未配置'">{{ endpointLabel }}</span>
      </div>
      <div class="ai-head-actions">
        <button class="btn btn-xs ghost" title="清空对话" @click="clearChat">清空</button>
        <button class="btn btn-xs ghost" title="收起面板" @click="emit('close')">收起</button>
      </div>
    </header>

    <div class="ai-context">
      <span>{{ contextInfo }}</span>
      <span v-if="!state.aiDraftTarget && state.selection.text.trim()" class="sel-tag">选中：{{ state.selection.text.trim().slice(0, 18) }}{{ state.selection.text.trim().length > 18 ? '…' : '' }}</span>
    </div>
    <div v-if="state.aiDraftTarget" class="draft-target">待发送文件：{{ state.aiDraftTarget.path }} <button class="btn btn-xs ghost" @click="input = ''">清空</button></div>

    <div ref="listEl" class="ai-messages">
      <div
        v-for="(msg, i) in state.messages"
        :key="i"
        class="ai-msg"
        :class="[msg.role, { error: msg.error }]"
      >
        <div class="ai-role">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
        <div class="ai-body">
          <details v-if="msg.thinking" class="ai-thinking">
            <summary>思考过程</summary>
            <pre>{{ msg.thinking }}</pre>
          </details>
          <p v-if="msg.completionNotice" class="completion-notice" role="status">{{ msg.completionNotice }}</p>
          <div v-if="msg.role === 'user'" class="ai-user-text">{{ msg.content }}</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="ai-md" v-html="rendered[i]?.html" @click="onMessageClick($event, i)" />
          <span v-if="msg.streaming" class="caret" />
          <div v-if="msg.role === 'assistant' && !msg.streaming && msg.content" class="ai-msg-foot">
            <span>{{ msg.model }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="ai-quick-section">
      <button class="btn btn-xs ghost quick-toggle" type="button" :aria-expanded="quickOpen" aria-controls="ai-quick-options" @click="quickOpen = !quickOpen">
        <span>{{ quickOpen ? '▾' : '▸' }}</span> 快捷选项
      </button>
      <div v-show="quickOpen" id="ai-quick-options" class="ai-quick">
        <button
          v-for="action in QUICK_ACTIONS"
          :key="action.id"
          class="quick-chip"
          :title="action.hint"
          @click="runQuick(action)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>

    <div class="ai-input">
      <textarea
        ref="inputEl"
        v-model="input"
        rows="1"
        placeholder="Enter 发送，Shift+Enter 换行"
        @input="autoGrow"
        @keydown="onKeydown"
      />
      <div v-if="state.generating" class="ai-input-actions">
        <button class="btn btn-sm warn" @click="stop">停止</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel-bg);
  width: 100%;
  min-width: 0;
}

.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
}
.spark {
  color: var(--accent);
}
.model-chip {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 500;
}
.ai-head-actions {
  display: flex;
  gap: 4px;
}

.ai-context {
  flex: none;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 14px;
  font-size: 11px;
  color: var(--text-faint);
  background: var(--bar-bg);
  border-bottom: 1px solid var(--border-soft);
}
.sel-tag {
  color: var(--accent-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-target { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 12px; color: var(--accent-strong); background: var(--accent-soft); font-size: 11px; overflow-wrap: anywhere; }

.ai-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ai-msg {
  display: flex;
  gap: 9px;
}
.ai-role {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  background: var(--chip-bg);
  color: var(--text-dim);
}
.ai-msg.assistant .ai-role {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.ai-body {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  line-height: 1.72;
  color: var(--text);
}
.ai-user-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-msg.error .ai-body {
  color: #d1242f;
}
.ai-thinking {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-dim);
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.ai-thinking pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-family: var(--mono);
  font-size: 11.5px;
  max-height: 220px;
  overflow: auto;
}
.completion-notice { margin: 0 0 8px; padding: 7px 9px; border-radius: 6px; background: rgba(208, 162, 21, .12); color: var(--text); font-size: 12px; }
.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 2px;
  background: var(--accent);
  vertical-align: -2px;
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink {
  to {
    visibility: hidden;
  }
}
.ai-msg-foot {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-faint);
}

.ai-quick-section { flex: none; border-top: 1px solid var(--border-soft); }
.quick-toggle { margin: 5px 12px 0; }
.ai-quick {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px 8px;
}
.quick-chip {
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--chip-bg);
  color: var(--text-dim);
  font-size: 11.5px;
  cursor: pointer;
  transition: all 0.12s;
}
.quick-chip:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.ai-input {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
}
.ai-input textarea {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
.ai-input-actions {
  flex: none;
}

/* Markdown 内容 */
.ai-md :deep(p) {
  margin: 0 0 8px;
}
.ai-md :deep(p:last-child) {
  margin-bottom: 0;
}
.ai-md :deep(ul),
.ai-md :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.ai-md :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--code-bg);
  padding: 1px 4px;
  border-radius: 4px;
}
.ai-md :deep(h1),
.ai-md :deep(h2),
.ai-md :deep(h3) {
  font-size: 13.5px;
  margin: 12px 0 6px;
}
.ai-md :deep(table) {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
  margin: 6px 0;
}
.ai-md :deep(th),
.ai-md :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 6px;
  text-align: left;
}
.ai-md :deep(a) {
  color: var(--accent-strong);
}
.ai-md :deep(blockquote) {
  margin: 6px 0;
  padding-left: 10px;
  border-left: 3px solid var(--border);
  color: var(--text-dim);
}
.ai-md :deep(.ai-code) {
  margin: 0;
  padding: 9px 11px;
  background: var(--code-bg);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.6;
  overflow: auto;
  max-height: 340px;
  white-space: pre;
}
.ai-md :deep(.ai-code.plain) {
  border-radius: 6px;
  margin: 6px 0;
}
.ai-md :deep(.ai-block) {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin: 10px 0;
}
.ai-md :deep(.ai-block-head) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  background: var(--bar-bg);
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-dim);
}
.ai-md :deep(.ai-block-lang) {
  font-weight: 600;
  color: var(--accent-strong);
}
.ai-md :deep(.ai-block-actions) {
  margin-left: auto;
  display: flex;
  gap: 5px;
}
</style>
