#!/usr/bin/env node
/**
 * AI 编辑（两段式）：
 *  第一段：从候选中选题（版块归类/评分/去重/多样性）
 *  第二段：抓取入选文章正文全文，基于全文撰写深度摘要、推荐理由、头条导语与数据看板
 * 输出 archive/<今日>.json（北京时间），并把【入选】条目记入 data/seen.json（落选的不拉黑，
 * 仍可参加后续几天的评选，直到超出采集时间窗）。
 * 防编造设计：模型只能通过序号引用采集条目，URL/日期由脚本回填；摘要只能基于抓取到的正文。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const ARCHIVE_DIR = path.join(ROOT, "archive");
const SEEN_FILE = path.join(DATA_DIR, "seen.json");
const SEEN_KEEP_DAYS = 30;

const MODELS = ["deepseek/DeepSeek-V3-0324", "openai/gpt-4o", "openai/gpt-4o-mini"];
const CATS = ["macro", "mortgage", "sme", "consumer", "risk", "tech"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120";

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8"));
const collected = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "collected.json"), "utf8"));

const bj = new Date(Date.now() + 8 * 3600e3);
const today = bj.toISOString().slice(0, 10);
const weekday = "星期" + "日一二三四五六"[bj.getUTCDay()];
const DRY = process.env.DRY_RUN === "1";

const items = collected.items.slice(0, 120);
if (items.length < 1) {
  console.log("当日无新资讯，不出刊，保持前一期。");
  process.exit(0);
}
if (!DRY && fs.existsSync(path.join(ARCHIVE_DIR, `${today}.json`))) {
  console.log(`archive/${today}.json 已存在，跳过（今日已出刊）。`);
  process.exit(0);
}

const prevTitles = fs
  .readdirSync(ARCHIVE_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .slice(-3)
  .flatMap((f) =>
    JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), "utf8")).items.map((i) => i.title)
  );

/* ---------- 模型调用 ---------- */
async function callModel(model, prompt) {
  const res = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(150000),
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 7000,
    }),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).choices[0].message.content;
}
function parseJson(text) {
  const cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/```[\s\S]*$/, "").trim();
  const raw = cleaned.startsWith("{") ? cleaned : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}
async function askModels(prompt, validate) {
  let lastErr = null;
  for (const model of MODELS) {
    try {
      console.log(`调用模型 ${model} ...`);
      const out = parseJson(await callModel(model, prompt));
      validate(out);
      console.log(`✓ ${model} 返回有效`);
      return out;
    } catch (e) {
      lastErr = e;
      console.error(`✗ ${e.message.slice(0, 160)}`);
    }
  }
  throw lastErr;
}

/* ---------- 正文抓取 ---------- */
const strip = (s) =>
  String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/\s+/g, " ").trim();
async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const html = (await res.text())
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => strip(m[1]))
      .filter((t) => t.length > 25 && !/APP|下载|扫码|版权|免责|点击进入|相关阅读/.test(t));
    return ps.join("\n").slice(0, 1500);
  } catch (e) {
    return "";
  }
}

(async () => {
  if (!process.env.GITHUB_TOKEN) { console.error("缺少 GITHUB_TOKEN"); process.exit(1); }

  /* ===== 第一段：选题 ===== */
  const catDesc = sources.categories.map((c) => `- ${c.id}（${c.name}）：${c.desc}`).join("\n");
  const whitelist = sources.sources.map((s) => `${s.name}=${s.tier}`).join("；");
  const list = items
    .map(
      (it, i) =>
        `[${i}] ${it.title} ｜来源:${it.source}${it.tier ? `(${it.tier})` : ""} ｜${it.pubDate.slice(0, 10)} ｜${(it.desc || "").slice(0, 100)}`
    )
    .join("\n");

  const p1 = `你是"个贷HOT"日报（面向中国个人贷款从业者）的主编。今天是 ${today}（${weekday}）。请从候选资讯中选题。

## 版块定义（每条只归入最贴切的一个）
${catDesc}
消歧规则：消费贷不良/逾期→risk；房贷利率→mortgage；全局政策与信贷总量→macro。

## 信源分级白名单（来源匹配则用对应级别，匹配不到用 T2）
${whitelist}

## 前几期已收录的事件（除非有明确新进展否则不要再选同一事件）
${prevTitles.map((t) => "- " + t).join("\n")}

## 候选资讯
${list}

## 选题要求
1. 目标 10-16 条；候选充足时不得少于 10 条，尽量覆盖六个版块；确实与个人贷款无关的（企业债、股市行情、国际新闻等）不选。
2. 同一事件多条报道只选一条最权威的（官方>准官方>媒体）。
3. risk 版块子题多样性：逾期/资产质量、欺诈骗贷、催收乱象、借款人权益、合规处罚都算——"罚单/处罚"类每期最多 2 条，其他风险子题优先保留。
4. 发布日期较新的优先；同分时选信息量大的。
5. score 为 7.0-10.0 一位小数（时效/权威/业务相关/影响面/可操作五维综合）。
6. focusIdx 是全场最重要一条的序号。

## 输出
只输出 JSON：{"focusIdx":数字,"items":[{"idx":数字,"category":"六版块id之一","tier":"T1|T1.5|T2","score":数字}]}`;

  const sel = await askModels(p1, (o) => {
    if (!Array.isArray(o.items) || !o.items.length) throw new Error("items 为空");
  });
  const picked = sel.items
    .filter((s) => items[s.idx] && CATS.includes(s.category))
    .slice(0, 16);
  if (!picked.length) { console.error("无有效入选条目，不出刊"); process.exit(0); }
  console.log(`选题完成：${picked.length} 条，抓取正文中...`);

  /* ===== 抓取入选文章正文 ===== */
  for (const s of picked) {
    s.text = await fetchArticleText(items[s.idx].url);
    console.log(`  [${s.idx}] 正文 ${s.text.length} 字 ${items[s.idx].title.slice(0, 24)}`);
  }

  /* ===== 第二段：基于正文写深度内容 ===== */
  const focusIdx = picked.some((s) => s.idx === sel.focusIdx) ? sel.focusIdx : picked[0].idx;
  const articles = picked
    .map((s) => {
      const it = items[s.idx];
      return `【${s.idx}】标题：${it.title}\n来源：${it.source} ｜发布：${it.pubDate.slice(0, 10)}\n正文摘录：${s.text || "（正文抓取失败，仅有摘要：" + (it.desc || "无") + "）"}`;
    })
    .join("\n\n");

  const p2 = `你是"个贷HOT"日报主编。以下是今日入选的 ${picked.length} 篇文章的正文摘录。请为每篇撰写终稿，并写头条导语和数据看板。今天是 ${today}。头条文章序号：${focusIdx}。

${articles}

## 撰写要求
1. 每篇：title（在原标题基础上可优化，突出关键数字/结论，≤40字）、summary（120-160字，必须基于正文，把正文中最有价值的数字和结论写进去，关键数字用<b></b>包裹）、reason（一句话，站在个贷从业者视角说为什么值得看/怎么用）。
2. focusSummary：基于头条文章正文写 100-160 字导语。
3. stats：4 个数字指标（num/unit/label），必须取自各篇正文中真实出现的数字，优先规模/利率/增速类。
4. 铁律：所有数字、机构名、政策细节必须来自上面提供的正文，严禁引入外部信息或编造；某篇正文抓取失败的，摘要从简，不得虚构细节。

## 输出
只输出 JSON：{"focusSummary":"...","stats":[{"num":"..","unit":"..","label":".."}],"items":[{"idx":数字,"title":"..","summary":"..","reason":".."}]}`;

  const fin = await askModels(p2, (o) => {
    if (!Array.isArray(o.items) || !o.items.length) throw new Error("items 为空");
  });
  const finById = Object.fromEntries(fin.items.map((f) => [f.idx, f]));

  /* ===== 组装（URL/日期回填，杜绝虚构链接） ===== */
  const report = {
    date: today,
    weekday,
    focus: { title: "", summary: String(fin.focusSummary || "").slice(0, 400) },
    stats: (fin.stats || []).slice(0, 4).map((s) => ({
      num: String(s.num), unit: String(s.unit || ""), label: String(s.label),
    })),
    items: picked.map((s) => {
      const src = items[s.idx];
      const f = finById[s.idx] || {};
      return {
        category: s.category,
        tier: src.tier || (["T1", "T1.5", "T2"].includes(s.tier) ? s.tier : "T2"),
        source: src.source,
        score: Math.min(10, Math.max(7, Number(s.score) || 7.5)),
        title: String(f.title || src.title).slice(0, 60),
        url: src.url,
        summary: String(f.summary || src.desc || src.title).slice(0, 400),
        reason: String(f.reason || "").slice(0, 120),
        dateNote: src.pubDate.slice(0, 10),
        links: [],
      };
    }),
  };
  report.focus.title = (report.items.find((i) => i.url === items[focusIdx].url) || report.items[0]).title;

  if (DRY) {
    console.log("🧪 试运行（不写入），结果预览：");
    console.log("头条：" + report.focus.title);
    report.items.forEach((i) => console.log(` [${i.category}] ★${i.score} ${i.title} ｜摘要${i.summary.length}字`));
    process.exit(0);
  }

  fs.writeFileSync(path.join(ARCHIVE_DIR, `${today}.json`), JSON.stringify(report, null, 2), "utf8");

  // 已收录清单：只记入选条目（落选的保留参选资格，由采集时间窗自然淘汰）
  const seen = fs.existsSync(SEEN_FILE)
    ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))
    : { urls: {}, fps: {} };
  const fp = (t) => String(t).replace(/[^一-龥A-Za-z0-9]/g, "").slice(0, 24);
  for (const s of picked) {
    const it = items[s.idx];
    seen.urls[it.url] = today;
    seen.fps[fp(it.title)] = today;
  }
  const cutoff = new Date(Date.now() - SEEN_KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(seen.urls)) if (seen.urls[k] < cutoff) delete seen.urls[k];
  for (const k of Object.keys(seen.fps)) if (seen.fps[k] < cutoff) delete seen.fps[k];
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen), "utf8");

  console.log(`✅ 已生成 archive/${today}.json（${report.items.length} 条，两段式深度摘要），seen 清单已更新`);
})();
