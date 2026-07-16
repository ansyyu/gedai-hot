# 🔥 个贷HOT · 个人贷款热点日报

参考 [数字生命卡兹克 AIHOT](https://aihot.virxact.com/) 的"信源分级 + AI 评分 + 版块化日报"模式，面向个人贷款从业者的每日热点监控站点。

## 目录结构

```
个贷HOT/
├── sources.json        # ⭐ 信源配置（你主要维护这个文件）
├── archive/            # 每日结构化数据，YYYY-MM-DD.json，永久沉淀
├── daily/              # 每期归档网页（由 build.js 生成）
├── index.html          # 最新一期日报（由 build.js 生成）
├── archive.html        # 往期归档索引（由 build.js 生成）
├── style.css           # 站点样式
└── build.js            # 静态站点生成器
```

## 五大版块

| 版块 | id | 覆盖内容 |
|---|---|---|
| 政策监管 | policy | 监管总局/央行/财政部政策、新规 |
| 行业形势 | industry | 利率、不良率、行业格局与研究 |
| 银行同业动态 | bank | 各银行产品、投放、定价动态 |
| 互联网金融动态 | internet | 助贷、消金公司、互金平台 |
| 金融科技 | fintech | 大模型、智能风控、数字化 |

## 维护信源

编辑 `sources.json`：

- **加信源**：往 `sources` 数组加一条 `{ "name", "tier", "url", "note" }`。
  - `T1` = 官方一手（监管机构、央行）
  - `T1.5` = 行业协会 / 准官方
  - `T2` = 媒体 / 智库 / 机构研究
- **调关键词**：每个版块的 `keywords` 是每日搜索词，可自由增删。
- 改完无需其他操作，次日任务自动按新配置搜集。

## 每日自动更新

已注册计划任务 `gedai-hot-daily`（每天 08:10，Claude Code 打开时自动执行；当天错过则下次启动补跑）：

1. 按 `sources.json` 的版块关键词搜索近 24-48 小时资讯，白名单信源优先
2. 生成当日 `archive/YYYY-MM-DD.json`（与往期对比去重）
3. `node build.js` 重建全部页面
4. git 提交，若已配置 remote 则推送 GitHub Pages 上线

手动补跑：在 Claude Code 侧栏「Scheduled」里对该任务点 Run now，或直接说"生成今天的个贷HOT日报"。

## 回溯往期

- 网页端：右上角「📚 往期」→ 点任意日期
- 数据端：`archive/` 下的 JSON 按日期永久保留（git 版本管理），可供二次分析

## 本地预览 / 手动重建

```bash
node build.js   # 重新生成全部页面
```

生成后直接用浏览器打开 `index.html`。
