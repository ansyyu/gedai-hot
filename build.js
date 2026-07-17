#!/usr/bin/env node
/**
 * 个贷HOT 日报站点生成器（移动端优先）
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
const CATEGORIES = sources.categories; // [{id,name,desc,keywords}]

const tierClass = (t) => (t === "T1" ? "t1" : t === "T1.5" ? "t15" : "t2");
const tierLabel = (t) => (t === "T1" ? "T1 官方" : t === "T1.5" ? "T1.5 准官方" : "T2 媒体");

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
    <div class="card" data-cat="${esc(item.category)}">
      <div class="card-top">
        <span class="tier ${tierClass(item.tier)}">${tierLabel(item.tier)}</span><span class="src">${esc(item.source)}</span>
        <span class="score">★ ${item.score.toFixed(1)}</span>
      </div>
      <h3><a href="${esc(item.url)}" target="_blank">${esc(item.title)}</a></h3>
      <div class="summary">${rich(item.summary)}</div>
      <div class="reason">${esc(item.reason)}</div>
      <div class="meta"><span>${esc(item.dateNote || "")}</span>${links}</div>
    </div>`;
}

function renderPage(data, { isArchivePage = false, allDates = [] } = {}) {
  const prefix = isArchivePage ? "../" : "";
  const dailyPrefix = isArchivePage ? "" : "daily/";

  const idx = allDates.indexOf(data.date);
  const prevDate = idx > 0 ? allDates[idx - 1] : null;
  const nextDate = idx >= 0 && idx < allDates.length - 1 ? allDates[idx + 1] : null;
  const latestDate = allDates[allDates.length - 1];

  // 分类页签（含条数，空版块置灰）
  const counts = {};
  for (const it of data.items) counts[it.category] = (counts[it.category] || 0) + 1;
  const tabs =
    `<button class="tab active" data-cat="all">全部<i>${data.items.length}</i></button>` +
    CATEGORIES.map((c) => {
      const n = counts[c.id] || 0;
      return `<button class="tab${n ? "" : " empty"}" data-cat="${c.id}"${n ? "" : " disabled"}>${esc(c.name)}<i>${n}</i></button>`;
    }).join("");

  // 日期切换条
  const dateOptions = allDates
    .slice()
    .reverse()
    .map((d) => `<option value="${d}"${d === data.date ? " selected" : ""}>${d}${d === latestDate ? "（最新）" : ""}</option>`)
    .join("");
  const dateNav = `
  <div class="date-nav">
    ${prevDate ? `<a class="dbtn" href="${dailyPrefix}${prevDate}.html">‹ 前一天</a>` : `<span class="dbtn off">‹ 前一天</span>`}
    <select id="dateSel" class="date-sel">${dateOptions}</select>
    ${nextDate ? `<a class="dbtn" href="${dailyPrefix}${nextDate}.html">后一天 ›</a>` : `<span class="dbtn off">后一天 ›</span>`}
  </div>`;

  const stats = (data.stats || [])
    .map(
      (s) => `
    <div class="stat"><div class="num">${esc(s.num)}${s.unit ? `<small>${esc(s.unit)}</small>` : ""}</div><div class="lbl">${esc(s.label)}</div></div>`
    )
    .join("");

  // 播客播放器：仅当该期音频存在时渲染
  const hasAudio = fs.existsSync(path.join(ROOT, "audio", `${data.date}.mp3`));
  const player = hasAudio
    ? `
  <div class="player" id="player">
    <button class="play-btn" id="playBtn" aria-label="播放日报">▶</button>
    <div class="player-info">
      <div class="player-title">🎙️ AI 播客 · 听今天的日报</div>
      <div class="player-bar"><div class="player-progress" id="playerProgress"></div></div>
    </div>
    <span class="player-time" id="playerTime">--:--</span>
    <button class="speed-btn" id="speedBtn">1x</button>
    <audio id="audioEl" src="${prefix}audio/${data.date}.mp3" preload="none"></audio>
  </div>`
    : "";

  // 按分类分组渲染（组标题 + 卡片），便于"全部"视图下分区浏览
  const groups = CATEGORIES.map((c) => {
    const items = data.items.filter((i) => i.category === c.id);
    if (!items.length) return "";
    return `
  <section class="group" data-cat="${c.id}">
    <div class="sec-head"><h2>${esc(c.name)}</h2><span class="count">${items.length} 条</span></div>
    ${items.map(renderCard).join("\n")}
  </section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>个贷HOT | ${esc(data.date)}</title>
<link rel="stylesheet" href="${prefix}style.css">
</head>
<body>

<header>
  <div class="header-inner">
    <a href="${prefix}index.html" class="logo"><span class="flame">🔥</span>个贷<span>HOT</span></a>
    <div class="date-badge">${esc(data.date)}${data.weekday ? " · " + esc(data.weekday) : ""}</div>
    <a class="archive-link" href="${prefix}archive.html">📚</a>
  </div>
  <div class="tabbar" id="tabbar">${tabs}</div>
</header>

${dateNav}
${player}
<div class="focus">
  <div class="focus-card">
    <div class="tag">今日头条</div>
    <h2>${esc(data.focus.title)}</h2>
    <p>${rich(data.focus.summary)}</p>
  </div>
</div>

<div class="stats">${stats}</div>

<main id="content">
${groups}
</main>

<footer>
  <div class="legend">
    <span><span style="color:var(--t1)">■</span> T1 官方</span>
    <span><span style="color:var(--t15)">■</span> T1.5 准官方</span>
    <span><span style="color:var(--t2)">■</span> T2 媒体/智库</span>
  </div>
  <div>★ 评分为编辑参考分（时效/权威/相关/影响/可操作五维），内容以原文为准</div>
</footer>

<script>
(function(){
  // 分类页签切换
  var tabs = document.querySelectorAll('.tab');
  var groups = document.querySelectorAll('.group');
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      if (t.disabled) return;
      tabs.forEach(function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      var cat = t.dataset.cat;
      groups.forEach(function(g){
        g.style.display = (cat === 'all' || g.dataset.cat === cat) ? '' : 'none';
      });
      // 单类视图下隐藏组标题（页签已表明类别），全部视图恢复
      document.getElementById('content').classList.toggle('single', cat !== 'all');
      window.scrollTo({ top: 0 });
    });
  });
  // 日期下拉切换
  var sel = document.getElementById('dateSel');
  sel.addEventListener('change', function(){
    var d = sel.value;
    if (d === ${JSON.stringify(data.date)}) return;
    location.href = ${JSON.stringify(dailyPrefix)} + d + '.html';
  });
  // 播客播放器
  var audio = document.getElementById('audioEl');
  if (audio) {
    var btn = document.getElementById('playBtn');
    var prog = document.getElementById('playerProgress');
    var time = document.getElementById('playerTime');
    var speedBtn = document.getElementById('speedBtn');
    var speeds = [1, 1.25, 1.5, 2], si = 0;
    var fmt = function(s){ if(!isFinite(s)) return '--:--'; var m=Math.floor(s/60); return m+':'+String(Math.floor(s%60)).padStart(2,'0'); };
    btn.addEventListener('click', function(){
      if (audio.paused) { audio.play(); btn.textContent = '⏸'; }
      else { audio.pause(); btn.textContent = '▶'; }
    });
    audio.addEventListener('timeupdate', function(){
      if (audio.duration) prog.style.width = (audio.currentTime/audio.duration*100) + '%';
      time.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
    });
    audio.addEventListener('loadedmetadata', function(){ time.textContent = '0:00 / ' + fmt(audio.duration); });
    audio.addEventListener('ended', function(){ btn.textContent = '▶'; prog.style.width = '0'; });
    speedBtn.addEventListener('click', function(){
      si = (si+1) % speeds.length; audio.playbackRate = speeds[si]; speedBtn.textContent = speeds[si] + 'x';
    });
    document.querySelector('.player-bar').addEventListener('click', function(e){
      if (!audio.duration) return;
      var r = e.currentTarget.getBoundingClientRect();
      audio.currentTime = (e.clientX - r.left) / r.width * audio.duration;
    });
  }
})();
</script>
</body>
</html>`;
}

function renderArchiveIndex(entries) {
  const rows = entries
    .slice()
    .reverse()
    .map(
      (e) =>
        `<li><a href="daily/${e.date}.html"><span class="d">${e.date}</span><span class="t">${esc(e.focus.title)}</span></a></li>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>个贷HOT · 往期</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <div class="header-inner">
    <a href="index.html" class="logo"><span class="flame">🔥</span>个贷<span>HOT</span></a>
    <div class="date-badge">往期 · 共 ${entries.length} 期</div>
    <a class="archive-link" href="index.html">↩</a>
  </div>
</header>
<main class="archive-main">
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
