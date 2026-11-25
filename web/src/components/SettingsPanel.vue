<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { PROVIDERS } from '../lib/providers';
import { DEFAULT_SYSTEM_PROMPT } from '../lib/systemPrompt';
import { addFontFiles, notify, saveAiSettings, state, type AiSettings } from '../composables/useWorkspace';

const emit = defineEmits<{ (e: 'close'): void }>();

const form = ref<AiSettings>({ ...state.ai });
const showKey = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; text: string } | null>(null);
const fontInput = ref<HTMLInputElement | null>(null);
const models = ref<string[]>([]);
const loadingModels = ref(false);
const modelsMessage = ref('');
let modelsRequest: AbortController | null = null;
let panelOpen = true;

const usingServer = computed(() => !form.value.apiKey.trim() && state.serverAi.serverDefault);

watch(() => [form.value.baseUrl, form.value.apiKey, form.value.apiStyle, form.value.accessToken], () => {
  modelsRequest?.abort();
  modelsRequest = null;
  loadingModels.value = false;
  models.value = [];
  modelsMessage.value = '';
});
onBeforeUnmount(() => { panelOpen = false; modelsRequest?.abort(); });

async function fetchModels(): Promise<void> {
  modelsRequest?.abort();
  const controller = new AbortController();
  modelsRequest = controller;
  loadingModels.value = true;
  modelsMessage.value = '';
  models.value = [];
  try {
    const { accessToken, ...ai } = form.value;
    const res = await fetch('/api/ai/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-token': accessToken },
      body: JSON.stringify({ ai }),
      signal: controller.signal,
    });
    const out = await res.json() as { ok?: boolean; models?: string[]; message?: string; error?: string };
    if (controller.signal.aborted) return;
    if (!res.ok || !out.ok) {
      modelsMessage.value = out.message || out.error || `获取失败（${res.status}）`;
      return;
    }
    models.value = out.models ?? [];
    modelsMessage.value = models.value.length ? `获取到 ${models.value.length} 个模型` : '没有获取到模型，可手动输入';
  } catch (err) {
    if (!controller.signal.aborted) modelsMessage.value = `获取模型失败：${(err as Error).message}`;
  } finally {
    if (modelsRequest === controller) {
      modelsRequest = null;
      loadingModels.value = false;
    }
  }
}

function applyPreset(id: string): void {
  const preset = PROVIDERS.find((p) => p.id === id);
  if (!preset) return;
  form.value.baseUrl = preset.baseUrl;
  form.value.model = preset.model;
  form.value.apiStyle = preset.apiStyle;
  testResult.value = null;
  if (preset.id === 'ollama' || preset.id === 'lmstudio') {
    notify('本地模型只能在 wrangler dev 本机调试时访问；部署到 Cloudflare 后 Worker 连不到你电脑上的 localhost', 'info', 7000);
  }
}

function normalizedSettings(settings: AiSettings): AiSettings {
  return { ...settings, baseUrl: settings.baseUrl.trim(), model: settings.model.trim(), apiKey: settings.apiKey.trim() };
}

function save(): void {
  if (!saveAiSettings(normalizedSettings(form.value))) {
    notify('AI 设置保存失败，请检查浏览器存储', 'error');
    return;
  }
  notify('AI 设置已保存在本浏览器', 'ok');
}

async function test(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  const tested = normalizedSettings(form.value);
  try {
    const { accessToken, ...ai } = tested;
    const res = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-token': accessToken },
      body: JSON.stringify({ ai }),
    });
    const out = (await res.json()) as { ok: boolean; message?: string; url?: string; model?: string; latencyMs?: number; reply?: string };
    if (!panelOpen) return;
    if (!res.ok || !out.ok) {
      testResult.value = { ok: false, text: out.message ?? `失败（${res.status}）` };
    } else if (JSON.stringify(normalizedSettings(form.value)) !== JSON.stringify(tested)) {
      testResult.value = { ok: false, text: '连接成功，但设置在测试期间发生变化，请重新测试或手动保存' };
    } else if (!saveAiSettings(tested)) {
      testResult.value = { ok: false, text: '连接成功，但设置保存失败，请检查浏览器存储' };
    } else {
      testResult.value = { ok: true, text: `连通成功，设置已自动保存 · ${out.latencyMs} ms · 模型 ${out.model}\n端点：${out.url}\n回复：${out.reply || '(空)'}` };
      notify('连接成功，AI 设置已自动保存', 'ok');
    }
  } catch (err) {
    testResult.value = { ok: false, text: (err as Error).message };
  } finally {
    testing.value = false;
  }
}

async function onFonts(ev: Event): Promise<void> {
  const files = (ev.target as HTMLInputElement).files;
  if (files?.length) await addFontFiles(files);
}
</script>

