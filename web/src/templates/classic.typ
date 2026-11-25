// ════════════════════════════════════════════════════════════════════
//  经典单栏简历 · ResumeAssistant 内置模板
//  ATS 友好：没有分栏、没有图形、正文字体统一，机器解析最稳。
//  想换字体 / 配色 / 页边距，只改下面「样式设置」就够了。
// ════════════════════════════════════════════════════════════════════

// ── 样式设置 ────────────────────────────────────────────────────────
#let accent      = rgb("#1f4e79")                                  // 主色
#let ink         = rgb("#1a1a1a")                                  // 正文颜色
#let subtle      = rgb("#5a5a5a")                                  // 次要信息颜色
#let fonts       = ("Noto Sans CJK SC", "Noto Serif CJK SC")
#let base-size   = 10.5pt

#set page(paper: "a4", margin: (x: 1.7cm, top: 1.4cm, bottom: 1.4cm))
#set text(font: fonts, size: base-size, fill: ink, lang: "zh", region: "cn")
#set par(justify: false, leading: 0.75em, spacing: 0.7em)
#set list(indent: 1.05em, marker: text(fill: accent, weight: "bold")[·], spacing: 0.35em)
#set enum(indent: 1.05em, spacing: 0.35em)

// ── 排版工具（一般不用改）───────────────────────────────────────────
// 小节标题
#let section(title) = block(above: 1.15em, below: 0.5em, width: 100%)[
  #text(size: 12.5pt, weight: "bold", fill: accent)[#title]\
  #v(-2pt)
  #line(length: 100%, stroke: 0.8pt + accent.transparentize(55%))
]

// 一条经历抬头：左侧单位+职位，右侧时间
// 注意：这里用 #h(1fr) 做左右对齐，不要换成 #grid ——
// 浏览器端渲染器里「含 grid 的 block 后面紧跟列表」会丢失纵向间距。
#let entry(org, period, role: none) = block(above: 0.85em, below: 0.28em, width: 100%)[
  #text(weight: "bold", size: 11pt)[#org]#if role != none [#h(0.7em)#text(fill: subtle, size: 10pt)[#role]]#h(1fr)#text(fill: subtle, size: 9.5pt)[#period]
]

// 一行「标签 + 内容」，用来排技能、证书这类信息
#let kv(label, content) = block(above: 0.15em, below: 0.15em)[
  #text(weight: "bold")[#label]#h(0.75em)#content
]

// ── 抬头 ────────────────────────────────────────────────────────────
#align(center)[
  #text(size: 23pt, weight: "bold", tracking: 3pt)[张三]
  #v(6pt)
  #text(size: 10pt, fill: subtle)[
    求职意向：后端开发工程师　·　138-0000-0000　·　zhang\@example.com　·　github.com/zhangsan
  ]
]

// ── 个人优势 ────────────────────────────────────────────────────────
#section[个人优势]
#set list(marker: none)
- 5 年后端研发经验，主导过日活 200 万的交易系统架构演进，熟悉高并发与分布式事务。
- 带领 4 人小组从 0 到 1 交付订单中台，接口 P99 从 480ms 降到 90ms。
#set list(marker: text(fill: accent, weight: "bold")[·])

// ── 工作经历 ────────────────────────────────────────────────────────
#section[工作经历]

#entry("某某科技有限公司", "2022.07 – 至今", role: "高级后端工程师")
- 重构交易核心链路，引入异步编排与多级缓存，QPS 从 3k 提升到 12k，服务器成本下降 35%。
- 设计并落地分布式事务方案（本地消息表 + 最终一致），线上数据不一致问题由每月 5 起降为 0。
- 搭建全链路压测与容量评估流程，大促期间零故障，峰值承压 8 倍日常流量。

#entry("某某网络科技（实习）", "2021.06 – 2021.12", role: "后端开发实习生")
- 独立开发对账服务，替代人工核对流程，财务月度对账耗时从 2 天缩短到 30 分钟。

// ── 项目经历 ────────────────────────────────────────────────────────
#section[项目经历]

#entry("订单中台（Go / MySQL / Kafka）", "2023.03 – 2024.02", role: "技术负责人")
- 背景：三条业务线各有订单实现，重复开发严重、口径不一致。
- 动作：抽象出统一领域模型与状态机，提供 12 个标准能力接口，接入 3 条业务线。
- 结果：新业务接入周期从 3 周缩短到 3 天，重复代码减少约 60%。

// ── 教育背景 ────────────────────────────────────────────────────────
#section[教育背景]
#entry("某某大学　计算机科学与技术　本科", "2017.09 – 2021.06")
- 主修课程：数据结构、操作系统、数据库系统、分布式系统；GPA 3.7/4.0，专业前 10%。
- 全国大学生程序设计竞赛（ACM）省级二等奖。

// ── 技能 ────────────────────────────────────────────────────────────
#section[专业技能]
#kv("语言", [Go（主力）、Java、Python、TypeScript，熟悉 SQL 调优])
#kv("中间件", [MySQL、Redis、Kafka、Elasticsearch、Kubernetes，具备线上排障经验])
#kv("工程", [微服务治理、可观测性建设（Prometheus / OpenTelemetry）、CI-CD])

#v(1em)
#align(center)[#text(size: 8.5pt, fill: subtle)[本简历由 Typst 排版生成 · ResumeAssistant]]
