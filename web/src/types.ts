/** 前后端共享的数据结构 */

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  hint: string;
  line: number | null;
  path?: string;
}

export interface RenderPayload {
  /** 客户端请求序号，服务端原样回传 */
  seq: number;
  ok: boolean;
  svg: string | null;
  pages: number;
  diagnostics: Diagnostic[];
  compileMs: number;
  renderMs: number;
  queueMs: number;
  /** 客户端测量的按键到回包往返耗时（服务端回包时也会带上） */
  rttMs?: number;
  bytes?: number;
  cached?: boolean;
}

export interface ResumeSummary {
  id: string;
  name: string;
  updatedAt: number;
  chars: number;
}

export type WorkspaceFile = string | { base64: string };

export interface ResumeRecord extends ResumeSummary {
  source: string;
  files?: Record<string, WorkspaceFile>;
  previewEntry?: string | null;
  messages?: ChatMessage[];
  aiDraft?: string;
  aiDraftTarget?: { docId: string; path: string } | null;
  createdAt: number;
}

export interface Template {
  id: string;
  title: string;
  desc: string;
  source: string;
}

export interface FontInfo {
  family: string;
  label: string;
}

export interface PublicAiConfig {
  baseUrl: string;
  model: string;
  apiStyle: 'auto' | 'openai' | 'anthropic';
  temperature: number;
  maxTokens: number;
  systemExtra: string;
  hasKey: boolean;
  keyHint: string;
}

export interface PublicConfig {
  ai: PublicAiConfig;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  completionNotice?: string;
  error?: boolean;
  model?: string;
  streaming?: boolean;
  editTarget?: { docId: string; path: string; source: string };
}

export interface Selection {
  from: number;
  to: number;
  text: string;
  lines: number;
}
