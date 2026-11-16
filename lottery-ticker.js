'use strict';
(() => {
  const roots = Array.from(document.querySelectorAll('[data-lottery-ticker]'));
  if (!roots.length) return;
  const renderStates=new WeakMap();
  const locale=()=>window.DispatchI18n?.locale()||'en-US';
  const games = [
    { id: 'powerball', name: 'Powerball', ballLabel: 'Powerball', drawDays: 'Mon · Wed · Sat', sourceUrl: 'https://www.texaslottery.com/export/sites/lottery/Games/Powerball/index.html' },
    { id: 'mega-millions', name: 'Mega Millions', ballLabel: 'Mega Ball', drawDays: 'Tue · Fri', sourceUrl: 'https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/index.html' }
  ];
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const date = value => new Intl.DateTimeFormat(locale(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
  const checked = value => new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' }).format(new Date(value));
  function el(tag, className, content) {
    const node = document.createElement(tag); if (className) node.className = className; if (content != null) node.textContent = content; return node;
  }
  function resultRow(game, draw, compact = false) {
    const row = el('div', compact ? 'lottery-history-row' : 'lottery-result');
    row.append(el('span', 'lottery-draw-date', date(draw.date)));
    const balls = el('span', 'lottery-balls');
    balls.setAttribute('role', 'img');
    balls.setAttribute('aria-label', draw.numbers.join(', ') + '; ' + game.ballLabel + ' ' + draw.specialBall);
    for (const number of draw.numbers) { const ball = el('span', 'lottery-ball', number); ball.setAttribute('aria-hidden', 'true'); balls.append(ball); }
    const special = el('span', 'lottery-ball lottery-special', draw.specialBall); special.setAttribute('aria-hidden', 'true'); balls.append(special); row.append(balls);
    row.append(el('span', 'lottery-special-label', game.ballLabel + ' ' + draw.specialBall + (draw.powerPlay ? ' · Power Play ' + draw.powerPlay + '×' : '')));
    return row;
  }
  function render(root, records = [], loading = false) {
    renderStates.set(root,{records,loading});
    const open = new Set(Array.from(root.querySelectorAll('details[open]')).map(d => d.dataset.game));
    const section = el('section', 'lottery-strip'); section.setAttribute('aria-label', 'Lottery jackpots and drawing results');
    const heading = el('div', 'lottery-strip-heading'); heading.append(el('span', 'lottery-eyebrow', 'LOTTERY UPDATES'), el('span', 'lottery-caption', 'Jackpots & latest winning numbers')); section.append(heading);
    const grid = el('div', 'lottery-grid');
    for (const game of games) {
      const data = records.find(r => r.id === game.id) || { status: loading ? 'loading' : 'unavailable' };
      const card = el('article', 'lottery-card lottery-' + game.id);
      const head = el('div', 'lottery-card-head'); head.append(el('h2', 'lottery-game-name', game.name), el('span', 'lottery-schedule', (game.id==='powerball'?[1,3,6]:[2,5]).map(day=>new Intl.DateTimeFormat(locale(),{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2020,0,5+day)))).join(' · '))); card.append(head);
      if (data.status === 'stale') card.append(el('p', 'lottery-notice', data.note));
      if (data.estimatedJackpot && data.nextDrawDate) {
        const prize = el('div', 'lottery-prize'); prize.append(el('strong', 'lottery-amount', money(data.estimatedJackpot)), el('span', 'lottery-prize-label', 'Est. annuity jackpot')); card.append(prize);
        card.append(el('p', 'lottery-next', 'Next drawing: ' + date(data.nextDrawDate) + (data.cashValue ? ' · Cash option ' + money(data.cashValue) : '')));
      } else card.append(el('p', 'lottery-empty', loading ? 'Checking official results…' : 'Jackpot update unavailable'));
      if (data.latest) { card.append(el('p', 'lottery-result-label', data.status === 'stale' ? 'Last confirmed draw' : 'Latest winning numbers'), resultRow(game, data.latest)); }
      else if (!loading) card.append(el('p', 'lottery-notice', 'Results temporarily unavailable. Use the official results link below.'));
      if (data.recent?.length) {
        const details = el('details', 'lottery-history'); details.dataset.game = game.id; details.open = open.has(game.id); if(details.open)details.setAttribute('open','');
        details.append(el('summary', '', 'Recent draws · past 7 days'));
        for (const draw of data.recent) details.append(resultRow(game, draw, true)); card.append(details);
      }
      const footer = el('div', 'lottery-card-foot'); const source = el('a', '', 'Official results'); source.href = game.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.setAttribute('aria-label', game.name + ' official results at Texas Lottery'); footer.append(source);
      footer.append(el('span', '', data.checkedAt ? 'Checked ' + checked(data.checkedAt) : 'Source: Texas Lottery')); card.append(footer); grid.append(card);
    }
    section.append(grid); section.append(el('p', 'lottery-footnote', 'Source: Texas Lottery. Estimates before taxes. Results refresh automatically; verify against the official draw.'));
    root.replaceChildren(section);
  }
  let busy = false;
  let lastRecords = [];
  async function refresh() {
    if (busy || document.hidden) return; busy = true;
    try {
      const response = await fetch('/api/lottery', { signal: AbortSignal.timeout(15000), credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error('Results unavailable');
      const payload = await response.json();
      if (!Array.isArray(payload.games) || payload.games.length !== 2) throw new Error('Incomplete results');
      lastRecords = payload.games;
      for (const root of roots) render(root, lastRecords);
    } catch (error) {
      for (const root of roots) render(root, lastRecords.map(game => ({ ...game, estimatedJackpot: null, cashValue: null, nextDrawDate: null, status: 'stale', note: 'Update delayed — showing the last confirmed results.' })));
    } finally { busy = false; }
  }
  for (const root of roots) render(root, [], true);
  window.addEventListener('dispatch-language-change',()=>{for(const root of roots){const state=renderStates.get(root);if(state)render(root,state.records,state.loading);}});
  refresh(); setInterval(refresh, 300000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
