// ════════════════════════════════════════════════════════════════════
//  现代简约 · ResumeAssistant 内置模板
//  特点：主色强调、留白紧凑、时间线式小标题，适合互联网 / 技术岗。
// ════════════════════════════════════════════════════════════════════

// ── 样式设置 ────────────────────────────────────────────────────────
#let brand     = rgb("#2f6feb")                       // 品牌色
#let ink       = rgb("#16181d")
#let subtle    = rgb("#6b7280")
#let hairline  = rgb("#e5e7eb")
#let fonts     = ("Noto Sans CJK SC", "Noto Serif CJK SC")

#set page(paper: "a4", margin: (x: 1.6cm, top: 1.3cm, bottom: 1.2cm))
#set text(font: fonts, size: 10pt, fill: ink, lang: "zh", region: "cn")
#set par(justify: false, leading: 0.72em, spacing: 0.6em)
#set list(indent: 0.95em, marker: text(fill: brand)[▸], spacing: 0.28em)

#let section(title) = block(above: 1em, below: 0.4em)[
  #text(size: 12pt, weight: "bold", fill: brand, tracking: 0.5pt)[#title]\
  #v(-2pt)
  #line(length: 100%, stroke: 0.6pt + hairline)
]

#let chip(text-content) = box(
  fill: brand.transparentize(90%),
  stroke: 0.5pt + brand.transparentize(70%),
  inset: (x: 5pt, y: 2pt),
  radius: 3pt,
  text(size: 9pt, fill: brand.darken(15%))[#text-content],
)

// 注意：不要用 #grid 做左右对齐 —— 浏览器端渲染器里「含 grid 的 block 后面紧跟列表」会丢失纵向间距
#let entry(org, period, role: none, tags: ()) = block(above: 0.85em, below: 0.28em, width: 100%)[
  #text(weight: "bold", size: 10.5pt)[#org]#if role != none [#h(0.6em)#text(fill: brand, size: 9.5pt, weight: "medium")[#role]]#h(1fr)#text(fill: subtle, size: 9pt)[#period]
  #if tags.len() > 0 [
    \
    #v(2pt)
    #tags.map(t => chip(t)).join(h(4pt))
  ]
]

// ── 抬头 ────────────────────────────────────────────────────────────
#block(width: 100%)[
  #text(size: 22pt, weight: "bold", tracking: 1.5pt)[张三]#h(1fr)#text(size: 9.5pt, fill: subtle)[138-0000-0000　zhang\@example.com　github.com/zhangsan]
  \
  #v(2pt)
  #text(size: 10.5pt, fill: brand, weight: "medium")[后端开发工程师 · 5 年经验]
  #v(6pt)
  #line(length: 100%, stroke: 1.2pt + brand)
]

// ── 概述 ────────────────────────────────────────────────────────────
#section[个人概述]
5 年后端研发经验，长期负责交易与订单域的架构演进。擅长把复杂业务拆成清晰边界，用数据说话：
主导的链路重构把接口 P99 从 480ms 压到 90ms、服务器成本下降 35%，并带 4 人小组完成订单中台从 0 到 1 的落地。

// ── 工作经历 ────────────────────────────────────────────────────────
#section[工作经历]

#entry("某某科技有限公司", "2022.07 – 至今", role: "高级后端工程师", tags: ("Go", "Kubernetes", "高并发"))
- 重构交易核心链路：异步编排 + 多级缓存，QPS 3k → 12k，机器成本 ↓35%。
- 落地分布式事务方案（本地消息表 + 最终一致），数据不一致问题由每月 5 起降为 0。
- 建立全链路压测与容量评估机制，大促零故障，峰值承压 8 倍日常流量。

#entry("某某网络科技", "2021.06 – 2021.12", role: "后端开发实习生", tags: ("Python",))
- 独立开发对账服务替代人工核对，月度对账耗时 2 天 → 30 分钟。

// ── 项目经历 ────────────────────────────────────────────────────────
#section[项目经历]

#entry("订单中台", "2023.03 – 2024.02", role: "技术负责人", tags: ("Go", "MySQL", "Kafka", "DDD"))
- 背景：三条业务线各自实现订单，重复开发、口径不一。
- 动作：抽象统一领域模型与状态机，沉淀 12 个标准能力接口。
- 结果：新业务接入周期 3 周 → 3 天，重复代码减少约 60%。

// ── 教育背景 ────────────────────────────────────────────────────────
#section[教育背景]
#entry("某某大学 · 计算机科学与技术 · 本科", "2017.09 – 2021.06")
- GPA 3.7/4.0（专业前 10%）；ACM 省级二等奖。

// ── 技能 ────────────────────────────────────────────────────────────
#section[专业技能]
#block(above: 0.3em)[*语言*#h(0.75em)Go（主力）、Java、Python、TypeScript，熟悉 SQL 调优]
#block(above: 0.25em)[*中间件*#h(0.75em)MySQL、Redis、Kafka、Elasticsearch、Kubernetes]
#block(above: 0.25em)[*工程能力*#h(0.75em)微服务治理、可观测性（Prometheus / OpenTelemetry）、CI-CD、线上排障]