<template>
  <div class="settings-panel">
    <header class="settings-head">
      <strong>设置</strong>
      <button class="btn btn-xs ghost" type="button" @click="emit('close')">收起</button>
    </header>
    <div class="settings-content">
      <p class="intro">支持 OpenAI 兼容或 Anthropic 兼容接口。配置保存在本浏览器，请求经由本站 Worker 转发</p>
    <div class="presets">
      <button v-for="p in PROVIDERS" :key="p.id" class="preset" :title="p.note" @click="applyPreset(p.id)">
        {{ p.label }}
      </button>
    </div>

    <p v-if="state.serverAi.serverDefault" class="server-note">
      站点已配置默认 AI（{{ state.serverAi.model || '未指定模型' }}）。API Key 留空就会使用它{{ state.serverAi.needsToken ? '，但需要填写访问口令' : '' }}
    </p>

    <label class="field">
      <span class="label">接口地址 Base URL</span>
      <input v-model="form.baseUrl" :placeholder="usingServer ? '留空使用站点默认' : 'https://api.deepseek.com/v1'" spellcheck="false" />
      <span class="tip">以 /v1 结尾通常没问题；填 /chat/completions 完整地址也可以</span>
    </label>

    <label class="field">
      <span class="label">API Key</span>
      <span class="key-row">
        <input v-model="form.apiKey" :type="showKey ? 'text' : 'password'" placeholder="sk-..." spellcheck="false" autocomplete="off" />
        <button class="btn btn-xs ghost" @click.prevent="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
      </span>
      <span class="tip">保存在本浏览器 localStorage；公共电脑上用完请清空</span>
    </label>

    <div class="row">
      <div class="field">
        <label class="label" for="ai-model">模型</label>
        <input id="ai-model" v-model="form.model" placeholder="deepseek-chat" spellcheck="false" />
      </div>
      <label class="field narrow">
        <span class="label">协议</span>
        <select v-model="form.apiStyle">
          <option value="auto">自动识别</option>
          <option value="openai">OpenAI 兼容</option>
          <option value="anthropic">Anthropic 原生</option>
        </select>
      </label>
    </div>

    <div class="models-actions">
      <button class="btn btn-xs" type="button" :disabled="loadingModels" @click="fetchModels">{{ loadingModels ? '获取中…' : '获取模型' }}</button>
      <select v-if="models.length" aria-label="选择获取到的模型" :value="models.includes(form.model) ? form.model : ''" @change="form.model = ($event.target as HTMLSelectElement).value">
        <option value="" disabled>选择模型</option>
        <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
      </select>
    </div>
    <p v-if="modelsMessage" class="tip models-message" role="status">{{ modelsMessage }}</p>

    <div class="row">
      <label class="field">
        <span class="label">随机性 temperature：{{ form.temperature.toFixed(2) }}</span>
        <input v-model.number="form.temperature" type="range" min="0" max="1.5" step="0.05" />
      </label>
      <label class="field narrow">
        <span class="label">最大输出 tokens</span>
        <input v-model.number="form.maxTokens" type="number" min="256" max="64000" step="256" />
      </label>
    </div>

    <label v-if="state.serverAi.needsToken" class="field">
      <span class="label">访问口令（使用站点默认 AI 时需要）</span>
      <input v-model="form.accessToken" type="password" spellcheck="false" autocomplete="off" />
    </label>

    <label class="field">
      <span class="label">系统提示词</span>
      <textarea v-model="form.systemPrompt" rows="10" spellcheck="false" />
      <span class="tip">留空时不发送默认系统提示词</span>
    </label>
    <button class="btn btn-xs" type="button" style="margin: -8px 0 14px" @click="form.systemPrompt = DEFAULT_SYSTEM_PROMPT">恢复默认提示词</button>

    <label class="field">
      <span class="label">追加的系统提示（可选）</span>
      <textarea v-model="form.systemExtra" rows="3" placeholder="例如：我是 Java 后端，请用更技术化的表达；不要出现 emoji" />
    </label>

    <div class="field">
      <span class="label">本机字体</span>
      <span class="tip" style="margin-top: 0">
        浏览器读不到系统字体。内置了思源黑体（中文）与 Libertinus（西文）；想用微软雅黑、宋体等，可从
        C:\Windows\Fonts 选择 .ttf/.ttc/.otf 加载（仅本次会话有效）
      </span>
      <input ref="fontInput" type="file" accept=".ttf,.otf,.ttc" multiple class="hidden-input" @change="onFonts" />
      <button class="btn btn-xs" style="margin-top: 6px" @click="fontInput?.click()">选择字体文件…</button>
    </div>

    <pre v-if="testResult" class="test-result" :class="{ ok: testResult.ok }">{{ testResult.text }}</pre>

    </div>
    <footer class="settings-footer">
      <button class="btn btn-sm" :disabled="testing" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
      <button class="btn btn-sm primary" @click="save">保存</button>
    </footer>
  </div>
</template>

<style scoped>
.settings-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.settings-head { flex: none; height: 42px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
.settings-content { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; }
.intro { margin: 0 0 14px; color: var(--text-dim); font-size: 12px; line-height: 1.6; }
.settings-footer { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.preset {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--chip-bg);
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}
.preset:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
  background: var(--accent-soft);
}
.server-note {
  margin: 0 0 14px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 12px;
}
.field {
  display: block;
  margin-bottom: 14px;
}
.row {
  display: flex;
  gap: 12px;
}
.row .field {
  flex: 1;
  min-width: 0;
}
.row .field.narrow {
  flex: 1;
  min-width: 0;
}
.label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 5px;
}
.tip {
  display: block;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.6;
}
.key-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.models-actions { display: flex; gap: 8px; align-items: center; margin: -6px 0 14px; }
.models-actions select { flex: 1; min-width: 0; }
.models-message { margin: -8px 0 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
input:not([type='range']):not([type='file']),
select {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}
input:focus,
select:focus {
  outline: none;
  border-color: var(--accent);
}
input[type='range'] {
  width: 100%;
}
.hidden-input {
  display: none;
}
.test-result {
  margin: 4px 0 0;
  padding: 9px 11px;
  border-radius: 8px;
  background: rgba(229, 72, 77, 0.08);
  border: 1px solid rgba(229, 72, 77, 0.35);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--mono);
  color: #d1242f;
}
.test-result.ok {
  background: rgba(46, 160, 67, 0.08);
  border-color: rgba(46, 160, 67, 0.35);
  color: #1a7f37;
}

</style>
