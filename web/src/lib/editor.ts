/** CodeMirror 6 的 Typst 语言配置与主题（纯 JS Lezer 解析器，无需 wasm，配合服务端诊断） */
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, Prec, type Extension, type Range } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { typst_lezer, typstTags } from 'codemirror-lang-typst/lezer';

let cachedSupport: ReturnType<typeof typst_lezer> | null = null;

/** Typst 语言支持：语法高亮 + 缩进 + 折叠 + 列表快捷键 + 本地语法检查 */
export function typstSupport(): ReturnType<typeof typst_lezer> {
  if (!cachedSupport) cachedSupport = typst_lezer();
  return cachedSupport;
}

const lightHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#8a8f98', fontStyle: 'italic' },
  { tag: t.monospace, color: '#57606a', background: '#f2f3f5' },
  { tag: [t.keyword, t.atom, t.bool, t.null], color: '#c0392b' },
  { tag: [t.number], color: '#a02c72' },
  { tag: [t.string], color: '#1a7f37' },
  { tag: [t.escape, t.labelName], color: '#0d6e6e' },
  { tag: t.function(t.variableName), color: '#2f5fbf' },
  { tag: [t.propertyName], color: '#7a3fb5' },
  { tag: [t.heading], color: '#1f4e79', fontWeight: '600' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: '#1a6bb5', textDecoration: 'underline' },
  { tag: [t.punctuation, t.separator], color: '#6b7280' },
  { tag: [t.operator], color: '#c0392b' },
  { tag: typstTags.mathDelimiter, color: '#0f8a3d' },
  { tag: typstTags.listMarker, color: '#8b41b1' },
  { tag: typstTags.interpolated, color: '#8b41b1' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#7d8590', fontStyle: 'italic' },
  { tag: t.monospace, color: '#c9d1d9', background: '#2a2f38' },
  { tag: [t.keyword, t.atom, t.bool, t.null], color: '#ff7b72' },
  { tag: [t.number], color: '#f778ba' },
  { tag: [t.string], color: '#7ee787' },
  { tag: [t.escape, t.labelName], color: '#79c0ff' },
  { tag: t.function(t.variableName), color: '#a5b4fc' },
  { tag: [t.propertyName], color: '#d2a8ff' },
  { tag: [t.heading], color: '#a5d6ff', fontWeight: '600' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: '#58a6ff', textDecoration: 'underline' },
  { tag: [t.punctuation, t.separator], color: '#8b949e' },
  { tag: [t.operator], color: '#ff7b72' },
  { tag: typstTags.mathDelimiter, color: '#7ee787' },
  { tag: typstTags.listMarker, color: '#d2a8ff' },
  { tag: typstTags.interpolated, color: '#d2a8ff' },
]);

const sharedTheme = (dark: boolean): Extension =>
  EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: 'var(--editor-font-size, 13px)',
        backgroundColor: 'transparent',
      },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Microsoft YaHei Mono', monospace",
        lineHeight: '1.62',
        padding: '10px 0 40vh 0',
      },
      '.cm-content': { caretColor: dark ? '#7ee787' : '#1f6feb', paddingLeft: '6px' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
        color: dark ? '#4d5560' : '#b6bcc6',
        paddingRight: '4px',
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: dark ? '#8b949e' : '#7a8290' },
      '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.035)' },
      '.cm-line': { paddingLeft: '6px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftWidth: '2px' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(88,166,255,.28)' : 'rgba(31,111,235,.18)',
      },
      '.cm-lintRange-error': {
        textDecoration: 'underline wavy',
        textDecorationColor: '#e5484d',
        textUnderlineOffset: '3px',
      },
      '.cm-lintRange-warning': {
        textDecoration: 'underline wavy',
        textDecorationColor: '#d0a215',
        textUnderlineOffset: '3px',
      },
      '.cm-panels': { backgroundColor: dark ? '#15181d' : '#f6f7f9', color: 'inherit' },
      '.cm-tooltip': {
        border: `1px solid ${dark ? '#2d333b' : '#e1e4e8'}`,
        backgroundColor: dark ? '#1b1f26' : '#fff',
        borderRadius: '6px',
      },
      '.cm-diag-line': { backgroundColor: dark ? 'rgba(229,72,77,.12)' : 'rgba(229,72,77,.07)' },
    },
    { dark }
  );

export const lightTheme: Extension = [sharedTheme(false), Prec.highest(syntaxHighlighting(lightHighlight))];
export const darkTheme: Extension = [sharedTheme(true), Prec.highest(syntaxHighlighting(darkHighlight))];

/* ------------------------------------------------ 服务端诊断的行高亮 */

export const setDiagnosticLines = StateEffect.define<number[]>();

export const diagnosticLines: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setDiagnosticLines)) continue;
      const marks: Range<Decoration>[] = [];
      const total = tr.state.doc.lines;
      for (const lineNo of effect.value) {
        if (lineNo >= 1 && lineNo <= total) {
          marks.push(Decoration.line({ class: 'cm-diag-line' }).range(tr.state.doc.line(lineNo).from));
        }
      }
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
