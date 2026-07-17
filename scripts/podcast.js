#!/usr/bin/env node
/**
 * AI 播客生成：把最新一期 archive JSON 组装成口播稿，调用 edge-tts 合成 audio/<date>.mp3。
 * 需要环境里有 edge-tts CLI（pip install edge-tts）。SKIP_TTS=1 时只生成口播稿不合成音频（本地调试用）。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ARCHIVE_DIR = path.join(ROOT, "archive");
const AUDIO_DIR = path.join(ROOT, "audio");
const DATA_DIR = path.join(ROOT, "data");

const VOICE = "zh-CN-XiaoxiaoNeural";
const RATE = "+8%";

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8"));
const catName = Object.fromEntries(sources.categories.map((c) => [c.id, c.name]));

const files = fs
  .readdirSync(ARCHIVE_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort();
if (!files.length) { console.log("无日报数据，跳过播客生成"); process.exit(0); }

const report = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, files[files.length - 1]), "utf8"));
const outFile = path.join(AUDIO_DIR, `${report.date}.mp3`);
if (fs.existsSync(outFile)) { console.log(`audio/${report.date}.mp3 已存在，跳过`); process.exit(0); }

const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const [y, m, d] = report.date.split("-");
const dateCn = `${Number(m)}月${Number(d)}日`;

// ---- 组装口播稿 ----
const parts = [];
parts.push(`欢迎收听个贷HOT日报，今天是${dateCn}，${report.weekday}。`);
parts.push(`今日头条：${strip(report.focus.title)}。${strip(report.focus.summary)}`);
for (const c of sources.categories) {
  const items = report.items.filter((i) => i.category === c.id);
  if (!items.length) continue;
  parts.push(`接下来是${c.name}版块，共${items.length}条。`);
  items.forEach((it, i) => {
    parts.push(`第${i + 1}条，${strip(it.title)}。${strip(it.summary)}`);
  });
}
parts.push("以上就是今天的个贷HOT日报，感谢收听，我们明天见。");
const script = parts.join("\n");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const scriptFile = path.join(DATA_DIR, "podcast.txt");
fs.writeFileSync(scriptFile, script, "utf8");
console.log(`口播稿 ${script.length} 字 → data/podcast.txt`);

if (process.env.SKIP_TTS === "1") { console.log("SKIP_TTS=1，不合成音频"); process.exit(0); }

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
execSync(
  `edge-tts --voice ${VOICE} --rate=${RATE} --file "${scriptFile}" --write-media "${outFile}"`,
  { stdio: "inherit", timeout: 300000 }
);
const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`✅ 播客已生成：audio/${report.date}.mp3（${kb} KB）`);
