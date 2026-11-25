interface Replacement { from: number; to: number; text: string }

/** 将 AI 返回的精确替换应用到请求时的原文，任何歧义都拒绝应用 */
export function applyAiPatch(source: string, payload: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(payload); }
  catch { throw new Error('修改格式不是有效的 JSON，请让 AI 重新生成'); }
  if (!parsed || typeof parsed !== 'object' || !('edits' in parsed) || !Array.isArray(parsed.edits) || parsed.edits.length === 0) {
    throw new Error('修改列表为空或格式不正确，请让 AI 重新生成');
  }
  const replacements: Replacement[] = [];
  for (const edit of parsed.edits as unknown[]) {
    if (!edit || typeof edit !== 'object' || !('search' in edit) || !('replace' in edit) || typeof edit.search !== 'string' || typeof edit.replace !== 'string') {
      throw new Error('修改项必须包含文本格式的 search 和 replace，请让 AI 重新生成');
    }
    if (!edit.search) {
      if (source || parsed.edits.length !== 1) throw new Error('空匹配只允许用于空文件的首次生成');
      replacements.push({ from: 0, to: 0, text: edit.replace });
      continue;
    }
    const from = source.indexOf(edit.search);
    if (from < 0) throw new Error('AI 引用的原文与文件不一致，请重新生成修改');
    if (source.indexOf(edit.search, from + 1) !== -1) throw new Error('AI 引用的原文出现多次，无法确定位置，请重新生成修改');
    replacements.push({ from, to: from + edit.search.length, text: edit.replace });
  }
  replacements.sort((a, b) => a.from - b.from);
  for (let i = 1; i < replacements.length; i++) {
    if (replacements[i]!.from < replacements[i - 1]!.to) throw new Error('AI 返回的修改范围重叠，请重新生成修改');
  }
  let result = source;
  for (const edit of replacements.reverse()) result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  return result;
}

/** 兼容旧版完整文件回复时，保留原文件末尾的换行数量 */
export function preserveFinalNewlines(source: string, candidate: string): string {
  if (!candidate) return '';
  const ending = source.match(/(?:\r?\n)*$/)?.[0] ?? '';
  return candidate.replace(/(?:\r?\n)*$/, '') + ending;
}
