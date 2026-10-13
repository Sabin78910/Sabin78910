// Builds the two profile stats cards (languages + contribution streak) as SVG in assets/.
// Runs daily in GitHub Actions with the repo's own token: no third-party stats server to go down.
// `node scripts/stats.mjs --test` runs the self-checks.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const LOGIN = 'Sabin78910';
// Languages are counted only across the projects featured on the profile, not every repo on the account.
const FEATURED = ['GrocerEase', 'concrete-strength-analysis', 'laravel-product-management', 'android-compose-projects'];
const ALIAS = { Hack: 'PHP' }; // GitHub's language detector labels some .php files as Hack
const COLORS = { PHP: '#4F5D95', Kotlin: '#A97BFF', R: '#198CE7', JavaScript: '#F1E05A', HTML: '#E34C26', CSS: '#663399', SCSS: '#C6538C', Blade: '#F7523F', Python: '#3572A5', TypeScript: '#3178C6' };
const T = { bg: '#0D1324', bg2: '#070B16', text: '#E8ECF4', muted: '#9AA4B8', line: 'rgba(255,255,255,0.09)', g1: '#A5B4FC', g2: '#818CF8', g3: '#22D3EE' };
const FONT = "font-family=\"-apple-system, 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif\"";

// ── Pure logic (tested) ────────────────────────────────────────────────────
/** Square-root weighting per repo, so one large vendored library can't drown out the rest. */
export function languageShares(perRepo) {
  const score = {};
  for (const langs of perRepo) {
    const merged = {}; // merge aliases inside the repo first, then weight
    for (const [lang, bytes] of Object.entries(langs)) merged[ALIAS[lang] ?? lang] = (merged[ALIAS[lang] ?? lang] ?? 0) + bytes;
    for (const [name, bytes] of Object.entries(merged)) score[name] = (score[name] ?? 0) + Math.sqrt(bytes);
  }
  const total = Object.values(score).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(score).map(([name, s]) => ({ name, pct: (100 * s) / total })).sort((a, b) => b.pct - a.pct);
}

/** days: [{date:'YYYY-MM-DD', count}] ascending. A zero today doesn't break the current streak yet. */
export function streaks(days, today) {
  let longest = { len: 0 }, run = { len: 0 };
  for (const d of days) {
    run = d.count > 0 ? (run.len ? { ...run, len: run.len + 1, end: d.date } : { len: 1, start: d.date, end: d.date }) : { len: 0 };
    if (run.len > longest.len) longest = { ...run };
  }
  let i = days.length - 1;
  if (i >= 0 && days[i].date === today && days[i].count === 0) i--;
  let current = { len: 0 };
  for (; i >= 0 && days[i].count > 0; i--) current = { len: current.len + 1, start: days[i].date, end: current.end ?? days[i].date };
  return { total: days.reduce((s, d) => s + d.count, 0), current, longest };
}

