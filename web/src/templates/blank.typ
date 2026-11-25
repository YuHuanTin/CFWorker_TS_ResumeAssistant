// ════════════════════════════════════════════════════════════════════
//  空白起步 · ResumeAssistant 内置模板
//  只放最必要的样式设置，其余按自己的思路写。
//  常用语法速查：
//    = 一级标题   == 二级标题     - 列表项
//    #text(weight: "bold")[加粗]  #text(fill: red)[彩色]
//    #v(1em) 竖排空行   #h(1fr) 占满剩余宽度（用于左右对齐）
//    #grid(columns: (1fr, 1fr), 左, 右)   #line(length: 100%)
//  注意：正文里的 @ 要写成 \@，井号要写成 \#
// ════════════════════════════════════════════════════════════════════

#let accent  = rgb("#1f4e79")
#let fonts   = ("Noto Sans CJK SC", "Noto Serif CJK SC")

#set page(paper: "a4", margin: (x: 1.8cm, y: 1.5cm))
#set text(font: fonts, size: 10.5pt, lang: "zh", region: "cn")
#set par(justify: false, leading: 0.75em, spacing: 0.7em)
#set list(indent: 1em, marker: text(fill: accent)[·])
#set heading(numbering: none)

#show heading.where(level: 1): it => block(above: 1em, below: 0.4em)[
  #text(size: 12.5pt, weight: "bold", fill: accent)[#it.body]\
  #v(-2pt)
  #line(length: 100%, stroke: 0.6pt + accent.transparentize(60%))
]

// ── 从这里开始写 ────────────────────────────────────────────────────
#align(center)[
  #text(size: 22pt, weight: "bold")[你的名字]
  #v(4pt)
  #text(size: 10pt, fill: rgb("#555"))[求职意向　·　手机　·　邮箱]
]

= 个人优势
- 一句话说清「你是谁 + 最强的一点 + 可量化的结果」。

= 工作经历
#text(weight: "bold")[公司名称] #h(1fr) #text(fill: rgb("#666"), size: 9.5pt)[2022.07 – 至今]
- 做了什么，用了什么方法，带来什么可量化的结果。

= 项目经历
- 项目名、你的角色、技术栈、结果。

= 教育背景
- 学校 · 专业 · 学历 · 时间。

= 专业技能
- 按「语言 / 框架 / 工具 / 其他」分组，写清熟练度。
