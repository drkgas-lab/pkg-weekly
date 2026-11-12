import { readFile, writeFile } from 'node:fs/promises';

let dataPath = 'livart-daily/data/briefs.json';
const apiKey = process.env.OPENAI_API_KEY;
const holidayKey = process.env.KOREA_HOLIDAY_SERVICE_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
if (!apiKey) throw new Error('OPENAI_API_KEY secret is required.');
if (!holidayKey) throw new Error('KOREA_HOLIDAY_SERVICE_KEY secret is required; holiday check fails closed.');

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const today = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
const todayIso = `${today.year}-${today.month}-${today.day}`;
const weekday = new Date(`${todayIso}T12:00:00+09:00`).getUTCDay();
if (weekday === 0 || weekday === 6) {
  console.log(`${todayIso} KST is a weekend; no publication.`);
  process.exit(0);
}

async function officialHoliday(year, month, day) {
  const endpoint = new URL('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo');
  endpoint.searchParams.set('ServiceKey', holidayKey);
  endpoint.searchParams.set('solYear', String(year));
  endpoint.searchParams.set('solMonth', String(month).padStart(2, '0'));
  endpoint.searchParams.set('_type', 'json');
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Official holiday calendar returned HTTP ${response.status}.`);
  const json = await response.json();
  const body = json?.response?.body;
  if (json?.response?.header?.resultCode !== '00' || !body) throw new Error('Official holiday calendar could not be verified. Publication skipped.');
  const raw = body.items?.item;
  const items = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return items.some(item => item.isHoliday === 'Y' && String(item.locdate) === `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`);
}

if (await officialHoliday(Number(today.year), Number(today.month), Number(today.day))) {
  console.log(`${todayIso} KST is an official Korean holiday; no publication.`);
  process.exit(0);
}

let archive;
try {
  archive = JSON.parse(await readFile(dataPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  dataPath = 'github-pages/public/data/briefs.json';
  archive = JSON.parse(await readFile(dataPath, 'utf8'));
}
archive.briefs.sort((a, b) => b.date.localeCompare(a.date));
const previous = archive.briefs[0];
if (!previous?.publishedAt) throw new Error('The latest issue has no publishedAt; refusing to guess the collection start.');
const now = new Date();
const nowKst = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(now).replace(' ', 'T');
const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(now);
const system = `당신은 현대리바트 구매·물류 실무자를 위한 날짜별 뉴스 편집자입니다. 웹 검색 결과, 기사 원문, 기업·기관 공식 발표와 공시를 사용해 사실을 교차 확인하세요. 추측·주가 등락 기사·홍보성 기사·정치 공방·무관한 사건사고는 제외하세요.\n\n수집 구간: 직전 실제 발행 시각 ${previous.publishedAt} 다음부터 현재 ${nowKst.replace('T',' ')} KST까지. 날짜가 이 범위 밖인 기사는 수록하지 않습니다. 직전 브리프의 같은 사안은 중요한 새 전개가 없으면 제외합니다.\n\n경제·물류: 정확히 10건, 각 분야 최대 3건. 거시·금융, 대기업·산업, 무역·통상, 물류·공급망, 에너지·원자재, 정책·규제를 포함하고 원가·납기·조달·공급망·수출입·산업수요 영향을 우선합니다. 10건을 위해 사실을 만들어내지 마세요. 중요도 낮은 자료는 넣지 말고 10건이 검증되지 않으면 status를 insufficient로 반환하세요. 거시·금융/에너지·원자재는 한국어 국내 언론·공공기관·국내 증권사 자료를 우선 링크합니다. 해외 출처만 가능하면 공식 해외 출처를 선택하고 source에 해외 출처임을 표시합니다.\n\n고객사 그룹은 정확히 현대백화점그룹, 현대자동차그룹, HD현대그룹, 그 외 고객사 네 그룹입니다. 각 그룹 최대 3건이며, 확인된 소식만 싣고 없으면 빈 배열입니다. 현대자동차그룹은 현대자동차·기아·현대글로비스·현대모비스·현대제철·현대트랜시스·현대케피코·현대카드·현대건설·현대위아·현대오토에버를 모두 확인합니다. 그 외 고객사는 롯데그룹·신세계그룹·현대그룹·HL홀딩스·현대해상·KCC를 확인합니다.\n\nMRO 동종업계는 아이마켓코리아·서브원·코리아e플랫폼·엔투비의 최근 30일만 살피고, 직전 브리프에 실린 URL은 반복하지 않습니다. 새 공시·발표 또는 중요한 후속 전개만 포함합니다.\n\n각 기사는 원제목, 확인된 사실과 실무 영향을 구분한 한 문장 요약, 원문 URL, 매체/기관, 한국시간 발행시각(YYYY-MM-DD HH:mm KST 또는 시간 미공개)을 씁니다. 배열 순서는 중요도 내림차순으로 정렬합니다.\n\nJSON만 반환하세요. 형식: {"status":"ok"|"insufficient","economy":[{"category":"...","title":"...","summary":"...","url":"https://...","source":"...","published":"YYYY-MM-DD HH:mm KST"}],"clients":[{"name":"현대백화점그룹","companies":["..."],"logo":"/logos/...","items":[{"title":"...","summary":"...","url":"https://...","source":"...","published":"...","company":"..."}]} x 4],"peers":[{"title":"...","summary":"...","url":"https://...","source":"...","published":"...","company":"..."}]}.`;
const user = `오늘 날짜는 ${todayIso} (${dayName}, Asia/Seoul)입니다. 기존 아카이브의 가장 최근 회차는 ${previous.date}입니다. 기존 URL은 경제·물류 ${previous.economy.map(x => x.url).join(' | ')}; 고객사 ${previous.clients.flatMap(g => g.items).map(x => x.url).join(' | ')}; 동종업계 ${previous.peers.map(x => x.url).join(' | ')} 입니다. 저장된 전체 기준에 맞는 오늘 브리프를 새로 조사하세요.`;
const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, tools: [{ type: 'web_search' }], input: [{ role: 'system', content: system }, { role: 'user', content: user }], text: { format: { type: 'json_object' } } }),
});
if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
const payload = await response.json();
const answer = payload.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text ?? payload.output_text;
if (!answer) throw new Error('No structured news response received.');
const result = JSON.parse(answer);
if (result.status !== 'ok') throw new Error('The collection did not find enough verified stories; archive left unchanged.');

const requiredGroups = ['현대백화점그룹', '현대자동차그룹', 'HD현대그룹', '그 외 고객사'];
if (!Array.isArray(result.economy) || result.economy.length !== 10) throw new Error(`Expected exactly 10 economy articles; got ${result.economy?.length ?? 0}.`);
if (!Array.isArray(result.clients) || JSON.stringify(result.clients.map(group => group.name)) !== JSON.stringify(requiredGroups)) throw new Error('Client group set/order is invalid.');
result.clients = result.clients.map(group => {
  const saved = previous.clients.find(item => item.name === group.name);
  return { ...group, companies: saved.companies, logo: saved.logo };
});
if (result.clients.some(group => !Array.isArray(group.items) || group.items.length > 3)) throw new Error('A client group exceeds the 3-article limit.');
if (!Array.isArray(result.peers)) throw new Error('Peer articles are not an array.');
const categories = new Map();
const unique = new Set();
const latestPublished = new Date(previous.publishedAt.replace(' KST', '').replace(' ', 'T') + '+09:00');
for (const item of result.economy) {
  categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
  if (categories.get(item.category) > 3) throw new Error(`Category limit exceeded: ${item.category}.`);
}
for (const item of [...result.economy, ...result.clients.flatMap(group => group.items), ...result.peers]) {
  if (!item.title || !item.summary || !item.url?.startsWith('https://') || !item.source || !item.published) throw new Error('An article is missing a required field.');
  if (unique.has(item.url)) throw new Error(`Duplicate URL in this issue: ${item.url}.`);
  unique.add(item.url);
}
const economyUrls = new Set(previous.economy.map(item => item.url));
if (result.economy.some(item => economyUrls.has(item.url))) throw new Error('A prior economy URL was repeated.');
const previousClientUrls = new Set(previous.clients.flatMap(group => group.items).map(item => item.url));
if (result.clients.some(group => group.items.some(item => previousClientUrls.has(item.url)))) throw new Error('A prior client URL was repeated.');
const previousPeerUrls = new Set(archive.briefs
  .filter(brief => brief.date >= new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
  .flatMap(brief => brief.peers.map(item => item.url)));
if (result.peers.some(item => previousPeerUrls.has(item.url))) throw new Error('A prior 30-day peer URL was repeated.');
const start = latestPublished.getTime();
const end = now.getTime();
function checkWindow(item, peer = false) {
  const timeText = item.published.replace(/ KST$/, '').replace(' ', 'T');
  const parsed = new Date(`${timeText}+09:00`).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`Unusable publication time: ${item.published}`);
  if (peer) {
    if (parsed < end - 30 * 86400_000 || parsed > end) throw new Error(`Peer item outside last 30 days: ${item.title}`);
  } else if (parsed <= start || parsed > end) {
    throw new Error(`Article outside collection window: ${item.title} (${item.published})`);
  }
}
for (const item of result.economy) checkWindow(item);
for (const item of result.clients.flatMap(group => group.items)) checkWindow(item);
for (const item of result.peers) checkWindow(item, true);
const issue = {
  date: todayIso,
  publishedAt: `${nowKst.replace('T', ' ')} KST`,
  economy: result.economy,
  clients: result.clients,
  peers: result.peers,
};
archive.briefs = [issue, ...archive.briefs.filter(brief => brief.date !== todayIso)];
await writeFile(dataPath, `${JSON.stringify(archive, null, 2)}\n`);
console.log(`Created ${todayIso} issue at ${issue.publishedAt}; 10 economy, ${issue.clients.reduce((n, group) => n + group.items.length, 0)} client, ${issue.peers.length} peer items.`);
