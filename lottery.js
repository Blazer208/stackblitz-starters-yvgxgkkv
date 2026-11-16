'use strict';

// Public results from an official participating state lottery. No account or
// ticket information is sent to the source, and no upstream markup is served.
const GAMES = Object.freeze([
  { id: 'powerball', name: 'Powerball', ballLabel: 'Powerball', maxWhite: 69, maxBall: 26, drawDays: 'Mon · Wed · Sat', sourceUrl: 'https://www.texaslottery.com/export/sites/lottery/Games/Powerball/index.html' },
  { id: 'mega-millions', name: 'Mega Millions', ballLabel: 'Mega Ball', maxWhite: 70, maxBall: 24, drawDays: 'Tue · Fri', sourceUrl: 'https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/index.html' }
]);
const DAY = 86400000;
const text = value => String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|#160);/gi, ' ').replace(/\s+/g, ' ').trim();

function dateOnly(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error('Invalid drawing date');
  const [, month, day, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Invalid drawing date');
  return date.toISOString().slice(0, 10);
}

function dollars(value) {
  const match = /^\$([\d,]+(?:\.\d+)?)\s*(Million|Billion)?$/i.exec(text(value));
  if (!match) throw new Error('Invalid jackpot amount');
  const amount = Number(match[1].replace(/,/g, '')) * (/billion/i.test(match[2]) ? 1e9 : /million/i.test(match[2]) ? 1e6 : 1);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11) throw new Error('Invalid jackpot amount');
  return Math.round(amount);
}

function result(game, date, numbers, specialBall, powerPlay = null) {
  if (numbers.length !== 5 || new Set(numbers).size !== 5 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > game.maxWhite) || !Number.isInteger(specialBall) || specialBall < 1 || specialBall > game.maxBall) throw new Error('Invalid winning numbers');
  return { date, numbers: numbers.slice().sort((a, b) => a - b), specialBall, ...(game.id === 'powerball' && [2, 3, 4, 5, 10].includes(powerPlay) ? { powerPlay } : {}) };
}

function parseLotteryPage(html, game) {
  if (typeof html !== 'string' || html.length > 524288) throw new Error('Invalid lottery response');
  // The site header contains OTHER games' jackpots too: use this game's
  // dedicated "Current Est." panel, never the first dollar amount on the page.
  const panel = /Current\s+Est\.\s+Annuitized\s+Jackpot\s+for\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*:[\s\S]{0,250}?<h1\b[^>]*>([\s\S]*?)<\/h1>([\s\S]{0,500}?)(?:<\/div>)/i.exec(html);
  if (!panel) throw new Error('Jackpot panel unavailable');
  const cashMatch = /Est\.\s+Cash\s+Value:\s*(\$[\d,.]+\s*(?:Million|Billion)?)/i.exec(text(panel[3]));
  const drawHeading = new RegExp('<h2\\b[^>]*>\\s*' + game.name.replace(/ /g, '\\s+') + '\\s+Winning Numbers for\\s+(\\d{1,2}/\\d{1,2}/\\d{4})\\s+are:','i').exec(html);
  if (!drawHeading) throw new Error('Winning draw unavailable');
  const drawSection = html.slice(drawHeading.index + drawHeading[0].length, drawHeading.index + drawHeading[0].length + 1500);
  const balls = /<ol\b[^>]*class=["'][^"']*winningNumberBalls[^"']*["'][^>]*>([\s\S]*?)<\/ol>/i.exec(drawSection);
  if (!balls) throw new Error('Winning numbers unavailable');
  const values = Array.from(balls[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi), m => text(m[1])).map(v => /^\d{1,2}$/.test(v) ? Number(v) : NaN);
  if (values.length !== 6) throw new Error('Incomplete winning numbers');
  const multiplier = /Power Play:\s*(?:<[^>]+>\s*)*(\d{1,2})/i.exec(drawSection);
  const latest = result(game, dateOnly(drawHeading[1]), values.slice(0, 5), values[5], multiplier ? Number(multiplier[1]) : null);
  const recent = [latest];
  const past = /<div\b[^>]*\bid=["']PastResults["'][^>]*>/i.exec(html);
  if (past) {
    const rows = html.slice(past.index, past.index + 16000).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const row of rows) {
      const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), m => text(m[1]));
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[0] || '')) continue;
      const nums = (cells[1] || '').split(/\s*[-–]\s*/).map(Number);
      const item = result(game, dateOnly(cells[0]), nums, Number(cells[2]), Number(cells[3]));
      const duplicate = recent.find(r => r.date === item.date);
      if (duplicate && (duplicate.numbers.join(',') !== item.numbers.join(',') || duplicate.specialBall !== item.specialBall)) throw new Error('Source results disagree');
      if (!duplicate) recent.push(item);
      if (recent.length >= 8) break;
    }
  }
  recent.sort((a, b) => b.date.localeCompare(a.date));
  const nextDrawDate = dateOnly(panel[1]);
  if (recent[0].date !== latest.date || nextDrawDate <= latest.date) throw new Error('Source drawing dates disagree');
  return { estimatedJackpot: dollars(panel[2]), cashValue: cashMatch ? dollars(cashMatch[1]) : null, nextDrawDate, latest, recent };
}

