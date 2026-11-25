export interface DiffLine { kind: 'same' | 'add' | 'remove'; text: string; oldLine?: number; newLine?: number }
export interface DiffHunk { id: number; from: number; to: number; original: string; replacement: string }

export function lineDiff(before: string, after: string): DiffLine[] {
  if (before === after) return before.split('\n').map((text, i) => ({ kind: 'same', text, oldLine: i + 1, newLine: i + 1 }));
  const a = before.split('\n');
  const b = after.split('\n');
  const rows: DiffLine[] = [];
  let i = 0, j = 0;
  const same = () => { rows.push({ kind: 'same', text: a[i]!, oldLine: i + 1, newLine: j + 1 }); i++; j++; };
  const remove = () => { rows.push({ kind: 'remove', text: a[i]!, oldLine: i + 1 }); i++; };
  const add = () => { rows.push({ kind: 'add', text: b[j]!, newLine: j + 1 }); j++; };
  while (i < a.length && j < b.length && a[i] === b[j]) same();
  let endA = a.length, endB = b.length;
  while (endA > i && endB > j && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - i, m = endB - j;
  if (n * m <= 1_000_000) {
    const startA = i, startB = j;
    const cols = m + 1;
    const table = new Uint32Array((n + 1) * cols);
    for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) {
      table[x * cols + y] = a[startA + x] === b[startB + y] ? table[(x + 1) * cols + y + 1]! + 1 : Math.max(table[(x + 1) * cols + y]!, table[x * cols + y + 1]!);
    }
    while (i < endA && j < endB) {
      if (a[i] === b[j]) same();
      else if (table[(i - startA + 1) * cols + j - startB]! >= table[(i - startA) * cols + j - startB + 1]!) remove();
      else add();
    }
  }
  while (i < endA) remove();
  while (j < endB) add();
  while (i < a.length && j < b.length) same();
  return rows;
}

export function diffHunks(before: string, after: string): DiffHunk[] {
  const rows = lineDiff(before, after);
  const starts = (text: string): number[] => {
    const result = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') result.push(i + 1);
    return result;
  };
  const oldStarts = starts(before), newStarts = starts(after);
  const chunks: DiffHunk[] = [];
  let oldLine = 0, newLine = 0, index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind === 'same') { oldLine++; newLine++; index++; continue; }
    let oldStart = oldLine, newStart = newLine;
    while (index < rows.length && rows[index]!.kind !== 'same') {
      if (rows[index]!.kind === 'remove') oldLine++; else newLine++;
      index++;
    }
    // At EOF the preceding newline belongs to the preceding line; include it
    // in the final change so insertions and deletions preserve exact bytes.
    if (index === rows.length && oldStart > 0 && newStart > 0) { oldStart--; newStart--; }
    const from = oldStarts[oldStart] ?? before.length;
    const to = oldStarts[oldLine] ?? before.length;
    const newFrom = newStarts[newStart] ?? after.length;
    const newTo = newStarts[newLine] ?? after.length;
    chunks.push({ id: chunks.length, from, to, original: before.slice(from, to), replacement: after.slice(newFrom, newTo) });
  }
  return chunks;
}
