import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { diffHunks, type DiffHunk } from './lineDiff';

export const showAiChanges = StateEffect.define<DiffHunk[]>();
export const clearAiChanges = StateEffect.define<void>();
const resolveAiChange = StateEffect.define<number>();

export function aiChanges(onResolved: (remaining: number) => void): Extension {
  const field = StateField.define<readonly DiffHunk[]>({
    create: () => [],
    update(chunks, tr) {
      let next = chunks;
      for (const effect of tr.effects) {
        if (effect.is(showAiChanges)) return effect.value;
        if (effect.is(clearAiChanges)) return [];
        if (effect.is(resolveAiChange)) next = next.filter((chunk) => chunk.id !== effect.value);
      }
      if (!tr.docChanged) return next;
      return next.map((chunk) => {
        const from = tr.changes.mapPos(chunk.from, 1);
        const to = Math.max(from, tr.changes.mapPos(chunk.to, -1));
        return { ...chunk, from, to };
      });
    },
  });

  function decide(view: EditorView, id: number, accept: boolean): void {
    const chunks = view.state.field(field);
    const chunk = chunks.find((item) => item.id === id);
    if (!chunk) return;
    if (accept && view.state.sliceDoc(chunk.from, chunk.to) !== chunk.original) return;
    view.dispatch({
      effects: resolveAiChange.of(id),
      ...(accept ? { changes: { from: chunk.from, to: chunk.to, insert: chunk.replacement }, annotations: isolateHistory.of('full') } : {}),
    });
    onResolved(view.state.field(field).length);
  }

  class ChangeWidget extends WidgetType {
    constructor(readonly chunk: DiffHunk, readonly conflict: boolean) { super(); }
    eq(other: ChangeWidget): boolean { return this.chunk.id === other.chunk.id && this.chunk.replacement === other.chunk.replacement && this.conflict === other.conflict; }
    toDOM(view: EditorView): HTMLElement {
      const root = document.createElement('div');
      root.className = 'cm-ai-change';
      const bar = document.createElement('div');
      bar.className = 'cm-ai-change-bar';
      const label = document.createElement('span');
      label.textContent = this.conflict ? '这处内容已修改，请忽略后重新生成' : 'AI 建议';
      bar.append(label);
      for (const [text, accept] of [['应用', true], ['忽略', false]] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.className = accept ? 'cm-ai-accept' : 'cm-ai-ignore';
        button.disabled = accept && this.conflict;
        button.addEventListener('click', () => decide(view, this.chunk.id, accept));
        bar.append(button);
      }
      root.append(bar);
      if (this.chunk.replacement) {
        const inserted = document.createElement('pre');
        inserted.className = 'cm-ai-added';
        inserted.textContent = this.chunk.replacement.replace(/\n$/, '');
        root.append(inserted);
      }
      return root;
    }
    ignoreEvent(): boolean { return true; }
  }

  const decorations = EditorView.decorations.compute([field, 'doc'], (state): DecorationSet => {
    const ranges: Range<Decoration>[] = [];
    for (const chunk of state.field(field)) {
      const start = Math.min(chunk.from, state.doc.length);
      const end = Math.min(chunk.to, state.doc.length);
      const conflict = state.sliceDoc(start, end) !== chunk.original;
      ranges.push(Decoration.widget({ widget: new ChangeWidget(chunk, conflict), block: true, side: -1 }).range(state.doc.lineAt(start).from));
      if (chunk.original && end > start) {
        let line = state.doc.lineAt(start);
        while (line.from < end) {
          ranges.push(Decoration.line({ class: 'cm-ai-removed' }).range(line.from));
          if (line.number >= state.doc.lines) break;
          line = state.doc.line(line.number + 1);
        }
      }
    }
    return Decoration.set(ranges, true);
  });
  return [field, decorations];
}

export function makeAiChanges(before: string, after: string): DiffHunk[] { return diffHunks(before, after); }
