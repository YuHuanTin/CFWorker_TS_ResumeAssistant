/**
 * 把 Typst 编译出的整页 SVG 拆成「一页一个 <svg>」，
 * 这样预览区可以按页做白底卡片，并且 Vue 可以只更新真正变化的那一页
 * （未变化的页面 html 字符串不变，Vue 不会重新 patch，杜绝打字时整页闪烁）。
 */

export interface PageSlice {
  index: number;
  width: number;
  height: number;
  html: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function splitSvgDocument(svg: string): PageSlice[] {
  if (!svg) return [];
  // 浏览器端渲染器输出的 SVG 不是严格 XML（image/svg+xml 会报 parsererror），用宽松的 HTML 解析器
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${svg}</body>`, 'text/html');
  const root = doc.body.querySelector('svg');
  const whole = (): PageSlice[] => [{ index: 0, width: 595, height: 842, html: svg }];
  if (!root) return whole();

  const heads: string[] = [];
  const pages: Element[] = [];
  for (const child of Array.from(root.children)) {
    const name = child.nodeName.toLowerCase();
    if (name === 'style' || name === 'defs') heads.push(child.outerHTML);
    else if (name === 'g' && (child.getAttribute('class') ?? '').split(/\s+/).includes('typst-page')) pages.push(child);
  }
  const headHtml = heads.join('');

  // 兜底：结构不是「每页一个 g.typst-page」时，整张 SVG 作为一页展示，保证预览永不空白
  if (pages.length === 0) {
    const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const width = vb[2] || Number(root.getAttribute('width')) || 595;
    const height = vb[3] || Number(root.getAttribute('height')) || 842;
    return [{ index: 0, width, height, html: svg }];
  }

  return pages.map((page, index) => {
    const clone = page.cloneNode(true) as Element;
    clone.removeAttribute('transform');
    const width = Number(page.getAttribute('data-page-width')) || Number(root.getAttribute('width')) || 595;
    const height = Number(page.getAttribute('data-page-height')) || Number(root.getAttribute('height')) || 842;
    return {
      index,
      width,
      height,
      html: `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMin meet">${headHtml}${clone.outerHTML}</svg>`,
    };
  });
}

/** 把诊断信息按严重程度排序、把「字体缺失」这类噪音合并成一条提示 */
export interface GroupedDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  hint: string;
  line: number | null;
  path?: string;
  count: number;
}

export function groupDiagnostics(
  list: { severity: 'error' | 'warning'; message: string; hint: string; line: number | null; path?: string }[]
): GroupedDiagnostic[] {
  const out: GroupedDiagnostic[] = [];
  const fontNoise: string[] = [];
  for (const d of list) {
    if (/^unknown font family/i.test(d.message)) {
      fontNoise.push(d.message.replace(/^unknown font family:?\s*/i, ''));
      continue;
    }
    const hit = out.find((o) => o.message === d.message && o.line === d.line && o.path === d.path);
    if (hit) hit.count += 1;
    else out.push({ ...d, count: 1 });
  }
  if (fontNoise.length) {
    out.push({
      severity: 'warning',
      message: `以下备选字体在本机不存在，已自动回退：${[...new Set(fontNoise)].join('、')}`,
      hint: '不影响显示，想消除这条提示就把字体列表里没有的字体删掉',
      line: null,
      count: 1,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? (a.line ?? 1e9) - (b.line ?? 1e9) : a.severity === 'error' ? -1 : 1));
}
