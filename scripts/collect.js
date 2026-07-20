#!/usr/bin/env node
/**
 * 采集器 v2：
 *  源1（主）：新浪财经滚动新闻 API（真实链接+发布时间戳），按 matchKeywords 过滤个贷相关
 *  源2（辅）：Bing News RSS 按版块关键词搜索（本地代理环境可能不可用，失败自动跳过）
 * 严格过滤最近 48 小时 + 对照 data/seen.json 去重，输出 data/collected.json。
 * 本地测试：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 node scripts/collect.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SEEN_FILE = path.join(DATA_DIR, "seen.json");
const OUT_FILE = path.join(DATA_DIR, "collected.json");

const MAX_AGE_HOURS = 48;
// 新浪滚动频道：2509=财经全部（高频更新，配合 matchKeywords 本地过滤；抓12页≈600条覆盖48小时）
const SINA_CHANNELS = [
  { lid: 2509, pages: 12 },
];

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8"));
const MATCH = sources.matchKeywords || ["贷款", "信贷", "房贷", "利率"];
const EXCLUDE = sources.excludeKeywords || [];
const hit = (title) =>
  MATCH.some((k) => title.includes(k)) && !EXCLUDE.some((k) => title.includes(k));

const decodeEntities = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "").trim();

const fingerprint = (t) => String(t).replace(/[^一-龥A-Za-z0-9]/g, "").slice(0, 24);

async function get(url, asJson) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gedai-hot" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return asJson ? res.json() : res.text();
}

// ---- 源1：新浪滚动 ----
async function fetchSina() {
  const out = [];
  for (const ch of SINA_CHANNELS) {
    for (let p = 1; p <= ch.pages; p++) {
      try {
        const j = await get(
          `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${ch.lid}&k=&num=50&page=${p}`,
          true
        );
        for (const d of j?.result?.data || []) {
          const title = decodeEntities(d.title);
          if (!hit(title)) continue;
          out.push({
            title,
            url: d.url,
            source: "新浪财经",
            pubDate: new Date(Number(d.ctime) * 1000).toISOString(),
            desc: decodeEntities(d.intro || "").slice(0, 120),
          });
        }
      } catch (e) {
        console.error(`  ⚠ 新浪 lid=${ch.lid} p=${p} 失败：${e.message}`);
      }
    }
  }
  return out;
}

// ---- 源2：Bing News RSS（可选，失败跳过）----
function parseRss(xml) {
  const items = [];
  for (const b of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? m[1] : "";
    };
    const rawLink = decodeEntities(pick("link"));
    let url = rawLink;
    try {
      const inner = new URL(rawLink).searchParams.get("url");
      if (inner) url = decodeURIComponent(inner);
    } catch (e) {}
    const title = decodeEntities(pick("title"));
    if (title && url && url.startsWith("http") && !url.includes("bing.com"))
      items.push({
        title, url,
        source: decodeEntities(pick("News:Source") || pick("source")) || "网络媒体",
        pubDate: pick("pubDate"),
        desc: decodeEntities(pick("description")).slice(0, 120),
      });
  }
  return items;
}

async function fetchBing() {
  const out = [];
  const queries = sources.categories.flatMap((c) => c.keywords.slice(0, 1));
  for (const q of queries) {
    try {
      const xml = await get(
        "https://www.bing.com/news/search?format=rss&mkt=zh-CN&q=" + encodeURIComponent(q)
      );
      const items = parseRss(xml)
        .filter((it) => hit(it.title))
        .map((it) => ({
          ...it,
          pubDate: new Date(Date.parse(it.pubDate)).toISOString(),
        }));
      out.push(...items.filter((it) => !isNaN(Date.parse(it.pubDate))));
    } catch (e) {
      console.error(`  ⚠ Bing「${q}」失败：${e.message}`);
    }
  }
  return out;
}

(async () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const seen = fs.existsSync(SEEN_FILE)
    ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))
    : { urls: {}, fps: {} };

  const now = Date.now();
  // 官方/媒体直采适配器（监管总局、央行、统计局、证券时报、新华财经…）
  const { adapters } = require("./adapters.js");
  const official = [];
  for (const fn of adapters) {
    const got = await fn();
    console.log(`  ${fn.name}: ${got.length} 条`);
    // 官方源(T1/T1.5)不做标题关键词过滤——由 AI 编辑判断相关性；搜索/媒体条目仍过滤
    official.push(
      ...got.filter((it) => (it.tier === "T1" || it.tier === "T1.5" ? true : hit(it.title)))
    );
  }
  const sina = await fetchSina();
  const bing = await fetchBing();
  console.log(`直采 ${official.length} 条，新浪命中 ${sina.length} 条，Bing 命中 ${bing.length} 条`);

  let tooOld = 0, dup = 0;
  const byUrl = new Map();
  for (const it of [...official, ...sina, ...bing]) {
    const t = Date.parse(it.pubDate);
    if (isNaN(t)) continue;
    const ageH = (now - t) / 3600e3;
    if (ageH > MAX_AGE_HOURS || ageH < -6) { tooOld++; continue; }
    if (seen.urls[it.url] || seen.fps[fingerprint(it.title)]) { dup++; continue; }
    if (!byUrl.has(it.url)) byUrl.set(it.url, { ...it, ageHours: Math.round(ageH) });
  }
  // 同题去重：保留最早发布
  const byFp = new Map();
  for (const it of byUrl.values()) {
    const fp = fingerprint(it.title);
    const prev = byFp.get(fp);
    if (!prev || Date.parse(it.pubDate) < Date.parse(prev.pubDate)) byFp.set(fp, it);
  }
  const items = [...byFp.values()].sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ collectedAt: new Date().toISOString(), items }, null, 2),
    "utf8"
  );
  console.log(
    `✅ 采集完成：48小时内且未收录 ${items.length} 条（过期 ${tooOld}、已收录 ${dup}）→ data/collected.json`
  );
})();
