/** Markdown 渲染（AI 回复）：marked + DOMPurify，并把 ```typst 代码块变成可一键应用的卡片 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export interface RenderedMarkdown {
  html: string;
  /** 可审阅的修改或旧版源码块，index 与 html 里的 data-block 对应 */
  blocks: { code: string; kind: 'patch' | 'source'; open: boolean }[];
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FENCE = /```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g;
const PLACEHOLDER = (i: number): string => `%%RABLOCK${i}%%`;

interface ExtractedBlock {
  lang: string;
  code: string;
  open: boolean;
}

function extractBlocks(markdown: string): { text: string; blocks: ExtractedBlock[] } {
  const blocks: ExtractedBlock[] = [];
  const text = markdown.replace(FENCE, (_m, lang: string, code: string) => {
    const open = !_m.trimEnd().endsWith('```') || _m.length - code.length < 4;
    blocks.push({ lang: (lang ?? '').toLowerCase(), code: code.replace(/\r?\n$/, ''), open });
    return `\n\n${PLACEHOLDER(blocks.length - 1)}\n\n`;
  });
  return { text, blocks };
}

export function renderMarkdown(markdown: string): RenderedMarkdown {
  const { text, blocks } = extractBlocks(markdown ?? '');
  const rawHtml = marked.parse(text, { async: false, breaks: true, gfm: true }) as string;

  const typstBlocks: RenderedMarkdown['blocks'] = [];
  let html = rawHtml.replace(new RegExp(`<p>\\s*${PLACEHOLDER(0).replace('0', '(\\d+)')}\\s*</p>`, 'g'), (_m, idx: string) => {
    const block = blocks[Number(idx)];
    if (!block) return '';
    if (block.lang !== 'typst' && block.lang !== 'typ' && block.lang !== 'typst-edit') {
      return `<pre class="ai-code plain"><code>${escapeHtml(block.code)}</code></pre>`;
    }
    const kind = block.lang === 'typst-edit' ? 'patch' : 'source';
    const blockIndex = typstBlocks.push({ code: block.code, kind, open: block.open }) - 1;
    const lines = block.code.split('\n').length;
    const kb = (block.code.length / 1024).toFixed(1);
    return `<div class="ai-block" data-block="${blockIndex}">
      <div class="ai-block-head">
        <span class="ai-block-lang">${kind === 'patch' ? 'Typst 局部修改' : 'Typst 源码'}${block.open ? '（生成中…）' : ''}</span>
        <span class="ai-block-meta">${lines} 行 · ${kb} KB</span>
        <span class="ai-block-actions">
          <button type="button" class="btn btn-xs" data-action="apply" data-block="${blockIndex}"${block.open ? ' disabled' : ''}>查看修改</button>
          <button type="button" class="btn btn-xs ghost" data-action="copy" data-block="${blockIndex}">复制</button>
        </span>
      </div>
      <pre class="ai-code"><code>${escapeHtml(block.code)}</code></pre>
    </div>`;
  });

  // 兜底：占位符没被 <p> 包住的情况
  html = html.replace(new RegExp(PLACEHOLDER(0).replace('0', '(\\d+)'), 'g'), (_m, idx: string) => {
    const block = blocks[Number(idx)];
    return block ? `<pre class="ai-code plain"><code>${escapeHtml(block.code)}</code></pre>` : '';
  });

  return {
    html: DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel', 'disabled'], ADD_TAGS: ['button'] }),
    blocks: typstBlocks,
  };
}
