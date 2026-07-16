#!/usr/bin/env node
/**
 * 个贷HOT 日报站点生成器
 * 读取 archive/*.json（每日一份结构化数据）+ sources.json（信源配置），
 * 生成 index.html（最新一期）、daily/<date>.html（历史归档页）、archive.html（归档索引）。
 * 用法：node build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, "archive");
const DAILY_DIR = path.join(ROOT, "daily");

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8"));
const CATEGORIES = sources.categories; // [{id,name,keywords}]

const tierClass = (t) => (t === "T1" ? "t1" : t === "T1.5" ? "t15" : "t2");
const tierLabel = (t) =>
  t === "T1" ? "T1 · 官方" : t === "T1.5" ? "T1.5 · 协会/准官方" : "T2 · 媒体/智库";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// summary/focus 字段允许 <b> 加粗，其余转义
function rich(s) {
  return esc(s).replace(/&lt;(\/?b)&gt;/g, "<$1>");
}

function renderCard(item) {
  const links = (item.links || [])
    .map((l) => `<a href="${esc(l.url)}" target="_blank">${esc(l.text)} ↗</a>`)
    .join("");
  return `
    <div class="card">
      <div class="card-top">
        <span class="tier ${tierClass(item.tier)}">${tierLabel(item.tier)}</span><span>${esc(item.source)}</span>
        <span class="score">★ ${item.score.toFixed(1)}</span>
      </div>
      <h3><a href="${esc(item.url)}" target="_blank">${esc(item.title)}</a></h3>
      <div class="summary">${rich(item.summary)}</div>
      <div class="reason">${esc(item.reason)}</div>
      <div class="meta"><span>${esc(item.dateNote || "")}</span>${links}</div>
    </div>`;
}

function renderSection(cat, items) {
  const cards = items.filter((i) => i.category === cat.id);
  if (!cards.length) return "";
  return `
  <section id="${cat.id}">
    <div class="sec-head"><h2>${esc(cat.name)}</h2><span class="count">${cards.length} 条精选</span></div>
    ${cards.map(renderCard).join("\n")}
  </section>`;
}

function renderPage(data, { isArchivePage = false, allDates = [] } = {}) {
  const cssPath = isArchivePage ? "../style.css" : "style.css";
  const homePath = isArchivePage ? "../index.html" : "index.html";
  const archiveIdx = isArchivePage ? "../archive.html" : "archive.html";

  const nav = CATEGORIES.map((c) => `<a href="#${c.id}">${esc(c.name)}</a>`).join("");
  const stats = (data.stats || [])
    .map(
      (s) => `
    <div class="stat"><div class="num">${esc(s.num)}${s.unit ? `<small>${esc(s.unit)}</small>` : ""}</div><div class="lbl">${esc(s.label)}</div></div>`
    )
    .join("");

  const latestDate = allDates[allDates.length - 1];
  const banner =
    isArchivePage && data.date !== latestDate
      ? `<div class="archive-banner"><div class="inner">📚 你正在查看 ${esc(data.date)} 的历史日报 · <a href="${homePath}">返回最新一期</a></div></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>个贷HOT · 个人贷款热点日报 | ${esc(data.date)}</title>
<link rel="stylesheet" href="${cssPath}">
</head>
<body>

<header>
  <div class="header-inner">
    <a href="${homePath}" class="logo"><span class="flame">🔥</span>个贷<span>HOT</span></a>
    <div class="date-badge">${esc(data.date)} · ${esc(data.weekday || "")}</div>
    <nav>${nav}<a href="${archiveIdx}">📚 往期</a></nav>
  </div>
</header>

<div class="hero">
  <h1>个人贷款热点<em>日报</em></h1>
  <div class="sub">监控个贷领域政策 · 行业 · 同业 · 互金 · 金融科技五大信源方向，AI 评分精选，每日一报</div>
</div>
${banner}
<div class="focus">
  <div class="focus-card">
    <div class="tag">今日头条</div>
    <h2>${esc(data.focus.title)}</h2>
    <p>${rich(data.focus.summary)}</p>
  </div>
</div>

<div class="stats">${stats}</div>

<main>
${CATEGORIES.map((c) => renderSection(c, data.items)).join("\n")}
</main>

<footer>
  <div class="legend">
    <span><span style="color:var(--t1)">■</span> T1 官方一手信源（监管机构/央行）</span>
    <span><span style="color:var(--t15)">■</span> T1.5 行业协会/窗口指导</span>
    <span><span style="color:var(--t2)">■</span> T2 媒体/智库/机构研究</span>
  </div>
  <div>个贷HOT · 个人贷款热点日报 —— 方案参考 <a href="https://aihot.virxact.com/" target="_blank">数字生命卡兹克 AIHOT</a> 的版块化日报 + 信源分级 + AI评分模式</div>
  <div style="margin-top:6px">★ 评分为编辑参考分（时效性/权威性/业务相关性/影响面/可操作性五维），资讯内容以原文为准 · <a href="${archiveIdx}">往期归档</a></div>
</footer>

</body>
</html>`;
}

function renderArchiveIndex(entries) {
  const rows = entries
    .slice()
    .reverse()
    .map(
      (e) =>
        `<li><a href="daily/${e.date}.html" style="display:flex;gap:14px;align-items:baseline;width:100%"><span class="d">${e.date}</span><span class="t">${esc(e.focus.title)}</span></a></li>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>个贷HOT · 往期归档</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <div class="header-inner">
    <a href="index.html" class="logo"><span class="flame">🔥</span>个贷<span>HOT</span></a>
    <div class="date-badge">往期归档 · 共 ${entries.length} 期</div>
    <nav><a href="index.html">返回最新</a></nav>
  </div>
</header>
<div class="hero">
  <h1>往期<em>归档</em></h1>
  <div class="sub">每日日报数据永久沉淀，点击任意日期回溯当天的个贷热点</div>
</div>
<main>
  <ul class="archive-list">
${rows}
  </ul>
</main>
<footer><div>个贷HOT · 个人贷款热点日报</div></footer>
</body>
</html>`;
}

// ---------- main ----------
if (!fs.existsSync(DAILY_DIR)) fs.mkdirSync(DAILY_DIR, { recursive: true });

const files = fs
  .readdirSync(ARCHIVE_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort();

if (!files.length) {
  console.error("archive/ 下没有找到任何 YYYY-MM-DD.json 数据文件");
  process.exit(1);
}

const entries = files.map((f) => JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), "utf8")));
const allDates = entries.map((e) => e.date);

// 每期生成归档页
for (const e of entries) {
  fs.writeFileSync(
    path.join(DAILY_DIR, `${e.date}.html`),
    renderPage(e, { isArchivePage: true, allDates }),
    "utf8"
  );
}
// 最新一期作为首页
const latest = entries[entries.length - 1];
fs.writeFileSync(path.join(ROOT, "index.html"), renderPage(latest, { allDates }), "utf8");
// 归档索引
fs.writeFileSync(path.join(ROOT, "archive.html"), renderArchiveIndex(entries), "utf8");

console.log(`✅ 生成完成：index.html（${latest.date}）+ ${entries.length} 期归档 + archive.html`);
