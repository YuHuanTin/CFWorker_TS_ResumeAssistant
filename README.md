# ResumeAssistant

用 Typst 写简历：左边编辑，右边实时渲染，内置一个能接入任意 AI 的简历助手。部署在 Cloudflare Workers 上。

## 架构

```
浏览器
 ├─ Vue 3 + CodeMirror 6（Typst 语法高亮）
 ├─ Web Worker：Typst 编译器（WASM，typst.ts 0.7）→ SVG 实时预览 / PDF 导出
 ├─ IndexedDB：简历文件
 └─ localStorage：AI 设置和偏好
Cloudflare Worker（worker/）
 ├─ Static Assets：托管前端构建产物 public/
 └─ /api/ai/*：AI 代理（OpenAI 兼容 + Anthropic 原生，SSE 流式）
```

- **实时渲染**：编译在浏览器里完成，不经过服务器。每次按键都会编译，Worker 里只保留最新一份（latest-wins），并复用增量缓存。
- **AI 接入**：在「设置」里填 Base URL、API Key 和模型。DeepSeek、Kimi、通义、智谱、OpenAI、Claude、OpenRouter、Gemini 等都有预设。请求经由 Worker 转发，以绕开浏览器的 CORS 限制。
- **项目文件**：左侧「文件」中可为每份简历新建、导入和编辑 `.typ` 文件；`main.typ` 是预览和 PDF 的入口，可通过相对路径 `#import "sections/style.typ": *` 或 `#include "sections/content.typ"` 引用其他文件。文件保存在浏览器本地。

## 命令

```bash
npm install
npm run dev       # wrangler dev（会先自动执行 vite build），http://localhost:8787
npm run deploy    # wrangler deploy
npm run typecheck
```

Vite 只作为前端构建器，由 `wrangler.jsonc` 里的 `build.command`（`npm run build`）自动调用。开发和部署都只需要 Wrangler。

> 注意：`wrangler dev` 启动后会缓存静态资源清单，运行期间再执行 `npm run build` 会导致新资源加载失败（返回 HTML）。改完前端代码请重启 `npm run dev`。

## 可选：站点默认 AI

```bash
# wrangler.jsonc 的 vars 里填 AI_BASE_URL / AI_MODEL，然后：
npm exec wrangler secret put AI_API_KEY
npm exec wrangler secret put ACCESS_TOKEN   # 强烈建议：否则任何人都能用你的 Key
```

用户没有填自己的 Key 时，会使用站点默认的 Key（需要访问口令）。

## 已知限制

- 编译器 wasm 约 27MB，超过 Cloudflare 静态资源单文件 25MiB 的上限，所以从 jsDelivr 加载（CDN 会做 br 压缩，实际传输约 9MB）。中文字体（思源黑体，约 16MB）也从 jsDelivr 加载。首次打开实际传输约 27MB，之后走浏览器缓存（wasm 走 Cache Storage，字体同理）。首次加载时预览区会显示真实下载进度（已下载 MB 数 + 进度条），不会只是一句「正在编译」。
- 浏览器读不到系统字体。如果想用微软雅黑或宋体，在「设置 → 本机字体」里选择字体文件（只在当前会话有效）。
- 不支持 `@preview` 第三方包。
- 简历和项目文件存在浏览器本地；换设备前请在文件面板逐个下载需要的 `.typ` 文件。
