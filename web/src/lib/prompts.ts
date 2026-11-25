/** AI 快捷动作：把提示词塞进输入框（需要用户补充信息的），或直接发送 */
export interface QuickAction {
  id: string;
  label: string;
  hint: string;
  prompt: string;
  /** true = 直接发送；false = 填进输入框等用户补充 */
  autoSend: boolean;
  needsSelection?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'polish',
    label: '润色选中文案',
    hint: '让选中段落更专业、更有力',
    prompt: '请润色我选中的这段文案：保持原意，去掉空话套话，用更有力的动词开头，长度不要明显变长',
    autoSend: true,
    needsSelection: true,
  },
  {
    id: 'quantify',
    label: '量化成果',
    hint: '把「负责…」改写成带数字的结果',
    prompt:
      '请把我简历里的工作经历与项目经历逐条改写成「动作 + 方法 + 可量化结果」的写法。没有数字的地方，用「【待补充：xx】」占位并告诉我该补哪些数据',
    autoSend: true,
  },
  {
    id: 'project',
    label: '生成项目经历',
    hint: '给我素材，我帮你写成项目条目',
    prompt:
      '请帮我把下面这段素材写成一条项目经历（背景 / 我的角色与动作 / 技术栈 / 结果），并直接更新到简历源码里：\n\n【项目名称】\n【我的角色】\n【用了什么技术】\n【解决了什么问题】\n【结果或数据】',
    autoSend: false,
  },
  {
    id: 'jd',
    label: '按 JD 定制',
    hint: '粘贴岗位 JD，做匹配度分析并改写',
    prompt:
      '下面是我要投的岗位 JD，请：\n1) 先给出匹配度分析与关键词缺口（列出我该补的关键词）；\n2) 再基于我的真实经历调整简历措辞与技能排序，使其贴合这个 JD\n\n【在这里粘贴 JD】',
    autoSend: false,
  },
  {
    id: 'translate',
    label: '翻译成英文',
    hint: '输出英文版简历源码',
    prompt:
      '请把简历正文翻译成地道的英文（职位与技术名词保留行业惯用写法），排版结构不要变',
    autoSend: true,
  },
  {
    id: 'ats',
    label: 'ATS 体检',
    hint: '检查关键词、格式与可读性风险',
    prompt:
      '请以 ATS（简历筛选系统）的角度体检我的简历：关键词覆盖、格式风险、可读性、时间线连续性。指出具体问题并给出改法',
    autoSend: true,
  },
  {
    id: 'layout',
    label: '排版美化',
    hint: '不改内容，只优化版式',
    prompt:
      '在完全不改动文字内容的前提下，优化这份 Typst 简历的排版：字号层级、行距、留白、对齐、强调色使用',
    autoSend: true,
  },
  {
    id: 'summary',
    label: '写自我评价',
    hint: '生成一段不做作的优势总结',
    prompt: '请基于我的经历，写一段 3 行以内的个人优势/自我评价：具体、有数据、不喊口号，并更新到源码中',
    autoSend: true,
  },
  {
    id: 'review',
    label: '全面诊断',
    hint: '3 条最重要的改进建议',
    prompt: '请通读我的简历，给出 3 条最重要的改进建议，按影响力排序，每条都说明「为什么」和「怎么改」',
    autoSend: true,
  },
];
