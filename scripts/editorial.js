#!/usr/bin/env node
/**
 * AI 编辑：读取 data/collected.json，调用 GitHub Models（免费，用 GITHUB_TOKEN）
 * 完成筛选/归类/评分/摘要/推荐理由，输出 archive/<今日>.json（北京时间），并更新 data/seen.json。
 * 防编造设计：模型只能通过序号引用采集到的条目，URL/日期由脚本回填，模型无法虚构链接。
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

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8"));
const collected = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "collected.json"), "utf8"));

// 北京时间的今天
const bj = new Date(Date.now() + 8 * 3600e3);
const today = bj.toISOString().slice(0, 10);
const weekday = "星期" + "日一二三四五六"[bj.getUTCDay()];

const items = collected.items.slice(0, 90); // 控制输入规模
const DRY = process.env.DRY_RUN === "1";
if (items.length < 2) {
  console.log(`当日新资讯不足（${items.length} 条），不出刊，保持前一期。`);
  process.exit(0);
}
if (!DRY && fs.existsSync(path.join(ARCHIVE_DIR, `${today}.json`))) {
  console.log(`archive/${today}.json 已存在，跳过（今日已出刊）。`);
  process.exit(0);
}

// 最近两期标题，用于事件级去重
const prevTitles = fs
  .readdirSync(ARCHIVE_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .slice(-2)
  .flatMap((f) =>
    JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), "utf8")).items.map((i) => i.title)
  );

const catDesc = sources.categories.map((c) => `- ${c.id}（${c.name}）：${c.desc}`).join("\n");
const whitelist = sources.sources.map((s) => `${s.name}=${s.tier}`).join("；");
const list = items
  .map(
    (it, i) =>
      `[${i}] ${it.title} ｜来源:${it.source} ｜${it.pubDate.slice(0, 10)}(${it.ageHours}h前) ｜${(it.desc || "").slice(0, 80)}`
  )
  .join("\n");

const prompt = `你是"个贷HOT"日报（面向中国个人贷款从业者）的主编。今天是 ${today}（${weekday}）。
下面是过去48小时采集到的候选资讯（带序号）。请从中精选编成今日日报。

## 版块定义（每条只归入最贴切的一个）
${catDesc}
消歧规则：消费贷不良/逾期→risk；房贷利率→mortgage；全局政策与信贷总量→macro。

## 信源分级白名单（来源匹配则用对应级别，匹配不到用 T2）
${whitelist}

## 已收录过的事件（除非有明确新进展否则不要再选同一事件）
${prevTitles.map((t) => "- " + t).join("\n")}

## 候选资讯
${list}

## 要求
1. 精选 8-16 条，尽量覆盖多个版块；宁缺毋滥，与个人贷款无关的（企业债、股市、国际新闻等）一律不选。
2. 同一事件多条报道只选一条最权威的。
3. summary 只能基于候选条目给出的标题和摘要改写（120字内，关键数字用<b></b>包裹）；信息不足就写短些，严禁编造具体数字、机构名或政策细节。
4. reason 是一句话，站在个贷从业者视角说"为什么值得看"。
5. score 为 7.0-10.0 的一位小数（时效/权威/业务相关/影响面/可操作五维综合）。
6. focus 从入选条目中选最重要的一条（给出其 idx），并写一段80-150字的头条导语（同样不得超出素材信息）。
7. stats 给 4 个数字指标，必须直接取自入选条目摘要中出现过的数字；不足4个就少给。

## 输出
只输出一个 JSON 对象，不要任何其他文字，结构：
{"focus":{"idx":数字,"summary":"头条导语"},
 "stats":[{"num":"数字","unit":"单位","label":"指标名"}],
 "items":[{"idx":数字,"category":"六版块id之一","tier":"T1|T1.5|T2","score":数字,"title":"可微调的标题","summary":"...","reason":"..."}]}`;

async function callModel(model, messages) {
  const res = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(120000),
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 6000 }),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJson(text) {
  const cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/```[\s\S]*$/, "").trim();
  const raw = cleaned.startsWith("{") ? cleaned : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

(async () => {
  if (!process.env.GITHUB_TOKEN) {
    console.error("缺少 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }
  let out = null, lastErr = null;
  for (const model of MODELS) {
    try {
      console.log(`调用模型 ${model} ...`);
      out = parseJson(await callModel(model, [{ role: "user", content: prompt }]));
      if (!Array.isArray(out.items) || !out.items.length) throw new Error("items 为空");
      console.log(`✓ ${model} 返回 ${out.items.length} 条`);
      break;
    } catch (e) {
      lastErr = e;
      console.error(`✗ ${e.message}`);
      out = null;
    }
  }
  if (!out) { console.error("全部模型失败：" + lastErr); process.exit(1); }

  // 组装：URL/日期从采集数据回填，杜绝虚构链接
  const valid = out.items.filter(
    (s) => items[s.idx] && CATS.includes(s.category) && s.title && s.summary
  );
  const report = {
    date: today,
    weekday,
    focus: {
      title: (valid.find((s) => s.idx === out.focus?.idx) || valid[0]).title,
      summary: out.focus?.summary || valid[0].summary,
    },
    stats: (out.stats || []).slice(0, 4).map((s) => ({
      num: String(s.num), unit: String(s.unit || ""), label: String(s.label),
    })),
    items: valid.map((s) => {
      const src = items[s.idx];
      return {
        category: s.category,
        tier: ["T1", "T1.5", "T2"].includes(s.tier) ? s.tier : "T2",
        source: src.source,
        score: Math.min(10, Math.max(7, Number(s.score) || 7.5)),
        title: String(s.title).slice(0, 60),
        url: src.url,
        summary: String(s.summary).slice(0, 400),
        reason: String(s.reason || "").slice(0, 120),
        dateNote: src.pubDate.slice(0, 10),
        links: [],
      };
    }),
  };
  if (report.items.length < 2) { console.error("有效条目不足2条，不出刊"); process.exit(0); }

  if (DRY) {
    console.log("🧪 试运行（不写入文件），生成结果预览：");
    console.log("头条：" + report.focus.title);
    report.items.forEach((i) => console.log(` [${i.category}] ★${i.score} ${i.title}`));
    process.exit(0);
  }

  fs.writeFileSync(path.join(ARCHIVE_DIR, `${today}.json`), JSON.stringify(report, null, 2), "utf8");

  // 更新已见清单：全部候选（不只入选的）记为已见，防止明天旧闻回流
  const seen = fs.existsSync(SEEN_FILE)
    ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))
    : { urls: {}, fps: {} };
  const fp = (t) => String(t).replace(/[^一-龥A-Za-z0-9]/g, "").slice(0, 24);
  for (const it of collected.items) { seen.urls[it.url] = today; seen.fps[fp(it.title)] = today; }
  const cutoff = new Date(Date.now() - SEEN_KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(seen.urls)) if (seen.urls[k] < cutoff) delete seen.urls[k];
  for (const k of Object.keys(seen.fps)) if (seen.fps[k] < cutoff) delete seen.fps[k];
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen), "utf8");

  console.log(`✅ 已生成 archive/${today}.json（${report.items.length} 条），seen 清单已更新`);
})();
