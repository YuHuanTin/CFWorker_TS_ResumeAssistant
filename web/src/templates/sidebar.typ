// ════════════════════════════════════════════════════════════════════
//  侧边栏双栏 · ResumeAssistant 内置模板
//  左栏深色信息条（联系方式 / 技能 / 教育），右栏主经历。
//  注意：这个版式为「单页」设计，内容过多请精简，或换用经典单栏模板。
// ════════════════════════════════════════════════════════════════════

// ── 样式设置 ────────────────────────────────────────────────────────
#let sidebar-bg = rgb("#12263f")                 // 左栏底色
#let accent     = rgb("#4cc9f0")                 // 强调色
#let ink        = rgb("#16181d")
#let subtle     = rgb("#6b7280")
#let fonts      = ("Noto Sans CJK SC", "Noto Serif CJK SC")
#let rail-width = 5.9cm

#set page(paper: "a4", margin: 0pt)
#set page(background: place(top + left, rect(width: rail-width, height: 100%, fill: sidebar-bg)))
#set text(font: fonts, size: 10pt, fill: ink, lang: "zh", region: "cn")
#set par(justify: false, leading: 0.74em, spacing: 0.65em)
#set list(indent: 0.95em, marker: text(fill: accent, weight: "bold")[▸], spacing: 0.3em)

// ── 右栏小工具 ──────────────────────────────────────────────────────
#let section(title) = block(above: 1.05em, below: 0.45em)[
  #text(size: 12pt, weight: "bold", fill: rgb("#12263f"))[#title]\
  #v(-2pt)
  #line(length: 100%, stroke: 1pt + rgb("#dbe4ef"))
]

// 注意：不要用 #grid 做左右对齐 —— 浏览器端渲染器里「含 grid 的 block 后面紧跟列表」会丢失纵向间距
#let entry(org, period, role: none) = block(above: 0.8em, below: 0.28em, width: 100%)[
  #text(weight: "bold", size: 10.5pt)[#org]#if role != none [#h(0.6em)#text(size: 9.5pt, fill: accent.darken(25%))[#role]]#h(1fr)#text(fill: subtle, size: 9pt)[#period]
]

// ── 左栏小工具（深色底，文字反白）───────────────────────────────────
#let rail-title(title) = block(above: 1em, below: 0.5em)[
  #text(size: 11pt, weight: "bold", fill: accent, tracking: 0.8pt)[#title]\
  #v(-2pt)
  #line(length: 100%, stroke: 0.8pt + accent.transparentize(40%))
]

#let rail-line(label, value) = block(above: 0.55em)[
  #text(size: 8.5pt, fill: accent.transparentize(20%))[#label]
  #linebreak()
  #text(size: 9.5pt)[#value]
]

#let bar(level) = block(above: 0.3em, below: 0.7em)[
  #rect(width: 100%, height: 4.5pt, radius: 2.5pt, fill: rgb("#2a415f"))[
    #place(left, rect(width: 100% * level, height: 4.5pt, radius: 2.5pt, fill: accent))
  ]
]

#grid(
  columns: (rail-width, 1fr),
  gutter: 0pt,
  // ══════════════════ 左栏 ══════════════════
  block(width: 100%, height: 100%, fill: sidebar-bg, inset: (x: 0.75cm, y: 1.25cm))[
    #set text(fill: rgb("#eaf1f8"))
    #text(size: 19pt, weight: "bold", tracking: 1.5pt)[张三]
    #v(4pt)
    #text(size: 10pt, fill: accent)[后端开发工程师]
    #v(6pt)
    #line(length: 100%, stroke: 0.8pt + rgb("#2a415f"))

    #rail-title[联系方式]
    #rail-line("手机", "138-0000-0000")
    #rail-line("邮箱", "zhang\@example.com")
    #rail-line("GitHub", "github.com/zhangsan")
    #rail-line("城市", "上海")

    #rail-title[技能]
    #text(size: 9.5pt)[Go / Java]
    #bar(0.92)
    #text(size: 9.5pt)[MySQL / Redis]
    #bar(0.88)
    #text(size: 9.5pt)[Kubernetes]
    #bar(0.75)
    #text(size: 9.5pt)[Python / TypeScript]
    #bar(0.7)

    #rail-title[教育]
    #text(size: 9.5pt, weight: "bold")[某某大学]
    #linebreak()
    #text(size: 9pt)[计算机科学与技术 · 本科]
    #linebreak()
    #text(size: 8.5pt, fill: accent.transparentize(20%))[2017.09 – 2021.06]
  ],
  // ══════════════════ 右栏 ══════════════════
  block(width: 100%, height: 100%, inset: (left: 0.85cm, right: 1.1cm, y: 1.25cm))[
    #section[个人概述]
    5 年后端研发经验，负责交易与订单域架构演进。主导的链路重构把接口 P99 从 480ms 压到 90ms、
    服务器成本下降 35%，并带 4 人小组完成订单中台从 0 到 1 落地。

    #section[工作经历]
    #entry("某某科技有限公司", "2022.07 – 至今", role: "高级后端工程师")
    - 重构交易核心链路，QPS 3k → 12k，机器成本 ↓35%。
    - 落地分布式事务方案，数据不一致问题归零。
    - 建立全链路压测机制，大促零故障。

    #entry("某某网络科技", "2021.06 – 2021.12", role: "后端实习生")
    - 独立开发对账服务，月度对账 2 天 → 30 分钟。

    #section[项目经历]
    #entry("订单中台", "2023.03 – 2024.02", role: "技术负责人")
    - 抽象统一领域模型与状态机，沉淀 12 个标准能力接口。
    - 新业务接入周期 3 周 → 3 天，重复代码减少约 60%。
  ],
)