// ── Data ───────────────────────────────────────────────────────────────────
const token = process.env.GITHUB_TOKEN;
const headers = { 'User-Agent': LOGIN, Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
async function rest(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
async function contributionDays() {
  const query = `query($login:String!,$from:DateTime,$to:DateTime){user(login:$login){createdAt contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const gql = async (variables) => {
    const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (!r.ok || j.errors) throw new Error(`GraphQL: ${r.status} ${JSON.stringify(j.errors ?? j)}`);
    return j.data.user;
  };
  const { createdAt } = await gql({ login: LOGIN });
  const now = new Date(), days = new Map();
  for (let y = new Date(createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1)), to = y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    const u = await gql({ login: LOGIN, from: from.toISOString(), to: to.toISOString() });
    for (const w of u.contributionsCollection.contributionCalendar.weeks) for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
  }
  const today = now.toISOString().slice(0, 10);
  return { createdAt, today, days: [...days].map(([date, count]) => ({ date, count })).filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

// ── Rendering ──────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (iso, withYear = true) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const range = (r, today) => (r.len ? `${fmt(r.start, false)} – ${r.end === today ? 'Today' : fmt(r.end, false)}` : '—');
const frame = (w, h, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" ${FONT}>
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bg}"/><stop offset="1" stop-color="${T.bg2}"/></linearGradient>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.g1}"/><stop offset=".5" stop-color="${T.g2}"/><stop offset="1" stop-color="${T.g3}"/></linearGradient>
<radialGradient id="glow" cx="0" cy="0" r="0.9"><stop offset="0" stop-color="#6366F1" stop-opacity=".22"/><stop offset="1" stop-color="#6366F1" stop-opacity="0"/></radialGradient></defs>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#bg)" stroke="${T.line}"/><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#glow)"/>
${body}</svg>`;

export function languagesSvg(shares) {
  const top = shares.slice(0, 8), W = 495, H = 200, bx = 25, bw = W - 50;
  let x = bx;
  const bar = top.map((l) => { const w = (bw * l.pct) / top.reduce((s, t) => s + t.pct, 0); const r = `<rect x="${x.toFixed(2)}" y="66" width="${Math.max(w - 2, 1).toFixed(2)}" height="10" fill="${COLORS[l.name] ?? T.muted}"/>`; x += w; return r; }).join('');
  const legend = top.map((l, i) => { const cx = bx + (i % 2) * 225, cy = 106 + Math.floor(i / 2) * 22;
    return `<circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${COLORS[l.name] ?? T.muted}"/><text x="${cx + 18}" y="${cy}" font-size="13" fill="${T.text}">${esc(l.name)} <tspan fill="${T.muted}">${l.pct.toFixed(1)}%</tspan></text>`; }).join('');
  return frame(W, H, `Languages across featured projects: ${top.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(', ')}`,
    `<text x="25" y="36" font-size="17" font-weight="600" fill="${T.text}">Languages</text><text x="${W - 25}" y="36" text-anchor="end" font-size="12" fill="${T.muted}">across featured projects</text>
<clipPath id="bar"><rect x="${bx}" y="66" width="${bw}" height="10" rx="5"/></clipPath><g clip-path="url(#bar)">${bar}</g>${legend}`);
}

export function streakSvg({ total, current, longest }, since, today) {
  const W = 495, H = 200, col = [85, 247, 410];
  const stat = (x, value, label, sub, accent) => `<text x="${x}" y="98" text-anchor="middle" font-size="30" font-weight="700" fill="${accent ? 'url(#g)' : T.text}">${value}</text>
<text x="${x}" y="134" text-anchor="middle" font-size="13" font-weight="600" fill="${T.text}">${label}</text><text x="${x}" y="156" text-anchor="middle" font-size="11.5" fill="${T.muted}">${esc(sub)}</text>`;
  return frame(W, H, `${total} total contributions, current streak ${current.len} days, longest streak ${longest.len} days`,
    `<line x1="166" y1="38" x2="166" y2="162" stroke="${T.line}"/><line x1="329" y1="38" x2="329" y2="162" stroke="${T.line}"/>
<circle cx="${col[1]}" cy="76" r="32" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5"/><circle cx="${col[1]}" cy="76" r="32" fill="none" stroke="url(#g)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 32 * Math.min(1, current.len / Math.max(longest.len, 1))).toFixed(1)} 999" transform="rotate(-90 ${col[1]} 76)"/>
${stat(col[0], total.toLocaleString('en-US'), 'Total contributions', `${fmt(since)} – Present`)}
<text x="${col[1]}" y="86" text-anchor="middle" font-size="26" font-weight="700" fill="url(#g)">${current.len}</text>
<text x="${col[1]}" y="134" text-anchor="middle" font-size="13" font-weight="600" fill="${T.text}">Current streak</text><text x="${col[1]}" y="156" text-anchor="middle" font-size="11.5" fill="${T.muted}">${esc(range(current, today))}</text>
${stat(col[2], longest.len, 'Longest streak', range(longest, today), true)}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
if (process.argv.includes('--test')) {
  const d = (date, count) => ({ date, count });
  const s = streaks([d('2026-01-01', 1), d('2026-01-02', 2), d('2026-01-03', 0), d('2026-01-04', 1), d('2026-01-05', 3), d('2026-01-06', 0)], '2026-01-06');
  assert.deepEqual([s.total, s.current.len, s.current.start, s.longest.len, s.longest.start], [7, 2, '2026-01-04', 2, '2026-01-01']);
  assert.equal(streaks([d('2026-01-01', 1), d('2026-01-02', 0), d('2026-01-03', 0)], '2026-01-03').current.len, 0);
  const sh = languageShares([{ PHP: 100, Hack: 21 }, { R: 100 }]);
  assert.deepEqual(sh.map((l) => l.name), ['PHP', 'R']);
  assert.ok(Math.abs(sh[0].pct - 52.4) < 0.1);
  console.log('stats self-test passed');
} else {
  const perRepo = await Promise.all(FEATURED.map((r) => rest(`/repos/${LOGIN}/${r}/languages`)));
  writeFileSync('assets/stats-languages.svg', languagesSvg(languageShares(perRepo)));
  if (token) {
    const { createdAt, today, days } = await contributionDays();
    writeFileSync('assets/stats-streak.svg', streakSvg(streaks(days, today), createdAt.slice(0, 10), today));
  } else console.log('No GITHUB_TOKEN: streak card skipped (it needs the GraphQL API).');
  console.log('stats cards written');
}
