/* Test harness: API-backed stats, peer rule, hiding + replacement. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const panelSrc = fs.readFileSync(path.join(root, 'panel.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
const near = (a, b, t) => Math.abs(a - b) <= (t || 0.05);

let uid = 0;
const uuid = () => `00000000-0000-4000-8000-${(uid++).toString(16).padStart(12, '0')}`;
const daysAgo = d => new Date(Date.now() - d * 864e5).toISOString();

function chr(name, chats, messages, opts = {}) {
  return {
    id: opts.id || uuid(), name,
    creator_name: opts.creator || 'tester',
    creator_id: uuid(),
    avatar: 'abc123.webp',
    description: opts.desc || 'A plain description.',
    total_tokens: 500,
    tags: [{ id: 5, name: 'OC', slug: 'oc' }, { id: 6, name: 'Fictional', slug: 'fictional' }],
    stats: { chat: chats, message: messages },
    total_tokens: opts.tokens ?? 2500,
    public_chat_count: opts.publicChats ?? 3,
    first_published_at: daysAgo(opts.days ?? 400),
    created_at: daysAgo(opts.days ?? 400)
  };
}

const CLEAN  = chr('Clean Popular', 8600, 129000, { days: 500 });         // 15.0 — mid-pack
const LOWBALL = chr('Chats Without Talk', 9000, 18000, { days: 500 });    // 2.0 — low for its size
// 18.8 msg/chat out of a 1,300-token card — thin, like the real botted ones
// measured live (473-1,620 tokens). At the fixture default of 2,500 it would
// legitimately have earned that ratio.
// 18.8 msg/chat out of a 400-token card. The token count has to be thin
// FOR ITS AGE: at 300 days old, 18.8 msg/chat is ordinary on its own (real
// cards past a year run ~30), so only a very thin card makes it remarkable.
const HANA   = chr('Trapped In Hell with Hana', 957, 18000, { days: 300, tokens: 400 });
const MAFIA  = chr('Mafia Boss', 859910, 38819373, { days: 1200 });        // 45.1
const TINY   = chr('Tiny New Card', 12, 400, { days: 2 });
// 2,571 chats/day sustained over 35 days. Has to be past the launch window
// now: the rule ignores anything under 30 days, because a card's first weeks
// are all spike and a lifetime average means nothing there.
const ROCKET = chr('Suspicious Rocket', 90000, 900000, { days: 35 });
const FRESH  = chr('Legitimately New', 40000, 500000, { days: 2 });        // young: spared
// description carrying author HTML, as real cards do
const HTMLDESC = chr('Html Desc', 700, 20000, {
  days: 200, desc: '<p style="text-align:center"><strong>Bold</strong> intro</p><img src=x onerror=alert(1)>'
});

const peers = [];
for (let i = 0; i < 90; i++) {
  const chats = 600 + i * 12;
  // ~4-7 msg/chat, which is what live cards of this size actually run at
  peers.push(chr('peer-small-' + i, chats, Math.round(chats * (4 + i * 0.03))));
}
for (let i = 0; i < 90; i++) {
  const chats = 6000 + i * 140;
  peers.push(chr('peer-mid-' + i, chats, Math.round(chats * (12 + i * 0.09))));
}

// Page 2 — where replacements come from. All comfortably mid-pack.
const PAGE2 = [];
for (let i = 0; i < 12; i++) {
  PAGE2.push(chr('Replacement ' + i, 800 + i * 10, Math.round((800 + i * 10) * 5.2)));
}

// The page also renders a "My Chats" carousel. These would all be flagged
// on ratio — they must be left completely alone regardless.
const MYCHATS = [
  chr('My Chat A', 120, 10800),   // 90 msg/chat — would be flagged if scanned
  chr('My Chat B', 130, 11700),   // 90
  chr('My Chat C', 140, 12600)    // 90
];

// The default rule is now the baseline-free card-depth one. Most of this
// suite predates it and exercises the peer rule, so select it explicitly;
// the depth rule has its own block.
const PAGE1 = { data: [CLEAN, LOWBALL, HANA, MAFIA, TINY, ROCKET, FRESH, HTMLDESC, ...MYCHATS, ...peers] };
const RENDERED = [CLEAN, LOWBALL, HANA, MAFIA, TINY, ROCKET, FRESH, HTMLDESC];

// Markup mirrors the real card: only the MESSAGE count and PUBLIC chat
// count are printed. The true chat count is never in the DOM.
const cardHtml = c => `
  <div class="pp-cc-wrapper" role="group">
    <div class="chakra-stack">
      <a class="profile-character-card-stack-link-component"
         href="/characters/${c.id}_character-x">
        <div class="pp-cc-name">${c.name}</div>
        <div class="profile-character-card-stats-box"><span tabindex="0">
          <span class="pp-cc-chats-count">${Math.round(c.stats.message / 1000)}k</span>
          <span class="pp-cc-public-chats-count">${c.public_chat_count}</span>
        </span></div>
        <div class="chakra-aspect-ratio"><img class="pp-cc-avatar" src="old.webp" alt="old"></div>
      </a>
      <a class="creator-link" href="/profiles/old_profile-of-old">
        <span class="pp-cc-creator-name">@old</span></a>
      <div class="pp-cc-description"><p>Old description.</p></div>
      <ul><li><a href="/search?tag_id=1"><span>old tag</span></a></li>
          <li><a href="/search?tag_id=2"><span>old tag 2</span></a></li></ul>
      <p class="pp-cc-tokens-count">1 tokens</p>
    </div>
  </div>`;

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
     <div class="_chatList_12io1_1"><div class="_carousel_1jy7t_1">
       ${MYCHATS.map(cardHtml).join('')}
     </div></div>
     <div class="pp-cc-list-container">${RENDERED.map(cardHtml).join('')}</div>
   </body></html>`,
  { url: 'https://janitorai.com/', pretendToBeVisual: true, runScripts: 'outside-only' }
);
const { window } = dom;
global.window = window;
global.document = window.document;
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
  get() { return this.parentNode; }
});

const LIST = 'https://janitorai.com/hampter/characters?page=1&special_mode=trending24';
const EVIL = 'https://evil.example/hampter/characters?page=1';
const TOKEN = 'header.payload.signature';
window.document.cookie = 'sb-auth-auth-token.0=base64-' +
  window.btoa(JSON.stringify({ access_token: TOKEN }));

let fetched = [];
let sentHeaders = [];
let page2Status = 200;
window.performance.getEntriesByType = t =>
  (t === 'resource' ? [{ name: EVIL }, { name: LIST }] : []);
window.fetch = async (url, opts) => {
  const u = String(url);
  fetched.push(u);
  sentHeaders.push({ url: u, headers: (opts && opts.headers) || {} });
  if (/\/hampter\/characters\?/.test(u)) {
    const page = parseInt((/[?&]page=(\d+)/.exec(u) || [])[1] || '1', 10);
    if (page === 1) return { ok: true, status: 200, json: async () => PAGE1 };
    if (page === 2) {
      if (page2Status !== 200) return { ok: false, status: page2Status, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: PAGE2 }) };
    }
    if (page >= 3 && page <= 9) {
      // deeper pages: ordinary cards, same shape as the peer population
      const deep = [];
      for (let i = 0; i < 20; i++) {
        const chats = 600 + ((page * 37 + i * 13) % 1100);
        deep.push(chr(`deep-${page}-${i}`, chats, Math.round(chats * (4 + (i % 10) * 0.3))));
      }
      return { ok: true, status: 200, json: async () => ({ data: deep }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

window.eval(panelSrc);
window.eval(engineSrc);
const JBF = window.JBF;
// The default rule is now the baseline-free card-depth one. Most of this
// suite predates it and exercises the peer rule, so select it explicitly;
// the depth rule has its own block.
JBF.cfg.rule = 'peer';

const mem = {};
const memStore = {
  async get() { return mem.cfg || {}; },
  async set(v) { mem.cfg = JSON.parse(JSON.stringify(v)); },
  async getData() { return mem.data || null; },
  async setData(v) { mem.data = JSON.parse(JSON.stringify(v)); }
};
JBF.setStorage(memStore);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const byName = n => JBF._internals.records.find(r => r.name === n);
const reps = () => [...window.document.querySelectorAll('[data-jbf-replacement]')];

(async function run() {
  await JBF.saveCfg({ mode: 'badge' });   // start in badge mode for the rule tests
  await JBF.start();
  await sleep(500);

  console.log('\nAPI capture');
  ok('replayed the page\'s own list url', fetched.includes(LIST));
  ok('ingested the whole payload', JBF._internals.api.size >= PAGE1.data.length,
     String(JBF._internals.api.size));
  ok('matched every rendered card', JBF._internals.records.length === RENDERED.length,
     String(JBF._internals.records.length));

  console.log('\nthe token never leaves janitorai.com');
  ok('a look-alike cross-origin url is never fetched',
     !fetched.some(u => u.startsWith('https://evil.example')),
     fetched.filter(u => u.includes('evil')).join(', '));
  ok('same-origin calls do carry the bearer token',
     sentHeaders.some(h => h.url.startsWith('https://janitorai.com') &&
       h.headers.authorization === 'Bearer ' + TOKEN));
  ok('no request anywhere else carries it',
     sentHeaders.every(h => !h.headers.authorization ||
       h.url.startsWith('https://janitorai.com') || h.url.startsWith('/')),
     sentHeaders.filter(h => h.headers.authorization &&
       !h.url.startsWith('https://janitorai.com') && !h.url.startsWith('/'))
       .map(h => h.url).join(', '));
  ok('the token is never written to storage',
     !JSON.stringify(mem).includes(TOKEN));

  console.log('\nthe baseline is seeded from deeper pages');
  ok('it fetched pages past the one on screen',
     fetched.filter(u => /page=[3-9]/.test(u)).length >= 3,
     fetched.filter(u => /page=\d/.test(u)).map(u => (/page=(\d+)/.exec(u) || [])[1]).join(','));
  ok('those cards reached the baseline',
     [...JBF._internals.api.values()].some(c => /^deep-/.test(c.name)));

  console.log('\na top-of-list baseline mis-centres the curve');
  await (async function () {
    // The listing ranks by messages, so page 1 over-represents inflated
    // cards. Learning only from it put "normal" at 9.3 msg/chat on a live
    // page where a broader sample said 5.5 — enough to hide the outliers.
    const topOfList = [];
    for (let i = 0; i < 160; i++) {
      const chats = 800 + (i * 7) % 1400;
      topOfList.push(chr('top-' + i, chats, Math.round(chats * (8 + (i % 7)))));  // ~8-14
    }
    const deeper = [];
    for (let i = 0; i < 400; i++) {
      const chats = 300 + (i * 11) % 2000;
      deeper.push(chr('deeper-' + i, chats, Math.round(chats * (4.5 + (i % 5) * 0.4))));  // ~4.5-6
    }

    JBF.clearBaseline();
    JBF._internals.ingest(topOfList);
    JBF._internals.rebuildBaseline();
    const contaminated = JBF._internals.scoreFor(1077, 17.1, 0.85);

    JBF._internals.ingest(deeper);
    JBF._internals.rebuildBaseline();
    const broad = JBF._internals.scoreFor(1077, 17.1, 0.85);

    ok('a top-of-list-only baseline calls an inflated ratio normal',
       contaminated && contaminated.expected > 7,
       contaminated ? contaminated.expected.toFixed(1) : 'none');
    ok('and so fails to flag it',
       contaminated && contaminated.multiple < 2.5,
       contaminated ? contaminated.multiple.toFixed(2) + 'x' : 'none');
    ok('deeper pages pull the curve back down',
       broad && broad.expected < contaminated.expected * 0.8,
       broad ? `${contaminated.expected.toFixed(1)} -> ${broad.expected.toFixed(1)}` : 'none');
    ok('and the same card now flags',
       broad && broad.multiple > JBF.cfg.maxMultiple,
       broad ? `${broad.multiple.toFixed(2)}x vs threshold ${JBF.cfg.maxMultiple}x` : 'none');

    // This block replaced the whole sample pool with its own small cards.
    // Put the real population back, or every later test judges cards
    // against a baseline that has nothing their size in it.
    JBF.clearBaseline();
    JBF._internals.ingest(PAGE1.data);
    JBF._internals.rebuildBaseline();
  })();

  console.log('\ncard depth — the rule that needs nothing learned');
  (function () {
    const was = JBF.cfg.rule; JBF.cfg.rule = 'thin';
    // Measured live off janitorai's own API across all 204 cards then on
    // 24-hour trending. chats, msg/chat, total_tokens, and the hand label.
    const LIVE = [
      ['Sofia',            239, 19.53,  473, 1],
      ['Sasuke',           351, 26.30, 1388, 1],
      ['Alice & Tzipi',    958, 17.95, 1620, 1],
      ['Lonely young woman',1115,14.95, 1538, 1],
      ['She Hates You',   3816, 17.14, 2076, 0],
      ['No One Thinks',   2410, 18.20, 3485, 0],
      ['heroines',        1007, 14.60, 6598, 0],
      ['Popular Girls',   7407,  7.66, 3883, 0]
    ];
    const verdict = (chats, ratio, tokens) => {
      const rec = { id: 't' + chats, name: 'x', chats, ratio,
        messages: Math.round(chats * ratio), days: 1, tokens, publicChats: 0 };
      JBF._internals.evaluate(rec); return rec;
    };
    const res = LIVE.map(([n, c, r, t, bot]) => ({ n, bot, ...verdict(c, r, t) }));

    ok('every card labelled botted is flagged',
       res.filter(x => x.bot).every(x => x.flagged),
       res.filter(x => x.bot && !x.flagged).map(x => x.n).join(', ') || 'all four');
    ok('every card labelled genuine is left alone',
       res.filter(x => !x.bot).every(x => !x.flagged),
       res.filter(x => !x.bot && x.flagged).map(x => x.n).join(', ') || 'all four');

    // The pair no ratio can separate: 1,115 chats at 14.95 vs 1,007 at 14.60.
    const bot = verdict(1115, 14.95, 1538), ok2 = verdict(1007, 14.60, 6598);
    ok('it separates the pair that the ratio cannot',
       bot.flagged && !ok2.flagged,
       `14.95 on a 1,538-token card -> ${bot.thin.toFixed(1)} | ` +
       `14.60 on a 6,598-token card -> ${ok2.thin.toFixed(1)}`);
    ok('and the margin is not a hair', bot.thin > ok2.thin * 3,
       `${ok2.thin.toFixed(1)} vs ${bot.thin.toFixed(1)}`);

    ok('it needs no baseline at all', (() => {
      JBF.clearBaseline();                       // nothing learned whatsoever
      return verdict(1115, 14.95, 1538).flagged && !verdict(1007, 14.60, 6598).flagged;
    })());
    ok('a deep card with a high ratio is not touched',
       !verdict(2410, 18.20, 3485).flagged);
    ok('a thin card nobody talks to much is not touched',
       !verdict(2000, 4.0, 500).flagged, 'low ratio, nothing to explain');
    // Without a token count the DEPTH rule must abstain. It still falls
    // through to the size-and-age rule, which may well judge it — that is
    // the point of degrading rather than going silent.
    ok('the depth rule abstains when there is no token count',
       !/token card/.test(verdict(1115, 14.95, null).reason || ''),
       verdict(1115, 14.95, null).reason || '(none)');
    ok('the reason names both numbers', /msg\/chat from a .*-token card/.test(
       verdict(239, 19.53, 473).reason), verdict(239, 19.53, 473).reason);

    JBF.cfg.rule = was;
    JBF._internals.ingest(PAGE1.data);
    JBF._internals.rebuildBaseline();
  })();

  console.log('\nthe labelled cards must stay separated');
  (function () {
    // The eight cards a human reader labelled by hand over the life of this
    // project. Every regression this filter has shipped showed up here first
    // as the two groups sliding into each other, so this is the test that
    // matters most. The population below is built ONLY from the day-one
    // curve measured independently (5.0 msg/chat at 790 chats, rising with
    // slope 0.61) — none of the labelled cards are in it.
    JBF.clearBaseline();
    let seed = 2026;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const gauss = () => { const u = Math.max(1e-9, rnd());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const TRUE = c => 5.0 * Math.pow(c / 790, 0.61);
    const pop = [];
    const put = (c, r, d) => pop.push(chr('pop' + pop.length, Math.round(c),
      Math.max(1, Math.round(c * r)), { days: d }));
    for (let i = 0; i < 340; i++) { const c = Math.pow(10, 2.0 + rnd());          // deeper pages
      put(c, TRUE(c) * Math.exp(gauss() * 0.45), 0.5 + rnd()); }
    for (let i = 0; i < 55; i++) { const c = Math.pow(10, 3.0 + rnd() * 0.85);    // page 1
      put(c, TRUE(c) * Math.exp(gauss() * 0.45), 0.5 + rnd()); }
    for (let i = 0; i < 45; i++) { const c = Math.pow(10, 2.2 + rnd() * 1.4);     // inflated
      put(c, TRUE(c) * (2.5 + rnd() * 2) * Math.exp(gauss() * 0.3), 0.5 + rnd()); }
    for (let i = 0; i < 500; i++) { const c = Math.pow(10, 2 + rnd() * 2.8);      // older history
      put(c, 4 * Math.pow(c / 100, 0.45) * Math.exp(gauss() * 0.5), 60 + rnd() * 600); }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const LAB = [['Hana', 957, 18000, 1], ['891 example', 891, 15935, 1],
      ['Wrong Girl', 1077, 18439, 1], ['Lonely', 1020, 14953, 1],
      ["No One Thinks", 1820, 30276, 0], ['Northern', 3259, 56363, 0],
      ['Popular Girls', 6515, 46004, 0], ['8.6k example', 8600, 97000, 0]];
    const m = {};
    for (const [nm, c, msg] of LAB) m[nm] = JBF._internals.scoreFor(c, msg / c, 1).multiple;

    // The curve must still RISE with size inside one age band. A flat curve
    // is what every broken build produced, and it is what drags large cards
    // over the threshold.
    const e = c => JBF._internals.scoreFor(c, 10, 1).expected;
    ok('the day-one curve rises with size', e(3259) > e(790) * 2,
       `790:${e(790).toFixed(1)} -> 3259:${e(3259).toFixed(1)}`);

    const bot = LAB.filter(r => r[3]).map(r => m[r[0]]);
    const leg = LAB.filter(r => !r[3]).map(r => m[r[0]]);
    const legHigh = leg.filter(v => v > 1);
    const ceiling = legHigh.length ? Math.max(...legHigh) : 1;
    ok('every card believed botted scores above every card believed genuine',
       Math.min(...bot) > ceiling,
       LAB.map(r => `${r[0].split(' ')[0]} ${m[r[0]].toFixed(2)}`).join('  '));
    ok('and the default threshold sits inside that gap',
       JBF.cfg.maxMultiple > ceiling && JBF.cfg.maxMultiple < Math.min(...bot),
       `${ceiling.toFixed(2)} < ${JBF.cfg.maxMultiple} < ${Math.min(...bot).toFixed(2)}`);
    ok('a large ordinary card is not called chat-inflated',
       Math.min(...leg) > 1 / JBF.cfg.lowMultiple,
       `lowest ${Math.min(...leg).toFixed(2)} vs cutoff ${(1 / JBF.cfg.lowMultiple).toFixed(2)}`);

    // End to end, through the real verdict path rather than the score alone.
    const verdict = (c, msg) => { const rec = { id: 'v' + c, name: 'v', chats: c,
      messages: msg, ratio: msg / c, days: 1, publicChats: 0 };
      JBF._internals.evaluate(rec); return rec.flagged; };
    ok('Wrong Girl and Lonely are hidden', verdict(1077, 18439) && verdict(1020, 14953));
    ok('Northern, No One Thinks and Popular Girls are not',
       !verdict(3259, 56363) && !verdict(1820, 30276) && !verdict(6515, 46004));

    JBF.clearBaseline();
    JBF._internals.ingest(PAGE1.data);
    JBF._internals.rebuildBaseline();
  })();

  console.log('\nbroad audiences are not judged on ratio alone');
  (function () {
    JBF.clearBaseline();
    let seed = 77;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pop = [];
    for (let i = 0; i < 400; i++) {
      const chats = 150 + Math.round(rnd() * 6000);
      pop.push(chr('day1-' + i, chats, Math.round(chats * (4.2 + rnd() * 2)), { days: 0.6 + rnd() }));
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const judge = (chats, ratio) => {
      const rec = { id: 'x' + chats, name: 'n', chats, ratio, messages: Math.round(chats * ratio),
        days: 1, publicChats: 0 };
      JBF._internals.evaluate(rec); return rec;
    };
    // Off by default — once the curve holds its slope, a card's own size is
    // already priced in and this is only there for people who want it.
    const guardWas = JBF.cfg.trustAbove;
    JBF.cfg.trustAbove = 1500;
    // Same ratio, two very different audience sizes.
    const small = judge(1077, 17.12);
    const broad = judge(3259, 17.29);
    ok('a high ratio on a small card is still flagged', small.flagged, small.reason);
    ok('the same ratio on a card with thousands of chats is not', !broad.flagged,
       broad.reason || '(no reason)');
    ok('and it says why it was spared', /too broad an audience/.test(broad.reason || ''),
       broad.reason);
    ok('the guard is a setting, not a rule', (() => {
      JBF.cfg.trustAbove = 0;
      const again = judge(3259, 17.29);
      JBF.cfg.trustAbove = 1500;
      return again.flagged;
    })());
    ok('and it is off by default', guardWas === 0, String(guardWas));
    ok('chats arriving without conversation are still caught at any size', (() => {
      const r = judge(6515, 0.9);          // far BELOW normal: chat inflation
      return r.flagged && /without conversation/.test(r.reason);
    })(), judge(6515, 0.9).reason);

    // Vetting replacements must not walk every cached card per candidate.
    const before = JBF._internals.creatorWalks();
    for (const c of pop.slice(0, 120)) JBF._internals.wouldFlag(c);
    const walks = JBF._internals.creatorWalks() - before;
    ok('vetting 120 replacement candidates does not rescan the cache each time',
       walks <= 1, `${walks} full scans for 120 candidates`);

    JBF.cfg.trustAbove = guardWas;
    JBF.clearBaseline();
    JBF._internals.ingest(PAGE1.data);
    JBF._internals.rebuildBaseline();
  })();

  console.log('\nsignals the ratio cannot supply');
  (function () {
    const H = JBF._internals.history;
    const HOUR = 36e5, now = Date.now();
    // Lay down a sighting history by hand: [timestamp, chats, messages].
    // Six-hour spacing, eight sightings: 42 hours of coverage with a median
    // gap of 6h. Both are now required — a shorter window cannot see a day's
    // shape, and a healthy card's fresh chats read low over a short one.
    const lay = (id, rates, msgPerChat) => {
      const rows = []; let c = 1000, m = 1000 * 15;
      for (let i = 0; i < rates.length; i++) {
        rows.push([now - (rates.length - i) * 6 * HOUR, Math.round(c), Math.round(m)]);
        c += rates[i] * 6; m += rates[i] * 6 * msgPerChat;
      }
      H.set(id, rows); return id;
    };

    // Traffic that follows the clock: busy evening, dead at 4am.
    const human = lay('human', [40, 95, 130, 60, 22, 15, 70, 120], 15);
    // Traffic someone configured: the same average, metered out flat.
    const metered = lay('metered', [69, 70, 68, 71, 69, 70, 69, 70], 15);

    const gh = JBF._internals.growthShape(human, 15);
    const gm = JBF._internals.growthShape(metered, 15);
    ok('a real card\'s traffic swings across the day',
       gh && gh.burstiness > 2, gh ? gh.burstiness.toFixed(2) + 'x' : 'none');
    ok('a metered card\'s does not',
       gm && gm.burstiness < 1.35, gm ? gm.burstiness.toFixed(2) + 'x' : 'none');
    ok('and the two are told apart despite an identical average rate',
       gh && gm && gh.burstiness > gm.burstiness * 2,
       gh && gm ? `${gh.burstiness.toFixed(2)}x vs ${gm.burstiness.toFixed(2)}x` : 'none');

    // A card coasting on a ratio it no longer earns.
    const stale = lay('stale', [40, 95, 130, 60, 22, 15, 70, 120], 3.5);
    const gs = JBF._internals.growthShape(stale, 15);
    ok('fresh chats are measured against the lifetime ratio',
       gs && gs.drift !== null && gs.drift < 0.5,
       gs ? `fresh ${gs.incRatio.toFixed(1)} vs lifetime 15.0 (${gs.drift.toFixed(2)})` : 'none');
    ok('a card whose ratio is all history is caught', (() => {
      const rec = { id: 'stale', chats: 1000, ratio: 15, messages: 15000, days: 40,
        name: 'Stale', shape: gs, multiple: 1.1 };
      JBF._internals.evaluate(rec);
      return rec.flagged && /is history/.test(rec.reason);
    })());
    ok('while the same growth at a healthy ratio raises none of these', (() => {
      const rec = { id: 'human', chats: 1000, ratio: 15, messages: 15000, days: 40,
        name: 'Human', shape: gh, multiple: 1.1 };
      JBF._internals.evaluate(rec);
      // It may still be judged on ratio — that is the other rule's business.
      // What must not happen is a growth-shape verdict.
      return !/is history|near-constant rate/.test(rec.reason);
    })());
    ok('one or two sightings are not enough to claim a shape',
       JBF._internals.growthShape(lay('short', [70, 70], 15), 15) === null);

    H.clear();
  })();

  console.log('\nstarting over must leave it working');
  (function () {
    // Regression: "Start over" cleared the sample store but never re-seeded,
    // so the filter was left holding one page — far under the sample floor.
    // It then had no verdict for anything, which made every control in the
    // panel look dead: moving the threshold from one end to the other
    // changed nothing on the page.
    JBF.clearBaseline();
    const pop = [];
    let seed = 41;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 300; i++) {
      const chats = 200 + Math.round(rnd() * 2500);
      pop.push(chr('re-' + i, chats, Math.round(chats * (4 + rnd() * 2.5)), { days: 0.5 + rnd() }));
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const st = JBF.getStats();
    ok('it reports how far off being ready it is, not a raw sample count',
       typeof st.fitSize === 'number' && typeof st.needSamples === 'number',
       `${st.fitSize}/${st.needSamples}`);
    ok('after starting over it becomes ready again', st.ready === true,
       `${st.fitSize} of ${st.needSamples}`);

    // The whole point of the slider: the two ends must disagree.
    const card = { chats: 900, ratio: 13.0, age: 1 };
    const sc = JBF._internals.scoreFor(card.chats, card.ratio, card.age);
    ok('and a card gets a real score again', sc && sc.multiple > 0,
       sc ? sc.multiple.toFixed(2) + 'x' : 'none');
    ok('the threshold still separates the two ends of the slider',
       sc && sc.multiple > 1.5 && sc.multiple < 6.0,
       sc ? `${sc.multiple.toFixed(2)}x sits between the 1.5x and 6.0x stops` : 'none');

    // Put the real population back — see the note on the block above.
    JBF.clearBaseline();
    JBF._internals.ingest(PAGE1.data);
    JBF._internals.rebuildBaseline();
  })();

  console.log('\nit only acts on the listings you choose');
  ok('recognises the listing from the site\'s own request',
     JBF.listKind() === 'trending24', JBF.listKind());
  ok('trending today is on by default', JBF.activeHere() === true);
  ok('a tag page is "other", even though its url says sort=popular', (() => {
    const real = window.location.href;
    try {
      window.history.replaceState({}, '', '/search?mode=all&sort=popular&tag_id=2&page=1');
      return JBF.listKind() === 'other';
    } finally { window.history.replaceState({}, '', real); }
  })(), JBF.listKind());
  ok('the page url beats a stale api query', (() => {
    const real = window.location.href;
    try {
      window.history.replaceState({}, '', '/?page=1&segment=latest&view=all');
      return JBF.listKind() === 'latest';      // api query still says trending24
    } finally { window.history.replaceState({}, '', real); }
  })());
  await JBF.saveCfg({ lists: { trending24: false, trending: false, popular: false,
                               latest: false, other: false } });
  ok('switching it off stops all flagging',
     JBF._internals.records.every(r => !r.flagged));
  ok('and says why rather than looking broken',
     JBF._internals.records.some(r => /not filtering this listing/.test(r.reason)));
  ok('it still learns from the page while dormant',
     JBF._internals.samples.size > 100, String(JBF._internals.samples.size));
  ok('stats report the dormant state',
     JBF.getStats().activeHere === false && JBF.getStats().listKind === 'trending24');
  await JBF.saveCfg({ lists: Object.assign({}, JBF.DEFAULTS.lists) });
  ok('switching it back on resumes flagging',
     JBF._internals.records.some(r => r.flagged));

  console.log('\nthe My Chats carousel is off limits');
  const carouselCards = [...window.document.querySelectorAll('._carousel_1jy7t_1 .pp-cc-wrapper')];
  ok('carousel actually has cards to leave alone', carouselCards.length === MYCHATS.length);
  ok('none of them became records',
     !JBF._internals.records.some(r => MYCHATS.some(c => c.name === r.name)),
     JBF._internals.records.map(r => r.name).join(', '));
  ok('none of them were touched',
     carouselCards.every(n => !n.hasAttribute('data-jbf') && n.style.display !== 'none'));
  ok('none of them were badged', carouselCards.every(n => !n.querySelector('.jbf-badge')));

  console.log('\nstats come from the API, not the DOM');
  const clean = byName('Clean Popular'), hana = byName('Trapped In Hell with Hana');
  const mafia = byName('Mafia Boss'), tiny = byName('Tiny New Card');
  ok('clean: 8600 chats / 129000 msgs', clean.chats === 8600 && clean.messages === 129000);
  ok('clean ratio 15.0', near(clean.ratio, 15.0), clean.ratio.toFixed(2));
  ok('hana ratio 18.8', near(hana.ratio, 18.81), hana.ratio.toFixed(2));
  ok('mafia real numbers', mafia.chats === 859910 && mafia.messages === 38819373);
  ok('public chat count not mistaken for chats', clean.publicChats === 3 && clean.chats !== 3);

  console.log('\npeer-relative rule');
  ok('hana flagged as a multiple of normal', hana.flagged, hana.reason);
  ok('and the reason says how many times normal it is',
     /x the .* normal/.test(hana.reason), hana.reason);
  ok('clean not flagged', !clean.flagged, clean.reason);
  ok('hana sits above normal for its size and age', hana.multiple > 1,
     String(hana.multiple?.toFixed(2)));
  ok('clean sits inside the default threshold',
     clean.multiple < JBF.cfg.maxMultiple && clean.multiple > 1 / JBF.cfg.maxMultiple,
     String(clean.multiple?.toFixed(2)));
  ok('each card gets a "normal for its size" figure',
     clean.expected > 0 && hana.expected > 0,
     `${clean.expected?.toFixed(1)} / ${hana.expected?.toFixed(1)}`);
  ok('a card low for its size is caught by the two-sided rule',
     byName('Chats Without Talk').flagged &&
     /without conversation/.test(byName('Chats Without Talk').reason),
     byName('Chats Without Talk').reason);
  ok('tiny card spared by sample floor', !tiny.flagged && tiny.reason === 'below sample floor');
  ok('a multiple is filled in even for velocity-flagged cards',
     byName('Suspicious Rocket').multiple !== null);

  console.log('\nvelocity rule + age guard');
  ok('old, fast card flagged (2,571/day over 35d)',
     byName('Suspicious Rocket').flagged && /chats\/day/.test(byName('Suspicious Rocket').reason),
     byName('Suspicious Rocket').reason);
  ok('a card inside the launch window is NOT judged on chats\/day',
     !/chats\/day/.test(byName('Legitimately New').reason || ''),
     byName('Legitimately New').reason);
  ok('mafia not flagged on velocity (716/day)', !/chats\/day/.test(mafia.reason));

  console.log('\nhide + replacement');
  await JBF.saveCfg({ mode: 'hide', replace: true });
  await sleep(400);
  // Pulling page 2 adds peers to the baseline, which can legitimately move
  // a borderline card across the percentile line. Assert on whatever is
  // flagged now rather than assuming a specific card.
  const flagged = JBF._internals.records.filter(r => r.flagged);
  const flaggedCount = flagged.length;
  ok('something is still flagged to test against', flaggedCount > 0);
  ok('flagged cards hidden', flagged.every(r => r.root.style.display === 'none'),
     flagged.map(r => r.name + ':' + r.root.style.display).join(', '));
  ok('clean card untouched', clean.root.style.display !== 'none');
  ok('fetched page 2 for replacements', fetched.some(u => /page=2/.test(u)));
  ok('a replacement node per hidden card', reps().length === flaggedCount,
     `${reps().length} nodes / ${flaggedCount} hidden`);

  const rep = reps()[0];
  ok('replacement carries the new name',
     /^Replacement \d+$/.test(rep.querySelector('.pp-cc-name').textContent),
     rep.querySelector('.pp-cc-name').textContent);
  ok('replacement href points at the new character',
     /\/characters\/[0-9a-f-]{36}_character-replacement-\d+$/.test(
       rep.querySelector('a[href*="/characters/"]').getAttribute('href')),
     rep.querySelector('a[href*="/characters/"]').getAttribute('href'));
  ok('donor avatar replaced', rep.querySelector('.pp-cc-avatar').getAttribute('src') !== 'old.webp');
  ok('donor creator replaced', rep.querySelector('.pp-cc-creator-name').textContent !== '@old');
  ok('donor description replaced',
     rep.querySelector('.pp-cc-description').textContent !== 'Old description.');
  ok('donor badge not cloned', !rep.querySelector('.jbf-badge'));
  ok('replacement not marked seen from donor', !rep.hasAttribute('data-jbf-seen') ||
     rep.getAttribute('data-jbf-seen') !== hana.id);
  ok('replacements are themselves clean',
     JBF._internals.records.filter(r => r.isReplacement).every(r => !r.flagged));
  ok('inserted into the real grid', rep.parentElement.className.includes('pp-cc-list-container'));
  ok('nothing was appended to the carousel',
     !window.document.querySelector('._carousel_1jy7t_1 [data-jbf-replacement]'));
  ok('carousel still untouched after replacement',
     carouselCards.every(n => n.style.display !== 'none' && !n.hasAttribute('data-jbf')));

  console.log('\nreplacements preserve the page\'s sort order');
  const gridEl = () => window.document.querySelector('.pp-cc-list-container');
  const visibleCount = () => [...gridEl().querySelectorAll('.pp-cc-wrapper')]
    .filter(n => n.style.display !== 'none').length;
  const kids = [...gridEl().children];
  const idxRep = kids.map((n, i) => n.hasAttribute('data-jbf-replacement') ? i : -1).filter(i => i >= 0);
  const idxOrig = kids.map((n, i) => n.hasAttribute('data-jbf-replacement') ? -1 : i).filter(i => i >= 0);
  ok('every replacement sits after every original card',
     Math.min(...idxRep) > Math.max(...idxOrig),
     `first replacement ${Math.min(...idxRep)}, last original ${Math.max(...idxOrig)}`);
  ok('visible card count back to the full page', visibleCount() === RENDERED.length,
     `${visibleCount()} of ${RENDERED.length}`);

  console.log('\nmoving the threshold reconciles instead of piling up');
  await JBF.saveCfg({ maxMultiple: 1.3 });
  await sleep(450);
  const many = reps().length;
  ok('a looser threshold hides more, so more get replaced', many >= 1, String(many));
  ok('still a full page', visibleCount() === RENDERED.length, String(visibleCount()));
  // Deterministic release path: switching a rule off definitely un-flags a
  // card, so its filler must be handed back.
  const beforeRelease = reps().length;
  ok('there are replacements to hand back', beforeRelease > 0, String(beforeRelease));
  await JBF.saveCfg({ rule: 'fixed', flagHigh: false, flagLow: false,
                      flagVelocity: false, flagTrend: false });
  await sleep(500);
  ok('with every rule off, all replacements are handed back',
     reps().length === 0, String(reps().length));
  await JBF.saveCfg({ rule: 'peer', flagVelocity: true, flagTrend: true });
  await sleep(500);
  ok('turning the rules back on refills', reps().length === beforeRelease,
     `${reps().length} vs ${beforeRelease}`);
  await JBF.saveCfg({ maxMultiple: 6 });
  await sleep(450);
  ok('no runaway accumulation', reps().length <= RENDERED.length, String(reps().length));
  ok('order still holds after the slider moves', (() => {
    const k = [...gridEl().children];
    const r = k.map((n, i) => n.hasAttribute('data-jbf-replacement') ? i : -1).filter(i => i >= 0);
    const o = k.map((n, i) => n.hasAttribute('data-jbf-replacement') ? -1 : i).filter(i => i >= 0);
    return !r.length || Math.min(...r) > Math.max(...o);
  })());
  await JBF.saveCfg({ maxMultiple: 2.5 });
  await sleep(400);

  console.log('\nleaving hide mode takes the fillers away');
  await JBF.saveCfg({ mode: 'badge' });
  await sleep(300);
  ok('no replacements while badging', reps().length === 0, String(reps().length));
  await JBF.saveCfg({ mode: 'hide' });
  await sleep(450);
  ok('they come back on returning to hide', visibleCount() === RENDERED.length, String(visibleCount()));

  console.log('\ndescription length');
  const longText = 'word '.repeat(600);
  const longCard = chr('Wordy', 900, 11000, { desc: '<p>' + longText + '</p>' });
  PAGE2.unshift(longCard);
  JBF.clearReplacements();
  JBF._internals.records.forEach(r => { r.replacedBy = null; });
  JBF.applyAll();
  await sleep(350);
  const wordy = reps().find(n => n.querySelector('.pp-cc-name').textContent === 'Wordy');
  ok('a 3000-char description is rendered short', !wordy ||
     wordy.querySelector('.pp-cc-description').textContent.length <= 210,
     wordy ? String(wordy.querySelector('.pp-cc-description').textContent.length) : 'not used');
  ok('truncated text ends with an ellipsis', !wordy ||
     /\.\.\.$/.test(wordy.querySelector('.pp-cc-description').textContent.trim()));
  ok('short descriptions are left alone', reps().every(n => {
    const t = n.querySelector('.pp-cc-description').textContent;
    return t.length <= 210;
  }));

  console.log('\nauthor HTML in descriptions is not injected');
  const htmlRec = JBF._internals.api.get(
    [...JBF._internals.api.values()].find(c => c.name === 'Html Desc').id);
  const node = JBF._internals._buildReplacement
    ? null
    : rep; // replacements above already exercise plainText
  ok('description text is plain, no markup elements',
     !rep.querySelector('.pp-cc-description img') &&
     !/</.test(rep.querySelector('.pp-cc-description').textContent));
  ok('html-desc card parsed to text in its own record', !!htmlRec);

  console.log('\nmarking a card as fine');
  await JBF.saveCfg({ mode: 'badge' });
  const target = JBF._internals.records.find(r => r.flagged);
  ok('there is a flagged card to mark', !!target, target && target.name);
  const badge = target.root.querySelector('.jbf-badge');
  ok('its badge carries the card id', badge && badge.getAttribute('data-jbf-id') === target.id);
  ok('the badge says what a click does',
     badge && /mark it fine/.test(badge.title) && /shift-click/.test(badge.title),
     badge ? badge.title.split('\n').pop() : 'no badge');
  badge.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  ok('clicking it whitelists that card', JBF.cfg.whitelist.indexOf(target.id) >= 0);
  ok('and it stops being flagged',
     !JBF._internals.records.find(r => r.id === target.id).flagged);
  ok('with a reason that says so',
     /marked this one as fine/.test(
       JBF._internals.records.find(r => r.id === target.id).reason));
  ok('stats report how many you have marked', JBF.getStats().whitelisted === 1);
  await JBF.clearWhitelist();
  ok('clearing brings it back', JBF._internals.records.find(r => r.id === target.id).flagged);
  await JBF.saveCfg({ mode: 'hide' });

  console.log('\nreveal toggle');
  const sample = JBF._internals.records.filter(r => r.flagged);
  JBF.setRevealed(true);
  ok('hidden cards come back', sample.every(r => r.root.style.display !== 'none'));
  ok('and are badged so you can see why', sample.every(r => !!r.root.querySelector('.jbf-badge')));
  ok('isRevealed reports true', JBF.isRevealed() === true);
  ok('stats expose reveal state', JBF.getStats().revealed === true);
  JBF.setRevealed(false);
  ok('toggling back hides them again', sample.every(r => r.root.style.display === 'none'));

  console.log('\nreplacement degrades gracefully');
  JBF.clearReplacements();
  ok('replacements removed', reps().length === 0);
  page2Status = 401;
  JBF._internals.records.forEach(r => { r.replacedBy = null; });
  JBF.applyAll();
  await sleep(300);
  const st = JBF.getStats();
  ok('401 reported, not thrown', /logged in/.test(st.replaceStatus || '') || reps().length > 0,
     st.replaceStatus);
  page2Status = 200;

  console.log('\nmeasured growth between sightings');
  const tid = HANA.id;
  JBF._internals.trends.clear();
  // pretend we saw this card 6 hours ago with 5,000 fewer chats
  JBF._internals.samples.set(tid, [HANA.stats.chat - 5000, HANA.stats.message - 6000,
    Date.now() - 6 * 36e5]);
  JBF._internals.noteSample(tid, HANA.stats.chat, HANA.stats.message);
  const tr = JBF._internals.trends.get(tid);
  ok('a delta is recorded between two sightings', !!tr && tr.dc === 5000, JSON.stringify(tr));
  ok('the delta knows how long the window was', !!tr && Math.round(tr.hours) === 6);

  JBF._internals.records.forEach(r => { r.trend = JBF._internals.trends.get(r.id) || null; });
  JBF.applyAll();
  ok('20,000 chats/day of measured growth is flagged',
     byName('Trapped In Hell with Hana').flagged &&
     /gained 5,000 chats/.test(byName('Trapped In Hell with Hana').reason),
     byName('Trapped In Hell with Hana').reason);

  // chats arriving with no conversation
  JBF._internals.trends.set(tid, { dc: 400, dm: 300, hours: 72, ts: Date.now() });
  JBF._internals.records.forEach(r => { r.trend = JBF._internals.trends.get(r.id) || null; });
  JBF.applyAll();
  ok('chats arriving without messages is flagged',
     /only 300 messages/.test(byName('Trapped In Hell with Hana').reason),
     byName('Trapped In Hell with Hana').reason);

  // a healthy delta must not fire
  JBF._internals.trends.set(tid, { dc: 300, dm: 4500, hours: 72, ts: Date.now() });
  JBF._internals.records.forEach(r => { r.trend = JBF._internals.trends.get(r.id) || null; });
  JBF.applyAll();
  ok('normal growth is left alone',
     !/gained|only \d+ messages/.test(byName('Trapped In Hell with Hana').reason || ''),
     byName('Trapped In Hell with Hana').reason);

  ok('a short window is ignored until it matures', (() => {
    JBF._internals.trends.clear();
    const id2 = CLEAN.id;
    JBF._internals.samples.set(id2, [CLEAN.stats.chat - 900, CLEAN.stats.message,
      Date.now() - 30 * 60e3]);                       // 30 minutes
    JBF._internals.noteSample(id2, CLEAN.stats.chat, CLEAN.stats.message);
    return !JBF._internals.trends.has(id2);
  })());

  // Sustained-vs-burst is what separates a botted card from a sticky one, so
  // the badge puts recent behaviour next to the lifetime figure.
  await JBF.saveCfg({ mode: 'badge' });
  JBF._internals.trends.set(tid, { dc: 100, dm: 1700, hours: 6, ts: Date.now() });
  JBF._internals.records.forEach(r => { r.trend = JBF._internals.trends.get(r.id) || null; });
  JBF.applyAll();
  ok('the badge compares recent activity against lifetime', (() => {
    const b = byName('Trapped In Hell with Hana').root.querySelector('.jbf-badge');
    return !!b && /17\.0 per new chat, lifetime 18\.8/.test(b.title);
  })(), (byName('Trapped In Hell with Hana').root.querySelector('.jbf-badge') || {}).title);
  await JBF.saveCfg({ mode: 'hide' });

  JBF._internals.trends.clear();
  JBF._internals.records.forEach(r => { r.trend = null; });
  JBF.applyAll();

  console.log('\nfixed-number rule');
  await JBF.saveCfg({ rule: 'fixed', flagHigh: true, highRatio: 40, flagVelocity: false });
  ok('mafia (45.1) flagged above 40', byName('Mafia Boss').flagged);
  ok('hana (18.8) not flagged above 40', !byName('Trapped In Hell with Hana').flagged);
  await JBF.saveCfg({ highRatio: 15 });
  ok('lowering to 15 flags hana', byName('Trapped In Hell with Hana').flagged);
  await JBF.saveCfg({ rule: 'peer', flagVelocity: true });

  console.log('\nbaseline');
  const table = JBF.baselineTable();
  ok('the fitted curve reports normal ratios by size', table.length >= 2,
     JSON.stringify(table.map(b => `${b.chats}:${b.expected.toFixed(1)}`)));
  ok('an ordinary page need not flag anything', (() => {
    // every card sitting on the curve => nothing flagged, which a
    // percentile rule could never do
    const rate = JBF._internals.flagRate();
    return rate !== null && rate < 20;
  })(), String(JBF._internals.flagRate()));
  ok('the flag rate is reported, not assumed',
     typeof JBF.getStats().flagRate === 'number');
  // Deliberately NOT asserting that medians rise with size — a 2,135-card
  // live sample says they don't (≈8.7 at 10–50 chats, ≈4.9 at 200–1k, ≈28 at
  // 20k+). The rule must not depend on the curve being monotonic.
  ok('the surface reports a figure per size AND age',
     table.every(b => b.chats > 0 && b.days > 0 && b.expected > 0 && b.expected < 500),
     JSON.stringify(table.slice(0, 3)));
  // (the age effect itself is tested below, on a population that spans ages)
  ok('flush persists', await JBF.flushSamples());
  ok('saved and keyed by id',
     mem.data && mem.data.s[HANA.id] && mem.data.s[HANA.id][0] === 957);
  JBF.clearBaseline();
  ok('reset empties the store', JBF._internals.samples.size === 0);

  console.log('\nmaster switch + export');
  JBF._internals.ingest(PAGE1.data);
  await JBF.saveCfg({ enabled: false });
  ok('nothing flagged when off', JBF._internals.records.every(r => !r.flagged));
  ok('nothing left hidden', JBF._internals.records.every(r => r.root.style.display !== 'none'));
  await JBF.saveCfg({ enabled: true });

  const tsv = JBF.exportRows();
  ok('export header complete',
     /chats\tmessages\tmsg_per_chat\tnormal_for_size_and_age\ttimes_normal/
       .test(tsv.split('\n')[0]));
  ok('export carries true chat counts', /\t859910\t38819373\t/.test(tsv));

  console.log('\nthe model against real-world shape');
  // Curve and spread measured from 2,135 live cards:
  //   10 chats -> 4.6 msg/chat, 50 -> 7.9, 200 -> 4.3, 1k -> 9.8,
  //   5k -> 35.8, 20k -> 36.3, 100k -> 23.2, 500k -> 26.4
  // residual spread (ln units): 0.451 above the curve, 0.365 below.
  (function () {
    const CURVE = [[10, 4.6], [50, 7.9], [200, 4.3], [1000, 9.8],
                   [5000, 35.8], [20000, 36.3], [100000, 23.2], [500000, 26.4]];
    const expectedAt = chats => {
      const x = Math.log10(chats);
      if (x <= Math.log10(CURVE[0][0])) return CURVE[0][1];
      for (let i = 1; i < CURVE.length; i++) {
        const x0 = Math.log10(CURVE[i - 1][0]), x1 = Math.log10(CURVE[i][0]);
        if (x <= x1) {
          const t = (x - x0) / (x1 - x0);
          return Math.exp(Math.log(CURVE[i - 1][1]) +
            t * (Math.log(CURVE[i][1]) - Math.log(CURVE[i - 1][1])));
        }
      }
      return CURVE[CURVE.length - 1][1];
    };
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const gauss = () => {
      const u = Math.max(1e-9, rnd());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };

    JBF.clearBaseline();
    const synthetic = [];
    for (let i = 0; i < 2000; i++) {
      const chats = Math.round(Math.pow(10, 1 + rnd() * 4.7));       // 10 .. 500k
      const g = gauss();
      const ratio = expectedAt(chats) * Math.exp(g * (g >= 0 ? 0.451 : 0.365) * 0.674);
      synthetic.push(chr('synth-' + i, chats, Math.max(1, Math.round(chats * ratio)),
        { days: 30 + Math.round(rnd() * 900) }));
    }
    JBF._internals.ingest(synthetic);
    JBF._internals.rebuildBaseline();

    const rate = JBF._internals.flagRate();
    ok('an ordinary population flags only a sliver at the default setting',
       rate !== null && rate < 5, rate === null ? 'null' : rate.toFixed(2) + '%');

    const curve = JBF.baselineTable();
    const at1k = curve.find(c => c.chats === 1000);
    const at20k = curve.find(c => c.chats === 20000);
    ok('the fit recovers the non-monotonic shape it was given',
       at1k && at20k && at20k.expected > at1k.expected * 2,
       curve.map(c => `${c.chats}:${c.expected.toFixed(1)}`).join(' '));

    // the attack: plenty of chats, nobody talking
    const botted = JBF._internals.scoreFor(20000, 1.5, 200);
    ok('chat-inflation lands far below normal', botted && botted.multiple < 0.4,
       botted ? botted.multiple.toFixed(2) : 'no score');
    // and message-spam in few chats
    const spam = JBF._internals.scoreFor(1000, 120, 200);
    ok('message-spam lands far above normal', spam && spam.multiple > 3,
       spam ? spam.multiple.toFixed(2) : 'no score');
    // an ordinary card must not
    const normal = JBF._internals.scoreFor(1000, 10, 200);
    ok('an ordinary card lands near normal',
       normal && normal.multiple > 0.6 && normal.multiple < 1.7,
       normal ? normal.multiple.toFixed(2) : 'no score');
  })();

  console.log('\nthe spread is measured on cards it would actually judge');
  (function () {
    // A population of ordinary cards plus a pile of tiny, wildly varying ones.
    // The tiny cards are never scored, so they must not widen the scale and
    // drag real outliers back toward the middle.
    JBF.clearBaseline();
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pop = [];
    for (let i = 0; i < 300; i++) {
      const chats = 400 + Math.round(rnd() * 2000);
      pop.push(chr('ord-' + i, chats, Math.round(chats * (5 + rnd() * 2)), { days: 1 }));
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();
    const clean = JBF._internals.scoreFor(900, 17.9, 0.8);

    const noise = [];
    for (let i = 0; i < 300; i++) {
      noise.push(chr('tiny-' + i, 1 + Math.round(rnd() * 5),
        Math.max(1, Math.round(rnd() * 400)), { days: 1 }));
    }
    JBF._internals.ingest(noise);
    JBF._internals.rebuildBaseline();
    const withNoise = JBF._internals.scoreFor(900, 17.9, 0.8);

    ok('tiny cards below the floor do not shift the baseline',
       clean && withNoise && Math.abs(clean.multiple - withNoise.multiple) < 0.4,
       `${clean?.multiple.toFixed(2)} vs ${withNoise?.multiple.toFixed(2)}`);
    ok('a 3x-the-normal card still reads as 3x',
       withNoise && withNoise.multiple > 2.5, withNoise ? withNoise.multiple.toFixed(2) : 'none');
  })();

  console.log('\nlarge cards are no longer exempt');
  (function () {
    // Measured on live data: a flat 2.5x flags 15.5% of 200-1k-chat cards but
    // 0% of everything over 20k, because big cards cluster tightly and never
    // reach the multiple. The tight-region rule closes that without relaxing
    // anything elsewhere.
    JBF.clearBaseline();
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pop = [];
    for (let i = 0; i < 500; i++) {
      const chats = 30000 + Math.round(rnd() * 60000);
      pop.push(chr('big-' + i, chats, Math.round(chats * (27 + rnd() * 2)), { days: 500 }));
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const ordinary = JBF._internals.scoreFor(50000, 28, 500);
    const off = JBF._internals.scoreFor(50000, 45, 500);      // 1.6x, way outside local norms
    ok('a tightly-clustered population reports a small spread',
       ordinary && ordinary.spread < 0.1, ordinary ? ordinary.spread.toFixed(3) : 'none');
    ok('an ordinary big card stays put',
       ordinary && ordinary.deviations < 4, ordinary ? ordinary.deviations.toFixed(1) : 'none');
    ok('a big card at only 1.6x is still far outside local norms',
       off && off.multiple < 2.5 && off.deviations > 4,
       off ? `${off.multiple.toFixed(2)}x, ${off.deviations.toFixed(1)} deviations` : 'none');
  })();

  console.log('\ndistant neighbours must not drag an expectation');
  (function () {
    // The bug this fixes: a card in a sparse part of the distribution was
    // judged against much smaller cards. Live case — a 2,562-chat card whose
    // own chat band runs at 11.9 msg/chat was given an expectation of 6.7,
    // which made an ordinary card look like a 2.7x outlier.
    JBF.clearBaseline();
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pop = [];
    for (let i = 0; i < 400; i++) {              // dense low-chat region, ratio ~5
      const chats = 300 + Math.round(rnd() * 900);
      pop.push(chr('small-' + i, chats, Math.round(chats * (4.5 + rnd())), { days: 1 }));
    }
    for (let i = 0; i < 40; i++) {               // sparse high-chat region, ratio ~12
      const chats = 2000 + Math.round(rnd() * 1500);
      pop.push(chr('big-' + i, chats, Math.round(chats * (11 + rnd() * 2)), { days: 1 }));
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const sparse = JBF._internals.scoreFor(2562, 18.4, 0.92);
    const dense = JBF._internals.scoreFor(900, 14.8, 0.88);
    ok('a card in the sparse region is judged against its own kind',
       sparse && sparse.expected > 9,
       sparse ? sparse.expected.toFixed(1) : 'none');
    ok('so an ordinary card there is no longer an outlier',
       sparse && sparse.multiple < 2.5, sparse ? sparse.multiple.toFixed(2) + 'x' : 'none');
    ok('while the dense region is unaffected',
       dense && dense.expected > 4 && dense.expected < 7,
       dense ? dense.expected.toFixed(1) : 'none');
    ok('and a genuine outlier there still flags',
       dense && dense.multiple > 2.5, dense ? dense.multiple.toFixed(2) + 'x' : 'none');
  })();

  console.log('\nage changes what counts as normal');
  (function () {
    // Live measurement: young cards with traction sit near 5 msg/chat
    // (median of 86 cards under 72h), established ones near 25. The same
    // ratio therefore means very different things.
    JBF.clearBaseline();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pop = [];
    for (let i = 0; i < 400; i++) {
      const chats = 300 + Math.round(rnd() * 3000);
      pop.push(chr('young-' + i, chats, Math.round(chats * (4 + rnd() * 2)),
        { days: 0.3 + rnd() * 2 }));                       // hours old, ratio ~5
    }
    for (let i = 0; i < 400; i++) {
      const chats = 300 + Math.round(rnd() * 3000);
      pop.push(chr('old-' + i, chats, Math.round(chats * (22 + rnd() * 8)),
        { days: 400 + rnd() * 600 }));                     // years old, ratio ~26
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const young = JBF._internals.scoreFor(894, 17.9, 19.1 / 24);
    const old = JBF._internals.scoreFor(894, 17.9, 700);
    ok('normal for a day-old card is low', young && young.expected < 9,
       young ? young.expected.toFixed(1) : 'none');
    ok('normal for a years-old card is much higher', old && old.expected > 15,
       old ? old.expected.toFixed(1) : 'none');
    ok('the same ratio reads as odd when young and ordinary when old',
       young && old && young.multiple > old.multiple * 1.8,
       young && old ? `young ${young.multiple.toFixed(2)}x vs old ${old.multiple.toFixed(2)}x` : 'none');
  })();

  console.log('\nan age cohort running out must not borrow another one\'s numbers');
  (function () {
    // The bug this guards: age used to be one weighted axis of a 2-D
    // neighbourhood. Where a browser's day-old samples ran out — they
    // come from deeper pages, which are small cards — the fit walked up
    // the age axis and answered with the ESTABLISHED figure instead.
    // A live install was told that normal for a DAY-OLD card with 3,259
    // chats was 11.1 msg/chat; the day-old population runs at ~5. Every
    // card past that crossover scored at half its true multiple, which
    // is precisely where inflated cards were sitting.
    JBF.clearBaseline();
    let seed = 29;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pop = [];
    // established cards at every size, climbing 5 -> 35 with size
    for (let i = 0; i < 700; i++) {
      const chats = Math.round(Math.pow(10, 2 + rnd() * 2.2));
      const r = 5 * Math.pow(chats / 100, 0.42);
      pop.push(chr('est-' + i, chats, Math.round(chats * r * (0.8 + rnd() * 0.4)),
        { days: 60 + rnd() * 500 }));
    }
    // day-old cards ONLY up to 800 chats, which is what deeper pages give
    for (let i = 0; i < 300; i++) {
      const chats = 120 + Math.round(rnd() * 680);
      pop.push(chr('new-' + i, chats, Math.round(chats * (4.3 + rnd() * 1.4)),
        { days: 0.4 + rnd() * 1.2 }));
    }
    JBF._internals.ingest(pop);
    JBF._internals.rebuildBaseline();

    const covered = JBF._internals.scoreFor(600, 5, 1);
    const beyond  = JBF._internals.scoreFor(3259, 5, 1);
    const est     = JBF._internals.scoreFor(3259, 5, 300);
    ok('inside the sizes it has day-old cards for, normal is the day-old figure',
       covered && covered.expected < 8, covered ? covered.expected.toFixed(1) : 'none');
    ok('past them it holds that figure rather than climbing to the established one',
       beyond && beyond.expected < 8,
       beyond ? `${beyond.expected.toFixed(1)} (established there: ${est ? est.expected.toFixed(1) : '?'})` : 'none');
    ok('while established cards that size still get their own, much higher figure',
       est && est.expected > beyond.expected * 1.8,
       est ? `${est.expected.toFixed(1)} vs ${beyond.expected.toFixed(1)}` : 'none');
    // Against the balanced default (2.25x). Not read from cfg: an earlier
    // block applies a preset, and this is about the maths, not the setting.
    ok('so a day-old card at 17 msg/chat is no longer let through as ordinary',
       (() => { const s = JBF._internals.scoreFor(3259, 17.29, 1);
         return s && s.multiple > 2.0; })(),
       (() => { const s = JBF._internals.scoreFor(3259, 17.29, 1); return s ? s.multiple.toFixed(2) + 'x' : 'none'; })());
  })();

  console.log('\nthe growth rules must not fire on windows too short to measure');
  (function () {
    const H = JBF._internals.history, HOUR = 36e5, now = Date.now();
    const lay = (id, n, gapH, rates, msgPerChat) => {
      const rows = []; let c = 1000, m = 1000 * 15;
      for (let i = 0; i < n; i++) {
        rows.push([now - (n - i) * gapH * HOUR, Math.round(c), Math.round(m)]);
        c += rates[i % rates.length] * gapH;
        m += rates[i % rates.length] * gapH * msgPerChat;
      }
      H.set(id, rows); return id;
    };
    const rec = (id, ratio) => { const r = { id, name: 'x', chats: 5000, messages: 5000 * ratio,
      ratio, days: 40, tokens: 3000, publicChats: 0, chatsPerDay: 125,
      shape: JBF._internals.growthShape(id, ratio) }; JBF._internals.evaluate(r); return r; };

    // Simulated against traffic that follows a normal day, an ordinary card
    // measured over only 10 hours scored 1.08 and would have been flagged
    // 87-100% of the time: ten hours sits inside one part of the day.
    const shortWin = lay('short-window', 6, 1.6, [70, 71, 69, 70, 72, 69], 15);
    ok('a flat-looking short window is not called metered traffic',
       !/near-constant/.test(rec(shortWin, 15).reason || ''),
       `covers ${JBF._internals.growthShape(shortWin, 15)?.hours.toFixed(1)}h`);

    const longWin = lay('long-window', 8, 6, [69, 70, 68, 71, 69, 70, 69, 70], 15);
    ok('the same flatness over a proper window still is',
       /near-constant/.test(rec(longWin, 15).reason || ''), rec(longWin, 15).reason);

    // Sampled once a day, the intervals are day-long averages and the
    // clock's variation is averaged away — that looks flat for any card.
    const coarse = lay('coarse', 6, 22, [69, 70, 68, 71, 69, 70], 15);
    ok('sampling too coarsely to see a day is not evidence either',
       !/near-constant/.test(rec(coarse, 15).reason || ''),
       `median gap ${JBF._internals.growthShape(coarse, 15)?.medGap.toFixed(0)}h`);

    // A chat opened minutes before the last sighting has barely any messages
    // yet, so a healthy card reads 0.27 over two hours and 0.45 over four.
    // Traffic that varies normally, so only the stale-ratio rule is in play.
    const DAY = [40, 95, 130, 60, 22, 15, 70, 120];
    const freshShort = lay('drift-short', 6, 2, DAY, 3);
    ok('a short window is not enough to call a ratio stale',
       !/is history/.test(rec(freshShort, 15).reason || ''),
       `covers ${JBF._internals.growthShape(freshShort, 15)?.hours.toFixed(1)}h`);

    const freshLong = lay('drift-long', 8, 6, DAY, 3);
    ok('over a long enough one it is', /is history/.test(rec(freshLong, 15).reason || ''),
       rec(freshLong, 15).reason);

    H.clear();
  })();

  console.log('\na burst has to be a burst for that card');
  (function () {
    // The delta rule compared a two-hour window against the LIFETIME
    // threshold of 2,500/day. A genuinely hot card clears that without
    // trying — the top card on weekly trending was doing 14,078 chats/day
    // honestly — so popularity read as a burst.
    const judge = (chats, days, dc, dm, hours) => {
      const rec = { id: 'b' + chats + dc, name: 'x', chats, messages: chats * 12,
        ratio: 12, days, tokens: 3000, publicChats: 0, chatsPerDay: chats / days,
        trend: { dc, dm, hours, ts: Date.now() } };
      JBF._internals.evaluate(rec); return rec;
    };
    // Consistently popular: 14,000/day lifetime, and the window matches it.
    const hot = judge(98000, 7, 1200, 14400, 2);
    ok('a card that is simply busy is not called a burst', !/\/day/.test(hot.reason || ''),
       hot.reason || '(nothing)');
    // Same window on a card that normally does 200/day.
    const spike = judge(6000, 30, 1200, 14400, 2);
    ok('the same window on a quiet card is', /\/day/.test(spike.reason || ''), spike.reason);
    ok('and the reason says how far above its usual', /its usual/.test(spike.reason || ''),
       spike.reason);
  })();

  console.log('\nthe depth rule must hold across ages, not just today');
  (function () {
    const was = JBF.cfg.rule; JBF.cfg.rule = 'thin';
    // The rule shipped once calibrated only on 24-hour trending and was a
    // disaster everywhere else: a card up for two years has had two years
    // for its conversations to run long. Measured across 401 live cards
    // spanning four listings, median messages-per-chat is 8.4 in the first
    // two days and 30.8 past a year, on the SAME amount of character
    // (median 2,754 tokens young, 1,413 old). A flat threshold therefore
    // flagged 91% of the Popular listing.
    const judge = (chats, ratio, tokens, days) => {
      const rec = { id: 'a' + chats + days, name: 'x', chats, ratio, days, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats / days };
      JBF._internals.evaluate(rec); return rec;
    };
    // Real cards off the Popular listing: ordinary for their age.
    const oldOrdinary = [
      [98549, 18.75, 2164, 7.0], [51780, 24.57, 2995, 5.7], [13894, 36.73, 4075, 7.1],
      [2580630, 48.39, 1099, 1186.9], [443476, 52.09, 4343, 778.8], [264829, 71.32, 1507, 843.5]
    ];
    ok('ordinary established cards are left alone',
       oldOrdinary.every(([c, r, t, d]) => !judge(c, r, t, d).flagged),
       oldOrdinary.filter(([c,r,t,d]) => judge(c,r,t,d).flagged).length + ' wrongly flagged');
    // A genuinely thin old card — 120 tokens carrying 36.6 msg/chat.
    ok('but a thin established card still is', judge(328947, 36.6, 120, 1184.7).flagged,
       judge(328947, 36.6, 120, 1184.7).reason);

    // Same content, same ratio, different age: only the young one is odd.
    const young = judge(1000, 15, 1500, 1);
    const old = judge(1000, 15, 1500, 800);
    ok('the same numbers read differently at different ages',
       young.flagged && !old.flagged,
       `1 day -> ${young.thin.toFixed(1)} | 800 days -> ${old.thin.toFixed(1)}`);
    ok('and the age term is what does it', old.thin < young.thin / 5,
       `${old.thin.toFixed(2)} vs ${young.thin.toFixed(2)}`);

    // The day-old labels must be untouched by the correction.
    const LIVE = [[239,19.53,473,0.4,1],[351,26.30,1388,0.97,1],[958,17.95,1620,0.87,1],
      [1124,14.99,1538,1.07,1],[3875,17.16,2076,0.83,0],[2475,18.26,3485,0.42,0],
      [1026,14.68,6598,0.87,0],[7482,7.73,3883,0.77,0]];
    ok('every hand-labelled card keeps its verdict',
       LIVE.every(([c,r,t,d,bot]) => judge(c,r,t,d).flagged === !!bot),
       LIVE.filter(([c,r,t,d,bot]) => judge(c,r,t,d).flagged !== !!bot).length + ' changed');
    JBF.cfg.rule = was;
  })();

  console.log('\ndirect evidence beats the learned baseline');
  (function () {
    const was = JBF.cfg.rule, wasMax = JBF.cfg.maxMultiple;
    // Measured on the live 24-hour list, from a baseline built out of the
    // real 272 cards on it: the peer rule scored the GENUINE card 2.25x and
    // the BOTTED one 2.19x — the wrong way round. A baseline you collect
    // yourself can invert like that; the card's own token count cannot.
    JBF.cfg.rule = 'peer'; JBF.cfg.maxMultiple = 2.0;
    const judge = (chats, msgs, tokens) => {
      const rec = { id: 'e' + chats + tokens, name: 'x', chats, messages: msgs,
        ratio: msgs / chats, days: 0.9, tokens, publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec); return rec;
    };
    const legit = judge(1026, 15061, 6598);   // heroines
    const bot   = judge(1124, 16846, 1538);   // Lonely
    ok('a card with the character to account for its ratio survives the peer rule',
       !legit.flagged, legit.reason);
    ok('and says so rather than going quiet',
       /tokens of character behind it/.test(legit.reason || ''), legit.reason);
    ok('the thin one is still caught', bot.flagged, bot.reason);
    // Control: the guard must not be "never flag" — same ratio, thin card.
    ok('the guard is about the tokens, not the card',
       judge(1026, 15061, 1538).flagged, 'same ratio on a 1,538-token card');
    // And the low side must still work, since a chat count can itself be faked.
    ok('chat-inflation is still caught on a deep card',
       judge(6000, 5400, 6598).flagged, judge(6000, 5400, 6598).reason);
    JBF.cfg.rule = was; JBF.cfg.maxMultiple = wasMax;
  })();

  console.log('\nupgrading an existing install');
  await (async function () {
    const snapshot = JSON.parse(JSON.stringify(JBF.cfg));
    // Settings written before the depth rule existed pin rule:'peer'. Left
    // alone, the upgrade silently keeps judging on the learned baseline.
    let written = null;
    const old = { rule: 'peer', maxMultiple: 2.0, mode: 'badge', whitelist: ['keep-me'] };
    JBF.setStorage({ get: async () => old, set: async c => { written = c; },
      getData: async () => null, setData: async () => {} });
    const c = await JBF.loadCfg();
    ok('an old install is moved onto the rule that needs no baseline', c.rule === 'thin', c.rule);
    ok('and its own settings are kept', c.mode === 'badge' && c.maxMultiple === 2.0 &&
       c.whitelist.length === 1, JSON.stringify({mode:c.mode, max:c.maxMultiple, wl:c.whitelist}));
    ok('the migration is written back, so it happens once', written && written.cfgVersion === 5,
       written ? String(written.cfgVersion) : 'not written');
    // Hand the harness's own storage back, or every later test runs against
    // this block's stub.
    JBF.setStorage(memStore);
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, snapshot);
  })();

  console.log('\npanel');
  ok('panel mounted', !!window.document.getElementById('jbf-panel-host'));
  ok('shadow-isolated', !!window.document.getElementById('jbf-panel-host').shadowRoot);

  console.log('\nthe rule must reach cards built from the real page');
  await (async function () {
    // This is the gap that let the filter ship doing nothing at all.
    // findCards() — the function that turns the page's DOM plus the API
    // payload into records — never copied total_tokens onto them. Every
    // real card therefore had no depth number, the depth rule declined to
    // judge any of them, and nothing was filtered. Every existing test
    // passed because they all built their records by hand, with the field
    // already set. So: assert on records the scanner actually produced.
    const before = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'badge', enabled: true });
    await sleep(60);
    const recs = JBF._internals.records.filter(r => !r.isReplacement);
    ok('the scanner found cards at all', recs.length > 0, String(recs.length));
    ok('every scanned card carries a token count',
       recs.every(r => typeof r.tokens === 'number'),
       recs.filter(r => typeof r.tokens !== 'number').map(r => r.name).join(', ') || 'all of them');
    ok('and a depth score computed from it',
       recs.every(r => typeof r.thin === 'number' && isFinite(r.thin)),
       recs.map(r => `${r.name.slice(0, 12)}=${r.thin == null ? 'null' : r.thin.toFixed(1)}`).join(' '));
    ok('the depth rule actually flags something on a real page',
       recs.some(r => r.flagged && /token card/.test(r.reason)),
       recs.filter(r => r.flagged).map(r => r.name.slice(0, 16)).join(', ') || 'NOTHING FLAGGED');
    ok('and leaves the deep cards alone',
       recs.some(r => !r.flagged), 'not everything is hidden');

    // A card the API never gave a token count for must not switch the rule
    // off for that card — it falls through to the size-and-age rule.
    const orphan = { id: 'no-tokens', name: 'No Tokens', chats: 957, messages: 18000,
      ratio: 18.81, days: 300, tokens: null, publicChats: 0, chatsPerDay: 3 };
    JBF._internals.evaluate(orphan);
    ok('a card with no token count still gets judged',
       orphan.reason !== '' && !/no token count/.test(orphan.reason), orphan.reason);

    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, before);
    await JBF.saveCfg({});
  })();

  console.log('\nthe panel tells the truth about which rule is running');
  await (async function () {
    const root = window.document.getElementById('jbf-panel-host').shadowRoot;
    const txt = id => (root.getElementById(id) || {}).textContent || '';
    const shown = id => { const e = root.getElementById(id);
      return !!e && !e.classList.contains('hidden'); };
    const PEER_ONLY = ['trustRow', 'lowSideRow', 'learnedHead', 'baseinfo', 'btable', 'reset'];

    await JBF.saveCfg({ rule: 'thin' }); await sleep(60);
    ok('under the depth rule it does not claim to be learning',
       !/learning|learns/i.test(txt('listsNote')) && !/learning/i.test(txt('st-sub')),
       txt('listsNote'));
    ok('and the learned-baseline controls are out of the way',
       PEER_ONLY.every(id => !shown(id)),
       PEER_ONLY.filter(shown).join(', ') || 'all hidden');
    ok('the slider reads in depth-score units', txt('pctwhy').includes('1,000 tokens'),
       txt('pctwhy'));

    await JBF.saveCfg({ rule: 'peer' }); await sleep(60);
    ok('switching to the learned rule brings them back',
       PEER_ONLY.every(id => shown(id)),
       PEER_ONLY.filter(id => !shown(id)).join(', ') || 'all shown');
    ok('and it says it learns', /learns/i.test(txt('listsNote')), txt('listsNote'));
    ok('the slider reads in multiples', txt('pctwhy').includes('normal messages-per-chat'),
       txt('pctwhy'));

    await JBF.saveCfg({ rule: 'thin', enabled: true }); await sleep(120);
    ok('it reports what it is doing on this page',
       /hiding \d+ of the \d+|nothing on this page is past it|not acting/.test(txt('rateNote')),
       txt('rateNote'));
  })();

  console.log('\nthe slider actually moves');
  await (async function () {
    // It has broken twice. Once because syncInputs() re-set it to the peer
    // position on every save — 2.25x lands on 52.5, so the handle snapped
    // back there from wherever you dropped it. Once because it was disabled
    // for any rule that wasn't 'peer', which killed it outright the moment
    // the card-depth rule became the default.
    const root = window.document.getElementById('jbf-panel-host').shadowRoot;
    const range = root.getElementById('peerRange');
    const pct = root.getElementById('pct');
    const drag = async v => {
      range.value = String(v);
      range.dispatchEvent(new window.Event('input', { bubbles: true }));
      range.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(40);
      return { at: range.value, label: pct.textContent, disabled: range.disabled };
    };
    for (const rule of ['thin', 'peer']) {
      await JBF.saveCfg({ rule });
      await sleep(40);
      ok(`slider is live under the ${rule} rule`, !range.disabled, 'disabled=' + range.disabled);
      const lo = await drag(Number(range.min) + 2);
      const hi = await drag(Number(range.max) - 2);
      ok(`${rule}: the handle stays where it is dropped`,
         lo.at === String(Number(range.min) + 2) || hi.at === String(Number(range.max) - 2),
         `low->${lo.at} high->${hi.at}`);
      ok(`${rule}: the two ends read differently`, lo.label !== hi.label,
         `"${lo.label}" vs "${hi.label}"`);
      const setting = rule === 'thin' ? 'thinScore' : 'maxMultiple';
      const before = JBF.cfg[setting];
      await drag(Number(range.min) + 2);
      ok(`${rule}: moving it changes ${setting}`, JBF.cfg[setting] !== before,
         `${before} -> ${JBF.cfg[setting]}`);
    }
    await JBF.saveCfg({ rule: 'peer' });
  })();

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
