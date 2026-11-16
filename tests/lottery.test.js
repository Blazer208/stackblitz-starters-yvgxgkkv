const test = require('node:test');
const assert = require('node:assert/strict');
const {GAMES, parseLotteryPage, createLotteryService} = require('../lottery');

function fixture(game, {date='11/14/2026', next='11/16/2026', amount='$76 Million', cash='$31.8 Million', white=[9,44,49,51,68], ball=4} = {}) {
 return `<a><p>Est. Annuitized Jackpot for 11/17/2026:</p><h1>$600 Million</h1></a>
 <div class="jackpotPadding"><p>Current Est. Annuitized Jackpot for ${next}:</p><h1>${amount}</h1><p>Est. Cash Value: ${cash}</p></div>
 <h2>${game.name} Winning Numbers for ${date} are:</h2><ol class="winningNumberBalls">${[...white,ball].map(n=>`<li><span>${n}</span></li>`).join('')}</ol>
 <h4>Power Play: <span>2</span></h4><div id="PastResults"><table><tr><th>Draw Date</th></tr>
 <tr><td><a>${date}</a></td><td>${white.join(' - ')}</td><td>${ball}</td><td>2</td></tr>
 <tr><td>11/11/2026</td><td>8 - 42 - 45 - 51 - 57</td><td>17</td><td>3</td></tr>
 <tr><td>11/04/2026</td><td>15 - 34 - 41 - 53 - 56</td><td>21</td><td>2</td></tr></table></div>`;
}
const nowValue=Date.parse('2026-11-16T15:00:00Z');
const response=html=>({ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>html});
function pageFor(url) {
 const game=GAMES.find(g=>g.sourceUrl===url);
 return game.id==='powerball' ? fixture(game) : fixture(game,{date:'11/13/2026',next:'11/17/2026',amount:'$600 Million',cash:'$246.9 Million',white:[10,22,33,49,57],ball:18});
}

test('lottery parser selects its own current jackpot rather than another game in the shared header',()=>{
 const parsed=parseLotteryPage(fixture(GAMES[0]),GAMES[0]);
 assert.equal(parsed.estimatedJackpot,76000000);assert.equal(parsed.cashValue,31800000);assert.equal(parsed.nextDrawDate,'2026-11-16');
 assert.deepEqual(parsed.latest,{date:'2026-11-14',numbers:[9,44,49,51,68],specialBall:4,powerPlay:2});
 assert.equal(parsed.recent.length,3);
});
test('Mega Millions parses its Mega Ball and cash option without inventing a shared multiplier',()=>{
 const parsed=parseLotteryPage(pageFor(GAMES[1].sourceUrl),GAMES[1]);
 assert.equal(parsed.estimatedJackpot,600000000);assert.equal(parsed.cashValue,246900000);assert.equal(parsed.latest.specialBall,18);assert.equal(parsed.latest.powerPlay,undefined);
});
test('lottery parser fails closed on duplicate balls, out-of-range special balls, missing sections and invalid dates',()=>{
 for(const options of [{white:[9,9,49,51,68]},{ball:27},{date:'02/30/2026'},{next:'11/12/2026'}])assert.throws(()=>parseLotteryPage(fixture(GAMES[0],options),GAMES[0]));
 assert.throws(()=>parseLotteryPage('<h1>$100 Million</h1>',GAMES[0]));
 assert.throws(()=>parseLotteryPage(fixture(GAMES[0]).replace('<td>4</td>','<td>5</td>'),GAMES[0]));
});
test('lottery requests are coalesced and cached, while history is limited to the last seven days',async()=>{
 let calls=0;
 const service=createLotteryService({now:()=>nowValue,fetchImpl:async url=>{calls++;await new Promise(resolve=>setImmediate(resolve));return response(pageFor(url));}});
 const [a,b]=await Promise.all([service.getResults(),service.getResults()]);
 assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.games[0].status,'current');
 assert.deepEqual(a.games[0].recent.map(r=>r.date),['2026-11-14','2026-11-11']);
 await service.getResults();assert.equal(calls,2);
});
test('one upstream failure does not hide the other game or return invented results',async()=>{
 const service=createLotteryService({now:()=>nowValue,fetchImpl:async url=>url===GAMES[0].sourceUrl?response(pageFor(url)):{ok:false}});
 const {games}=await service.getResults();assert.equal(games[0].status,'current');assert.equal(games[1].status,'unavailable');assert.equal(games[1].estimatedJackpot,null);assert.equal(games[1].latest,null);
});
test('failed refresh preserves dated results and hides a jackpot whose drawing date has passed',async()=>{
 let clock=nowValue,fail=false;
 const service=createLotteryService({now:()=>clock,ttlMs:1000,fetchImpl:async url=>{if(fail)throw Error('offline');return response(pageFor(url));}});
 await service.getResults();fail=true;clock=Date.parse('2026-11-17T15:00:00Z');
 const {games}=await service.getResults();assert.equal(games[0].status,'stale');assert.equal(games[0].estimatedJackpot,null);assert.equal(games[0].nextDrawDate,null);assert.equal(games[0].latest.date,'2026-11-14');assert.equal(games[0].checkedAt,new Date(nowValue).toISOString());
});
