#!/usr/bin/env node
/**
 * 官方/媒体直采适配器集合。每个适配器返回 [{title,url,source,tier,pubDate,desc}]。
 * 失败的适配器自动跳过，不影响其他源。被 collect.js 引用。
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120";

async function get(url, asJson) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return asJson ? res.json() : res.text();
}

const strip = (s) =>
  String(s || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

/* ---------- T1 国家金融监督管理总局（官方 JSON API） ---------- */
// itemId: 915=政策法规(规范性文件), 861=新闻发布, 925=通知公告, 4113=行政处罚
async function nfra() {
  const items = [];
  for (const [itemId, kind] of [[915, "政策法规"], [861, "新闻"], [925, "通知"], [4113, "行政处罚"]]) {
    try {
      const j = await get(
        `https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild?itemId=${itemId}&pageSize=18&pageIndex=1`,
        true
      );
      for (const r of j?.data?.rows || []) {
        items.push({
          title: strip(r.docTitle || r.docSubtitle),
          url: `https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=${r.docId}&itemId=${itemId}`,
          source: `金融监管总局·${kind}`,
          tier: "T1",
          pubDate: new Date(r.publishDate.replace(" ", "T") + "+08:00").toISOString(),
          desc: strip(r.docSummary || ""),
        });
      }
    } catch (e) {
      console.error(`  ⚠ 监管总局 itemId=${itemId} 失败：${e.message}`);
    }
  }
  return items;
}

/* ---------- T1 中国人民银行（HTML 列表解析） ---------- */
// 沟通交流(新闻发布) + 货币政策司公告
async function pbc() {
  const items = [];
  const pages = [
    ["http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html", "央行·沟通交流"],
    ["http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125440/index.html", "央行·货币政策"],
  ];
  for (const [pageUrl, label] of pages) {
    try {
      const html = await get(pageUrl);
      // 形如 <a href="/goutongjiaoliu/113456/113469/5xxxx/index.html" ...>标题</a> ... 2026-07-16
      const re = /<a[^>]+href="(\/[^"]+\/index\.html)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>[\s\S]{0,200}?(\d{4}-\d{2}-\d{2})/g;
      let m;
      while ((m = re.exec(html))) {
        const title = strip(m[2] || m[3]);
        // 过滤导航/页脚误匹配：太短、含换行残留、非资讯词
        if (!title || title.length < 8 || /术语表|网站地图|更新日志|常见问题|-->/.test(title)) continue;
        items.push({
          title,
          url: "http://www.pbc.gov.cn" + m[1],
          source: label,
          tier: "T1",
          pubDate: new Date(m[4] + "T12:00:00+08:00").toISOString(),
          desc: "",
        });
      }
    } catch (e) {
      console.error(`  ⚠ ${label} 失败：${e.message}`);
    }
  }
  return items;
}

/* ---------- T1 国家统计局（最新发布 HTML） ---------- */
async function stats() {
  try {
    const html = await get("https://www.stats.gov.cn/sj/zxfb/");
    const items = [];
    const re = /<a[^>]+href="(\.\/(\d{6})\/t(\d{8})_\d+\.html)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html))) {
      const title = strip(m[4]);
      if (!title || title.length < 6) continue;
      const d = m[3]; // YYYYMMDD
      items.push({
        title,
        url: "https://www.stats.gov.cn/sj/zxfb/" + m[1].slice(2),
        source: "国家统计局",
        tier: "T1",
        pubDate: new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00+08:00`).toISOString(),
        desc: "",
      });
    }
    return items;
  } catch (e) {
    console.error(`  ⚠ 统计局 失败：${e.message}`);
    return [];
  }
}

/* ---------- T2 证券时报快讯 ---------- */
async function stcn() {
  try {
    const html = await get("https://www.stcn.com/article/list/kx.html");
    const items = [];
    const re = /<a[^>]+href="(\/article\/detail\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,300}?(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/g;
    let m;
    while ((m = re.exec(html))) {
      const title = strip(m[2]);
      if (!title || title.length < 8) continue;
      items.push({
        title,
        url: "https://www.stcn.com" + m[1],
        source: "证券时报",
        tier: "T2",
        pubDate: new Date(m[3].replace(" ", "T") + ":00+08:00").toISOString(),
        desc: "",
      });
    }
    return items;
  } catch (e) {
    console.error(`  ⚠ 证券时报 失败：${e.message}`);
    return [];
  }
}

/* ---------- T1.5 新华财经·货币/银行栏目 ---------- */
async function cnfin() {
  const items = [];
  for (const [path, label] of [["hb-lb", "新华财经·货币"], ["yh-lb", "新华财经·银行"]]) {
    try {
      const html = await get(`https://www.cnfin.com/${path}/index.html`);
      const re = /<a[^>]+href="(https?:\/\/www\.cnfin\.com\/[a-z-]+\/detail\/(\d{8})\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html))) {
        const title = strip(m[3]);
        if (!title || title.length < 8) continue;
        const d = m[2];
        items.push({
          title,
          url: m[1],
          source: label,
          tier: "T1.5",
          pubDate: new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00+08:00`).toISOString(),
          desc: "",
        });
      }
    } catch (e) {
      console.error(`  ⚠ ${label} 失败：${e.message}`);
    }
  }
  return items;
}

/* ---------- T2 东方财富全网搜索（关键词搜索，按时间排序，覆盖各财经媒体） ---------- */
// 使用 sources.json 各版块的 searchKeywords；返回条目的 source 为原始媒体名，
// tier 留空由 AI 编辑按信源白名单判级。用于补充官方直采与新浪流之外的覆盖面（尤其周末）。
async function emSearch() {
  const fs = require("fs");
  const path = require("path");
  const sources = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "sources.json"), "utf8")
  );
  const items = [];
  for (const cat of sources.categories) {
    for (const kw of cat.searchKeywords || []) {
      try {
        const param = encodeURIComponent(
          JSON.stringify({
            uid: "", keyword: kw, type: ["cmsArticleWebOld"],
            client: "web", clientVersion: "curr", clientType: "web",
            param: { cmsArticleWebOld: { searchScope: "default", sort: "time", pageIndex: 1, pageSize: 12 } },
          })
        );
        const txt = await get(`https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${param}`);
        const j = JSON.parse(txt.replace(/^cb\(/, "").replace(/\)$/, ""));
        for (const a of j?.result?.cmsArticleWebOld || []) {
          if (!a.title || !a.url) continue;
          items.push({
            title: strip(a.title),
            url: a.url,
            source: strip(a.mediaName) || "东方财富",
            pubDate: new Date(a.date.replace(" ", "T") + "+08:00").toISOString(),
            desc: strip(a.content || "").slice(0, 120),
            categoryHint: cat.id,
          });
        }
      } catch (e) {
        console.error(`  ⚠ 东财搜索「${kw}」失败：${e.message}`);
      }
    }
  }
  return items;
}

/* 证券时报、新华财经列表页为 JS 动态渲染，静态抓取不可用；
   其稿件经新浪财经滚动流与东财搜索转载覆盖，不单独直采。 */

module.exports = { adapters: [nfra, pbc, stats, emSearch] };