function easternDate(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const part = kind => parts.find(p => p.type === kind).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

function createLotteryService({ fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 300000, retryMs = 60000 } = {}) {
  const entries = new Map();
  function view(game, entry, failed) {
    const today = easternDate(now());
    const cutoff = new Date(Date.parse(today) - 7 * DAY).toISOString().slice(0, 10);
    const expired = entry?.value && (entry.value.nextDrawDate < today || entry.value.latest.date < cutoff);
    const status = !entry?.value ? 'unavailable' : failed || expired ? 'stale' : 'current';
    return {
      id: game.id, name: game.name, ballLabel: game.ballLabel, drawDays: game.drawDays,
      sourceName: 'Texas Lottery', sourceUrl: game.sourceUrl, status,
      checkedAt: entry?.checkedAt || null,
      ...(entry?.value || { estimatedJackpot: null, cashValue: null, nextDrawDate: null, latest: null }),
      recent: (entry?.value?.recent || []).filter(r => r.date >= cutoff && r.date <= today),
      // A completed drawing's jackpot must never be labelled as the next one.
      ...(entry?.value?.nextDrawDate < today ? { estimatedJackpot: null, cashValue: null, nextDrawDate: null } : {}),
      note: status === 'unavailable' ? 'Results temporarily unavailable. Check the official source.' : status === 'stale' ? 'Update delayed — showing the last confirmed results.' : null
    };
  }
  async function load(game) {
    let entry = entries.get(game.id);
    if (entry?.pending) return entry.pending;
    if (entry && now() < entry.retryAt) return view(game, entry, entry.failed);
    if (!entry) { entry = {}; entries.set(game.id, entry); }
    entry.pending = (async () => {
      try {
        const response = await fetchImpl(game.sourceUrl, { signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html', 'User-Agent': 'DispatchPro-LotteryResults/1.0' } });
        if (!response.ok) throw new Error('Source unavailable');
        if (Number(response.headers?.get('content-length')) > 524288) throw new Error('Source response too large');
        const parsed = parseLotteryPage(await response.text(), game);
        const today = easternDate(now());
        if (parsed.latest.date > today || parsed.nextDrawDate > new Date(Date.parse(today) + 7 * DAY).toISOString().slice(0, 10)) throw new Error('Invalid source dates');
        entry.value = parsed; entry.checkedAt = new Date(now()).toISOString(); entry.failed = false; entry.retryAt = now() + ttlMs;
      } catch (error) {
        entry.failed = true; entry.retryAt = now() + retryMs;
      }
      return view(game, entry, entry.failed);
    })();
    try { return await entry.pending; } finally { entry.pending = null; }
  }
  return { async getResults() { return { games: await Promise.all(GAMES.map(load)), servedAt: new Date(now()).toISOString(), refreshSeconds: 300 }; } };
}

module.exports = { GAMES, parseLotteryPage, createLotteryService };
