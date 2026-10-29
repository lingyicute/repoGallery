/* 工具：更新 index.html 中内嵌的 GitHub 快照数据及快照日期标注
 *
 * 用法:
 *   node update-snapshot.mjs     
 *   node update-snapshot.mjs 2026-11-01   # 手动指定快照日期
 *   SNAP_TZ=America/Los_Angeles node update-snapshot.mjs   # 指定其它时区
 */
import { readFileSync, writeFileSync } from 'node:fs';

const WHO = 'lingyicute';
const GH = 'https://api.github.com';
const FILE = new URL('./repoGallery/index.html', import.meta.url).pathname;

/* ---------- 1. 计算快照日期(自动) ---------- */
const TIMEZONE = process.env.SNAP_TZ || 'Asia/Shanghai'; 
const argDate = process.argv[2];
if (argDate && !/^\d{4}-\d{2}-\d{2}$/.test(argDate)) {
  console.error(`❌ 日期格式应为 YYYY-MM-DD，收到: ${argDate}`);
  process.exit(1);
}
// 按指定时区把 "现在" 格式化为 YYYY-MM-DD,避免 UTC 换日差一天
function todayIn(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const TODAY = argDate || todayIn(TIMEZONE);
const TODAY_SHORT = TODAY.slice(5); // MM-DD

/* ---------- 2. 拉取实时数据 ---------- */
async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'snapshot-updater' } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}
const user = await fetchJSON(`${GH}/users/${WHO}`);
const repos = [];
for (let p = 1; ; p++) {
  const chunk = await fetchJSON(`${GH}/users/${WHO}/repos?per_page=100&sort=full_name&page=${p}`);
  repos.push(...chunk);
  if (chunk.length < 100) break;
}
console.log(`fetched ${repos.length} repos, user public_repos=${user.public_repos}`);

/* ---------- 3. 生成与文件内一致的快照结构 ---------- */
const USER = {
  login: user.login,
  avatar_url: user.avatar_url,
  html_url: user.html_url,
  followers: user.followers,
  following: user.following,
  public_repos: user.public_repos,
  created_at: user.created_at,
};
const SNAP = repos
  .map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    pushed_at: r.pushed_at,
    created_at: r.created_at,
    stars: r.stargazers_count,
    forks: r.forks_count,
    fork: r.fork,
    archived: r.archived,
    language: r.language,
    topics: Array.isArray(r.topics) ? r.topics : [],
    homepage: r.homepage ?? null,
    license: r.license ? r.license.spdx_id : null,
  }))
  .sort((a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || '')); // 按 pushed_at 倒序

const block =
  `/* ${TODAY} 更新 */\n` +
  `const USER = ${JSON.stringify(USER, null, 2)};\n` +
  `const SNAP = ${JSON.stringify(SNAP, null, 2)};`;

/* ---------- 4. 替换快照区块(旧日期从文件中自动识别,仅用于日志展示) ---------- */
let html = readFileSync(FILE, 'utf8');
const oldDate = html.match(/\/\* (\d{4}-\d{2}-\d{2}) 更新 \*\//)?.[1];
if (oldDate && oldDate !== TODAY) console.log(`快照日期:${oldDate} → ${TODAY}`);
else if (oldDate === TODAY) console.log(`快照日期不变(${TODAY}),仅刷新数据`);

const re = /\/\* \d{4}-\d{2}-\d{2} 更新 \*\/\nconst USER = \{[\s\S]*?\n\};\nconst SNAP = \[[\s\S]*?\n\];/;
if (!re.test(html)) throw new Error('未找到快照区块,中止');
html = html.replace(re, block);

/* ---------- 5. 用正则更新 UI 日期标注(按“短语+日期”锚定,不会误伤仓库时间戳) ---------- */
const labels = [
  [/快照 \d{2}-\d{2}/g, `快照 ${TODAY_SHORT}`],          // 数据源徽标
  [/\d{4}-\d{2}-\d{2} 快照/g, `${TODAY} 快照`],           // 镜像提示文案
  [/离线快照[:：]\d{4}-\d{2}-\d{2}/g, `离线快照：${TODAY}`], // 离线提示(兼容半/全角冒号)
];
for (const [pat, repl] of labels) {
  const n = (html.match(pat) || []).length;
  if (n !== 1) console.warn(`⚠️ 标注 ${pat} 出现 ${n} 次(预期 1 次)，请人工确认`);
  html = html.replace(pat, repl);
}

writeFileSync(FILE, html);
console.log(`done: SNAP=${SNAP.length} repos, date=${TODAY} (${TIMEZONE})`);
