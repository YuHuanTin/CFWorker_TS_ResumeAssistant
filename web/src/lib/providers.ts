/** 常见 AI 服务商预设：一键填好 Base URL / 模型 / 协议，Key 需要自己填 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiStyle: 'auto' | 'openai' | 'anthropic';
  note: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiStyle: 'openai',
    note: '官方接口，需要能访问 OpenAI 的网络环境',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    apiStyle: 'anthropic',
    note: '原生 Messages 协议，长文本改简历效果好',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiStyle: 'openai',
    note: '国内直连，性价比高；推理模型填 deepseek-reasoner',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-32k',
    apiStyle: 'openai',
    note: '中文长文本友好',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    apiStyle: 'openai',
    note: '国内直连',
  },
  {
    id: 'dashscope',
    label: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    apiStyle: 'openai',
    note: 'DashScope 的 OpenAI 兼容模式',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    apiStyle: 'openai',
    note: '聚合多家开源模型',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-5',
    apiStyle: 'openai',
    note: '聚合各家模型，一个 Key 通用',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
    apiStyle: 'openai',
    note: '走 Google 的 OpenAI 兼容端点',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    apiStyle: 'openai',
    note: '本地模型，API Key 随便填一个非空值即可',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本地）',
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen2.5-14b-instruct',
    apiStyle: 'openai',
    note: '本地模型，需在 LM Studio 里开启本地服务',
  },
  {
    id: 'custom',
    label: '自定义 / 中转网关',
    baseUrl: '',
    model: '',
    apiStyle: 'auto',
    note: '任何 OpenAI 兼容或 Anthropic 兼容的地址都能用',
  },
];
