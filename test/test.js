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
// 18.8 msg/chat out of a 150-token card. Thin FOR ITS AGE — at 300 days old
// 18.8 msg/chat is ordinary on its own (real cards past a year run ~30) —
// and thin by a wide enough margin to be hidden rather than merely marked.
const HANA   = chr('Trapped In Hell with Hana', 957, 18000, { days: 300, tokens: 150 });
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
    // ON by default since v7. Seven live cards scored past the depth
    // threshold on ratio alone; every one was a tiny, famous utility card
    // with tens of thousands of chats. The guard sits in the 6x gap between
    // those and the largest hand-labelled bot.
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
    ok('and it guards by default now', guardWas >= 4000, String(guardWas));
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
  ok('tiny card spared by the activity floor',
     !tiny.flagged && /activity/.test(tiny.reason), tiny.reason);
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
  // Every judged card carries a badge now, so a replacement having one is
  // correct — it must just not be carrying the DONOR's id.
  ok("donor's badge not cloned onto the replacement", (() => {
    const b = rep.querySelector('.jbf-badge');
    return !b || b.getAttribute('data-jbf-id') !== hana.id;
  })());
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
     badge && /mark it fine/i.test(badge.title) && /shift-click/i.test(badge.title),
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
    const bot   = judge(1124, 21000, 1538);   // a thin card at 18.7 msg/chat
    ok('a card with the character to account for its ratio survives the peer rule',
       !legit.flagged, legit.reason);
    ok('and says so rather than going quiet',
       /tokens of character behind it/.test(legit.reason || ''), legit.reason);
    ok('the thin one is still caught', bot.flagged, bot.reason);
    // Control: the guard must not be "never flag" — same ratio, thin card.
    ok('the guard is about the tokens, not the card',
       judge(1026, 21000, 1538).flagged, 'same ratio on a 1,538-token card');
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
    const old = { rule: 'peer', maxMultiple: 2.0, mode: 'badge', whitelist: ['keep-me'],
      thinScore: 8.6, cfgVersion: 5 };
    JBF.setStorage({ get: async () => old, set: async c => { written = c; },
      getData: async () => null, setData: async () => {} });
    const c = await JBF.loadCfg();
    ok('an old install is moved onto the rule that needs no baseline', c.rule === 'thin', c.rule);
    ok('and its own settings are kept', c.mode === 'badge' && c.maxMultiple === 2.0 &&
       c.whitelist.length === 1, JSON.stringify({mode:c.mode, max:c.maxMultiple, wl:c.whitelist}));
    // But NOT a stale threshold. An install carrying 8.6 from an earlier
    // release kept hiding a card the re-measured labels clear, and shipping
    // a new default could not dislodge it.
    ok('a saved threshold does not survive a recalibration',
       c.thinScore === JBF.DEFAULTS.thinScore, String(c.thinScore));
    // v7 added a second tier and a comment test. An install that predates
    // them has no saved opinion about them worth keeping — and trustAbove
    // shipped as 0, the setting that let big minimal cards be hidden.
    ok('and the second tier arrives with it', c.depthSure > c.thinScore,
       `${c.thinScore} / ${c.depthSure}`);
    ok('and the broad-audience guard is turned on', c.trustAbove > 0, String(c.trustAbove));
    ok('the migration is written back, so it happens once',
       written && written.cfgVersion === JBF.cfg.cfgVersion,
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

  console.log('\na card with no history has no usual rate');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true,
      suspected: [], whitelist: [] });
    await sleep(60);
    // Both of these were hidden on a live listing. Both are a day old, both
    // plainly genuine, both simply climbing: everything on 24-hour trending
    // is accelerating, and against a lifetime average taken over one day
    // that reads as a spike.
    const climbing = (chats, days, dc, dm) => {
      const rec = { id: 'v' + chats + days, name: 'x', chats, messages: chats * 17,
        ratio: 17, days, tokens: 4919, publicChats: 0, chatsPerDay: chats / days,
        trend: { dc, dm, hours: 2, ts: Date.now() } };
      JBF._internals.evaluate(rec); return rec;
    };
    const dayOld = climbing(684, 1, 402, 6800);       // "7x its usual"
    ok('a day-old card taking off is not called a burst',
       !/\/day/.test(dayOld.reason || ''), dayOld.reason || '(nothing)');
    const settled = climbing(6000, 40, 402, 6800);    // same delta, real history
    ok('the same delta on a card with history still is',
       /\/day/.test(settled.reason || ''), settled.reason);
    ok('and the floor is stated in days, not guessed',
       JBF.cfg.minTrendDays >= 7, String(JBF.cfg.minTrendDays));

    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe whole labelled set, re-measured together');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true, useLikes: true,
      suspected: [], whitelist: [] });
    await sleep(60);
    const L = JBF._internals.comments;

    // Every card labelled by hand over the life of this project, each one
    // re-read from the API in a single pass so nothing here is stale. That
    // matters: one card's definition grew from 1,538 to 4,169 tokens between
    // being labelled and being used as calibration, and another drifted from
    // 10.31 to 10.43 across the threshold that was hiding it.
    //
    // chats, msg/chat, tokens, days old, comments, comment mode, botted.
    const SET = [
      ['Undertale', 118, 43.47, 1815, 1.0, 0, 'disabled', 1],
      ['Ellen Joe', 136, 30.38, 724, 1.0, 2, 'open', 1],
      ['I married a lesbian', 416, 24.80, 639, 1.0, 15, 'open', 1],
      ['Apocalyptic Sanctuary', 503, 16.13, 1452, 1.0, 2, 'open', 1],
      ['Sofia', 742, 10.70, 473, 1.0, 14, 'open', 1],
      ['Friends w Apt Benefits', 4221, 16.65, 2750, 7.0, 9, 'open', 1],
      ['Emily Sweaty Submission', 1731, 14.00, 2700, 5.0, 3, 'open', 1],
      ['Your Sweet Step Mom', 2281, 12.50, 4800, 5.0, 3, 'open', 1],
      ['Aliens abducted', 690, 12.45, 1106, 1.0, 6, 'open', 1],
      ['Succubus Crush', 1975, 14.86, 1351, 1.0, 22, 'open', 0],
      ['Stuck in One Room', 2336, 21.19, 2286, 1.3, 18, 'open', 0],
      ['Kidnapped For Content', 703, 17.25, 4919, 1.0, 27, 'followed_only', 0],
      ['Pregnant Cult Member', 687, 15.67, 4359, 1.3, 4, 'open', 0],
      ['Wife futa coworker', 2152, 12.09, 3544, 1.0, 12, 'open', 0],
      ['No One Thinks', 6245, 19.68, 3521, 1.0, 86, 'open', 0],
      ['Yandere Best Friend', 1612, 7.50, 3225, 1.0, 56, 'open', 0],
      ['DeepSeek-chan', 272, 15.26, 3614, 1.4, 9, 'open', 0],
      ['A Smile and a Smirk', 1391, 13.19, 3330, 1.2, 9, 'open', 0],
      ['Betrayed by Hero Party', 1964, 12.44, 4006, 1.0, 37, 'open', 0],
      ['Your Roommate Reality', 4063, 14.27, 2768, 1.5, 41, 'open', 0],
      ['Lonely MILF', 1769, 6.29, 1688, 1.0, 20, 'open', 0],
      ['HER boyfriend Paige', 2790, 9.20, 2393, 1.0, 13, 'open', 0],
      ['Rivalry Two Dukes', 2719, 9.81, 4462, 1.3, 13, 'open', 0],
      ['MHA Pick Me Meko', 2657, 14.09, 1799, 1.5, 31, 'open', 0],
    ];
    SET.forEach(([n, chats, , , , com, mode]) => L.set(n, {
      per1k: com / chats * 1000, total: com, mode }));

    const verdict = ([n, chats, ratio, tokens, days]) => {
      const rec = { id: n, name: n, chats, ratio, tokens, days,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats / days };
      JBF._internals.evaluate(rec); return rec;
    };
    const hides = r => !!(r.flagged && r.confident);   // flagged alone only marks
    const byName = n => SET.find(r => r[0] === n);
    const bots = SET.filter(r => r[7] === 1), genuine = SET.filter(r => r[7] === 0);

    const wronglyHidden = genuine.filter(r => hides(verdict(r))).map(r => r[0]);
    ok('not one card a human called genuine is hidden',
       wronglyHidden.length === 0,
       wronglyHidden.join('; ') || `none of the ${genuine.length}`);

    const missed = bots.filter(r => !verdict(r).flagged).map(r => r[0]);
    ok('and every card a human called botted is at least marked',
       missed.length === 0, missed.join('; ') || `all ${bots.length} caught`);

    // The ones small enough that the numbers cannot carry a hide are marked
    // instead. Everything past the chat floor is hidden outright.
    const hidden = bots.filter(r => hides(verdict(r)));
    ok('every botted card past the chat floor is hidden outright',
       bots.filter(r => r[1] >= JBF.cfg.minChats && !hides(verdict(r)))
           .every(r => verdict(r).flagged),
       `${hidden.length} of ${bots.length} hidden`);
    // A small chat count is no longer a reason to hold back on its own: a
    // card with 118 chats and 5,133 messages has done enough to answer for
    // itself, and both of these were confirmed botted by hand.
    ok('a card with few chats but real activity behind it is still judged',
       (() => { const v = verdict(byName('Undertale'));
         return v.flagged && v.confident;
       })(), verdict(byName('Undertale')).reason);
    ok('and so is the other one that used to sit under the chat floor',
       (() => { const v = verdict(byName('Ellen Joe'));
         return v.flagged && v.confident;
       })(), verdict(byName('Ellen Joe')).reason);

    // The three the depth rule cannot see at all: 1.7, 3.3 and 3.5 on depth
    // is unremarkable, and without the silence rule all three stay up.
    ok('the ordinary-looking bots are caught on silence alone', (() => {
      const quiet = ['Your Sweet Step Mom', 'Emily Sweaty Submission',
                     'Friends w Apt Benefits'].map(n => verdict(byName(n)));
      return quiet.every(r => r.confident && r.thin < JBF.cfg.thinScore &&
        /per 1,000 where cards this size get/.test(r.reason));
    })(), ['Your Sweet Step Mom','Emily Sweaty Submission','Friends w Apt Benefits']
            .map(n => verdict(byName(n)).reason).join(' | '));

    // The pair that broke every single-threshold version of this rule: a
    // botted card and a genuine one measured 11.1 and 11.0 on depth.
    ok('two cards that measure the same are told apart by their comments', (() => {
      const apoc = verdict(byName('Apocalyptic Sanctuary'));
      const succ = verdict(byName('Succubus Crush'));
      // One percent apart on depth; 1.9 against 11.1 comments per 1,000.
      return Math.abs(apoc.thin - succ.thin) < 0.5 && hides(apoc) && !hides(succ);
    })(), `Apocalyptic ${verdict(byName('Apocalyptic Sanctuary')).thin.toFixed(1)} -> ` +
          `${hides(verdict(byName('Apocalyptic Sanctuary'))) ? 'hidden' : 'kept'}; ` +
          `Succubus ${verdict(byName('Succubus Crush')).thin.toFixed(1)} -> ` +
          `${hides(verdict(byName('Succubus Crush'))) ? 'hidden' : 'kept'}`);

    // A card whose creator restricted comments to followers has a suppressed
    // count by design, so it is not a denominator either.
    ok('a followers-only comment section is not read as silence', (() => {
      const r = verdict(byName('Kidnapped For Content'));
      return !r.flagged;
    })(), verdict(byName('Kidnapped For Content')).reason);

    ok('the two depth tiers leave real room, not three percent',
       JBF.cfg.depthSure / JBF.cfg.thinScore >= 1.3,
       `${JBF.cfg.thinScore} -> ${JBF.cfg.depthSure}`);

    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\ncomments only ever corroborate downward');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    // Pin the calibration. Earlier blocks drag the slider, and every rule
    // here is about which tier a card lands in — an inherited threshold has
    // silently broken this block twice.
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.balanced, { rule: 'thin',
      mode: 'hide', enabled: true, useLikes: true, suspected: [], whitelist: [] }));
    await sleep(60);
    const L = JBF._internals.comments;
    const judge = (id, chats, ratio, tokens, days) => {
      const rec = { id, name: 'x', chats, ratio, days, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats / days };
      JBF._internals.evaluate(rec); return rec;
    };

    // A healthy comment count was briefly allowed to rescue a thin card.
    // Then the labelled set was re-measured together: two cards judged
    // botted by hand carry 15.1 and 24.6 comments per 1,000 chats, against
    // 14.5 on a genuine one. A busy comment section says nothing about
    // legitimacy, so a rescue on that basis just hides the wrong half.
    L.set('sofia',   { per1k: 15.1, total: 11, mode: 'open' });   // botted
    L.set('lesbian', { per1k: 24.6, total: 10, mode: 'open' });   // botted
    const sofia   = judge('sofia', 731, 10.8, 473, 1);
    const lesbian = judge('lesbian', 407, 24.6, 639, 1);
    ok('a well-liked card that is still far too thin is acted on anyway',
       sofia.flagged && lesbian.flagged,
       `sofia ${sofia.over.toFixed(2)}x, lesbian ${lesbian.over.toFixed(2)}x`);
    ok('and the reason does not cite the comments as a defence',
       !/people liked it/.test(sofia.reason), sofia.reason);

    // Downward, they decide — inside the band where they were measured.
    // A card at 2,000 chats with two comments is hidden on that alone,
    // whatever its depth score says.
    L.set('quiet-mid', { per1k: 1.0, total: 2, mode: 'open' });
    const quietMid = judge('quiet-mid', 2000, 12.0, 4000, 1);
    ok('thousands of chats and nobody talking is enough on its own',
       quietMid.flagged && quietMid.confident, quietMid.reason);

    // Comments switched off freeze the count while chats keep arriving, so
    // the rate decays on its own. Three of 74 live cards had them off and
    // all three were ordinary, so this is not evidence in either direction.
    L.set('closed', { per1k: 0.5, total: 1, mode: 'disabled' });
    const closed = judge('closed', 2000, 12.0, 4000, 1);
    ok('a card with comments switched off is not judged on its comment rate',
       !closed.flagged, closed.reason);

    // BETWEEN the two activity floors (3,000-4,000 messages) a card can only
    // be hidden when the depth score cannot be a small-denominator artefact.
    // Of 40 live cards between 50 and 260 chats, the seven past twice the
    // threshold ALL had 606 tokens or fewer; of the 30 with 1,000+ tokens
    // the highest score was 9.6.
    L.set('tiny-thin', { per1k: 0, total: 0, mode: 'open' });
    const tinyThin = judge('tiny-thin', 100, 36.2, 279, 1);   // 3,620 messages
    ok('a tiny-definition card between the floors is marked, never hidden',
       tinyThin.flagged && !tinyThin.confident, tinyThin.reason);
    ok('and it names the activity it is judging on',
       /too little to be sure/.test(tinyThin.reason), tinyThin.reason);
    // ...and one with a real definition behind the same score is hidden.
    L.set('sub-real', { per1k: 0, total: 0, mode: 'open' });
    const subReal = judge('sub-real', 60, 59.4, 1815, 1);     // 3,564 messages
    ok('but one with a real definition behind it is hidden',
       subReal.flagged && subReal.confident, subReal.reason);
    ok('the guard is the definition size, not the score', (() => {
      // Identical depth score (25.0), both past the ratio floor, both inside
      // the 3,000-4,000 message band; they differ only in the denominator.
      const a = judge('g-a', 120, 30.0, 1200, 1);   // 3,600 msgs, 30.0/1200
      const b = judge('g-b', 288, 12.5,  500, 1);   // 3,600 msgs, 12.5/500
      return Math.abs(a.thin - b.thin) < 0.01 && a.confident && !b.confident;
    })(), `a ${judge('g-a',120,30.0,1200,1).thin.toFixed(1)} ` +
          `b ${judge('g-b',288,12.5,500,1).thin.toFixed(1)}`);
    L.set('tiny-ok', { per1k: 25, total: 2, mode: 'open' });
    const tinyOk = judge('tiny-ok', 115, 30, 900, 1);         // 3,450 messages
    ok('a busy comment section does not rescue it either \u2014 it is still marked',
       tinyOk.flagged && !tinyOk.confident, tinyOk.reason);
    ok('an ordinary small card is left alone entirely',
       !judge('tiny-plain', 80, 12, 3000, 1).flagged,
       judge('tiny-plain', 80, 12, 3000, 1).reason);
    // Under 50 chats the ratio is one conversation: 34 of the 40 live cards
    // clearing the "far out of line" bar had fewer than 50.
    ok('and a card with almost no chats is not even marked',
       !judge('tiny-few', 20, 60, 900, 1).flagged,
       judge('tiny-few', 20, 60, 900, 1).reason);

    ok('the lookup never sends the session token', (() => {
      const src = JBF._internals.publicGet.toString();
      return /credentials: 'omit'/.test(src) && !/authToken|authorization/i.test(src);
    })());

    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\na marginal call is a question, not a verdict');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true,
      suspected: [], whitelist: [] });
    await sleep(80);
    const judge = (chats, ratio, tokens, days) => {
      const rec = { id: 'c' + chats + tokens, name: 'x', chats, ratio, days, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats / days };
      JBF._internals.evaluate(rec); return rec;
    };
    // Re-measured together, the labelled cards DO NOT separate cleanly here.
    // A botted card sits at 11.1 and a genuine one at 10.8 — three percent
    // apart. That is the whole reason this band exists: depth alone marks,
    // and only a second signal converts a mark into a hide.
    const L = JBF._internals.comments;
    const justUnder = judge(1313, 13.6, 1351, 1);   // "Succubus Crush" ~0.92x
    const justOver  = judge(477, 16.3, 1452, 1);    // "Apocalyptic Sanctuary" ~1.02x
    ok('a card just under the line is flagged but not hidden',
       justUnder.flagged && !justUnder.confident,
       `${justUnder.over.toFixed(2)}x of the threshold`);
    ok('and it says how close it came, and what to do',
       /close to the line/.test(justUnder.reason) && /shift-click/i.test(justUnder.reason),
       justUnder.reason);
    ok('a card just over it is marked, not hidden, on depth alone',
       justOver.flagged && !justOver.confident, `${justOver.over.toFixed(2)}x`);

    // Same card, now with the comment rate the engine's lookup would fetch.
    L.set('c4771452', { per1k: 1.9, total: 1, mode: 'open' });
    const corroborated = judge(477, 16.3, 1452, 1);
    ok('and hidden once the comments agree',
       corroborated.flagged && corroborated.confident, corroborated.reason);

    // The genuine card at practically the same score, with a busy comment
    // section, must survive that same second look — and a near miss with a
    // normal-sized comment section is not even worth marking.
    L.set('c13131351', { per1k: 13.7, total: 18, mode: 'open' });
    const survives = judge(1313, 13.6, 1351, 1);
    ok('while the genuine card at the same score is left alone entirely',
       !(survives.flagged && survives.confident) &&
       /normal amount for its size/.test(survives.reason), survives.reason);

    // Past the upper tier nothing else is needed.
    const blatant = judge(407, 24.6, 639, 1);       // "I married a lesbian" 3.5x
    ok('a card far past the second tier is hidden with no corroboration',
       blatant.flagged && blatant.confident && !L.has('c407639'), blatant.reason);
    L.clear();

    ok('nothing well under the line is touched',
       !judge(1779, 17.6, 6598, 1).flagged, 'the most engaged genuine card measured');

    // On the page: marked cards stay visible, confident ones go.
    await sleep(60);
    const recs = JBF._internals.records.filter(r => !r.isReplacement);
    const hiddenOnes = recs.filter(r => r.flagged && r.confident);
    ok('confident verdicts are the only ones hidden', hiddenOnes.every(r =>
       r.root.style.display === 'none'),
       hiddenOnes.map(r => r.name).join(', ') || 'none flagged here');
    ok('a marked-but-unsure card stays on the page', recs
       .filter(r => r.flagged && !r.confident)
       .every(r => r.root.style.display !== 'none'));

    // The panel has to be able to show its working, or a hidden card
    // leaves no trace and nobody can find out why it went.
    const st = JBF.getStats();
    ok('every verdict is reported with its reason',
       Array.isArray(st.verdicts) && st.verdicts.length === st.flagged &&
       st.verdicts.every(v => v.id && v.name && v.reason),
       `${(st.verdicts || []).length} verdicts for ${st.flagged} flagged`);

    // A card with almost no activity is not judged at all, whatever its
    // ratio: median depth across 139 live cards under 400 chats runs 18.5 at
    // 1-50 chats, where one long conversation is the entire signal.
    const tiny = judge(60, 34.7, 724, 1);         // 2,082 messages
    ok('cards with too little activity are not judged',
       !tiny.flagged && /activity/.test(tiny.reason),
       'floor ' + JBF.cfg.minMessages + ', ' + tiny.reason);

    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nmarking a card yourself');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'badge', enabled: true, suspected: [], whitelist: [] });
    await sleep(80);

    const passed = JBF._internals.records.find(r => !r.flagged && !r.isReplacement &&
      r.chats >= JBF.cfg.minChats && r.thin !== null);
    ok('a card that passed still gets a badge to click', (() => {
      const b = passed && passed.root.querySelector('.jbf-badge');
      return !!b && b.classList.contains('jbf-badge--quiet');
    })(), passed ? passed.name : 'no unflagged card');

    const badge = passed.root.querySelector('.jbf-badge');
    badge.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
    await sleep(120);
    ok('shift-clicking it records your verdict',
       JBF.cfg.suspected.includes(passed.id), JSON.stringify(JBF.cfg.suspected));
    ok('and that actually hides it, not just notes it',
       JBF._internals.records.find(r => r.id === passed.id).flagged,
       JBF._internals.records.find(r => r.id === passed.id).reason);
    ok('the reason says it was your call',
       /you marked this one as botted/.test(
         JBF._internals.records.find(r => r.id === passed.id).reason));

    // Shift-clicking again undoes it.
    const again = passed.root.querySelector('.jbf-badge');
    again.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
    await sleep(120);
    ok('shift-clicking again takes it back',
       !JBF.cfg.suspected.includes(passed.id), JSON.stringify(JBF.cfg.suspected));

    // The two verdicts are opposites, so one must clear the other.
    await JBF.saveCfg({ suspected: [passed.id], whitelist: [] });
    await sleep(80);
    passed.root.querySelector('.jbf-badge')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    ok('marking it fine clears the botted mark',
       JBF.cfg.whitelist.includes(passed.id) && !JBF.cfg.suspected.includes(passed.id),
       `fine=${JBF.cfg.whitelist.length} botted=${JBF.cfg.suspected.length}`);

    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
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
      // The depth rule has two tiers. Dragging the slider has to carry both
      // or the mark line passes the hide line and the middle tier — the one
      // that asks the comments before deciding — silently disappears.
      if (rule === 'thin') {
        for (const at of [Number(range.min) + 2, 60, Number(range.max) - 2]) {
          await drag(at);
          ok(`thin: the two tiers stay in order at ${at}`,
             JBF.cfg.depthSure > JBF.cfg.thinScore,
             `${JBF.cfg.thinScore} -> ${JBF.cfg.depthSure}`);
        }
      }
    }
    await JBF.saveCfg({ rule: 'peer' });
  })();

  console.log('\na card that runs at a normal rate for its cohort is not hidden on depth');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    // Pin the thresholds: earlier blocks drag the slider around, and this
    // rule is entirely about which tier a card lands in.
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true, suspected: [], whitelist: [],
      thinScore: JBF.DEFAULTS.thinScore, depthSure: JBF.DEFAULTS.depthSure,
      thinRatio: JBF.DEFAULTS.thinRatio, peerSupport: JBF.DEFAULTS.peerSupport,
      peerOdd: JBF.DEFAULTS.peerOdd, trustAbove: JBF.DEFAULTS.trustAbove });
    await sleep(60);
    // `scoreFor` is the token-free half: msg/chat against what cards of this
    // size and age actually run at. Stub it so the guard can be tested
    // without depending on whatever baseline the harness happens to hold.
    const judge = (chats, ratio, tokens, multiple) => {
      JBF._internals.setScoreFor(() => ({ multiple, expected: ratio / multiple, deviations: 1 }));
      const rec = { id: 'n' + multiple, name: 'x', chats, ratio, days: 1, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec);
      JBF._internals.setScoreFor(null);
      return rec;
    };
    // Succubus Crush: the card wrongly flagged more often than any other in
    // this project. Depth says thin, the cohort says completely ordinary.
    const succ = judge(2387, 14.47, 1351, 1.30);
    ok('a card at 1.3x the normal rate for its size is not hidden on depth',
       succ.flagged && !succ.confident, succ.reason);
    // Same guard one tier up, where depth alone would otherwise decide.
    const deep = judge(2000, 30.0, 1500, 1.30);      // depth 20, past depthSure
    ok('and it holds even past the tier that decides by itself',
       deep.flagged && !deep.confident, deep.reason);
    ok('the reason says the cohort disagrees',
       /not out of the ordinary for them/.test(deep.reason), deep.reason);
    // Three confirmed bots on the same page ran at 3.77x, 4.92x and 9.12x.
    const bot = judge(150, 35.27, 1815, 9.12);
    ok('a card far above its cohort is still hidden', bot.flagged && bot.confident, bot.reason);
    // And the same signal the other way: a confirmed bot at 4.9x its cohort
    // sitting just under the tier that decides by itself, which depth alone
    // left only marked.
    const odd = judge(248, 19.89, 1722, 4.92);
    ok('a card far above its cohort is hidden even under the upper tier',
       odd.flagged && odd.confident && /rate cards of its size and age/.test(odd.reason),
       odd.reason);
    ok('but not one merely near the line with a healthy comment section', (() => {
      const r = judge(286, 14.76, 1355, 3.55);
      return r.flagged && !r.confident;
    })(), judge(286, 14.76, 1355, 3.55).reason);
    ok('the guard can be switched off', (() => {
      const keep = JBF.cfg.peerSupport;
      JBF.cfg.peerSupport = 0;
      const again = judge(2000, 30.0, 1500, 1.30);
      JBF.cfg.peerSupport = keep;
      return again.flagged && again.confident;
    })());
    ok('and it does nothing at all until a baseline exists', (() => {
      JBF._internals.setScoreFor(() => null);
      const rec = { id: 'nb', name: 'x', chats: 2000, ratio: 30.0, days: 1, tokens: 1500,
        messages: 60000, publicChats: 0, chatsPerDay: 2000 };
      JBF._internals.evaluate(rec);
      JBF._internals.setScoreFor(null);
      return rec.flagged && rec.confident;
    })());
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\na normal-sized comment section clears a near miss');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true, suspected: [], whitelist: [],
      thinScore: JBF.DEFAULTS.thinScore, depthSure: JBF.DEFAULTS.depthSure,
      thinRatio: JBF.DEFAULTS.thinRatio, trustAbove: JBF.DEFAULTS.trustAbove,
      peerSupport: 0, peerOdd: 0 });
    await sleep(60);
    const L = JBF._internals.comments;
    const judge = (id, chats, ratio, tokens, com, mode) => {
      L.set(id, { per1k: com / chats * 1000, total: com, mode: mode || 'open' });
      const rec = { id, name: id, chats, ratio, days: 1, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec); return rec;
    };
    // The three cards judged "probably not botted" by hand, all of which
    // landed in the borderline band on depth alone. Expected comment rate is
    // 8.3 per 1,000 under 2,000 chats and 5.5 from there to 7,000.
    const cases = [['bully', 297, 14.61, 1355, 9], ['stuck', 2821, 22.44, 2286, 19],
                   ['succubus', 2440, 14.24, 1351, 24]];
    const kept = cases.filter(c => !judge.apply(null, c).flagged).map(c => c[0]);
    ok('a near miss with a normal comment section is not even marked',
       kept.length === 3, kept.join(', ') || 'none kept');
    ok('and the reason says so',
       /normal amount for its size/.test(judge.apply(null, cases[0]).reason),
       judge.apply(null, cases[0]).reason);
    // Below the cohort rate it is still marked.
    const thin = judge('queenbee', 270, 19.20, 1722, 1);
    ok('but a near miss with a quiet one still is', thin.flagged, thin.reason);
    // A busy comment section never rescues a card from being HIDDEN: one
    // confirmed bot ran 36.1 comments per 1,000 chats.
    const loud = judge('lesbian', 416, 24.8, 639, 15);
    ok('and it never rescues a card the depth rule is sure about',
       loud.flagged && loud.confident, loud.reason);
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe baseline only learns from listings, never from your own shelf');
  await (async function () {
    const src = JBF._internals.apiUrls ? JBF._internals.apiUrls.toString() : '';
    ok('the replay filters to listing requests', /isListing/.test(src), 'no filter found');
    const L = JBF._internals.isListing;
    ok('a paginated listing is learned from',
       L('/hampter/characters?page=1&mode=all&special_mode=trending24'));
    ok('and so is a deeper page of one',
       L('/hampter/characters?page=4&mode=all&sort=popular'));
    // Signed in, the home page fills carousels from the same endpoint. Those
    // are the user's own recently-viewed and chatted cards: self-selected,
    // skewed old, and the worst possible sample of "normal".
    ok('a fixed set fetched by id is not',
       !L('/hampter/characters?ids=a,b,c'));
    ok('and neither is a call with no page at all',
       !L('/hampter/characters?mode=all'));
  })();

  console.log('\na card people plainly talk about is never flagged on depth');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    const L = JBF._internals.comments;
    const judge = (id, chats, ratio, tokens, com, multiple) => {
      JBF._internals.setScoreFor(() => ({ multiple, expected: ratio / multiple, deviations: 1 }));
      L.set(id, { per1k: com / chats * 1000, total: com, mode: 'open' });
      const rec = { id, name: id, chats, ratio, days: 1, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec);
      JBF._internals.setScoreFor(null);
      return rec;
    };
    // A card labelled plainly genuine, drawing 89.4 comments per 1,000 chats
    // against the 8.3 its size normally gets. At the default dial nothing
    // touched it; turned up, it landed in the tier where a healthy comment
    // section no longer cleared it.
    for (const dial of [11, 9, 6]) {
      await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true, suspected: [], whitelist: [],
        thinScore: dial, depthSure: Math.round(dial * 1.36 * 10) / 10,
        peerSupport: Math.max(1.2, Math.min(3.5, Math.round(dial / 5 * 10) / 10)),
        thinRatio: JBF.DEFAULTS.thinRatio, trustAbove: JBF.DEFAULTS.trustAbove });
      await sleep(30);
      const r = judge('vouch' + dial, 238, 18.82, 2120, 21, 4.18);
      ok(`at dial ${dial} it is not flagged at all`, !r.flagged, r.reason);
    }
    ok('and the reason says the conversation is accounted for',
       /conversation is accounted for/.test(judge('vouchX', 238, 18.82, 2120, 21, 4.18).reason));
    // But a busy comment section is not a free pass: the highest hand-
    // labelled BOTTED card reached 4.3x its cohort rate, under the 5x bar.
    await JBF.saveCfg({ thinScore: JBF.DEFAULTS.thinScore, depthSure: JBF.DEFAULTS.depthSure,
      peerSupport: JBF.DEFAULTS.peerSupport });
    const bot = judge('loud-bot', 416, 24.8, 639, 15, 3.5);
    ok('a botted card at 4.3x its cohort rate is still hidden',
       bot.flagged && bot.confident, bot.reason);
    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nguard flags do not survive a change of settings');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    const mk = () => ({ id: 'sticky', name: 'x', chats: 2600, ratio: 14.77, days: 1,
      tokens: 1351, messages: 38395, publicChats: 0, chatsPerDay: 2600 });
    // Balanced: peer 1.25 is under the 2.5 gate, so the card is protected.
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.balanced,
      { rule: 'thin', mode: 'hide', enabled: true, suspected: [], whitelist: [] }));
    await sleep(40);
    JBF._internals.setScoreFor(() => ({ multiple: 1.25, expected: 11.8, deviations: 1 }));
    const a = mk(); JBF._internals.evaluate(a);
    ok('under balanced the peer guard fires', a.runsNormal === true, String(a.runsNormal));
    // Strict moves the gate to 1.2, so the same card is no longer protected —
    // and the flag has to go with it, or the export explains the verdict with
    // a guard the user has already dialled past.
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.strict, { rule: 'thin' }));
    await sleep(40);
    const b = mk(); JBF._internals.evaluate(b);
    JBF._internals.setScoreFor(null);
    ok('under strict it does not, and the flag clears with it',
       b.runsNormal === false, String(b.runsNormal));
    ok('a re-judged record never keeps a guard it no longer trips',
       ['trusted', 'runsOdd', 'earnsIt', 'quiet', 'silent', 'healthyComments', 'vouched']
         .every(k => b[k] === false || b[k] === true),
       'some flag left undefined');
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe quiet threshold scales with what a card its size gets');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.strict,
      { rule: 'thin', mode: 'hide', enabled: true, suspected: [], whitelist: [] }));
    await sleep(40);
    const L = JBF._internals.comments;
    const q = (id, chats, com) => {
      L.set(id, { per1k: com / chats * 1000, total: com, mode: 'open' });
      const rec = { id, name: id, chats, ratio: 12, days: 1, tokens: 3500,
        messages: chats * 12, publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec); return rec.quiet;
    };
    // The bug was on cards past 2,000 chats, where the cohort rate drops to
    // 5.5 and below while the flat threshold stayed at 7 — so ordinary cards
    // read as quiet. All three of these did.
    ok('a 3,005-chat card at 5.3 per 1,000 is not quiet', !q('a', 3005, 16));
    ok('a 3,913-chat card at 5.9 per 1,000 is not quiet', !q('c', 3913, 23));
    ok('and a 10,000-chat card at 2.9 per 1,000 is not either', !q('f', 10000, 29));
    // Genuinely silent ones still are, at every size.
    ok('but a 500-chat card at 2.0 per 1,000 is', q('d', 500, 1));
    ok('and a 503-chat card at 4.0 per 1,000 is', q('e', 503, 2));
    ok('and a 10,000-chat card at 1.2 per 1,000 is', q('g', 10000, 12));
    // The threshold never exceeds what the card's own cohort gets, at any
    // preset — that is what made the flat number wrong.
    for (const [n, p] of Object.entries(JBF.PRESETS)) {
      ok(`${n}: the quiet bar stays under the cohort rate`, p.quietFraction < 1,
         String(p.quietFraction));
    }
    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe dial may not drag the hide line into the genuine range');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    // Past depthSure the depth score decides ALONE, so that line may never
    // sit inside the measured genuine range, which runs to 11.0. The dial's
    // aggressive end used to put it at 8.2 and hide a card labelled plainly
    // fine at 8.5 with no second opinion.
    for (const t of [6, 7, 8, 11, 16, 22]) {
      await JBF.saveCfg({ thinScore: t, depthSure: Math.round(t * 1.36 * 10) / 10 });
      ok(`dial ${t}: the hide line stays clear of the genuine range`,
         JBF.cfg.depthSure >= 11, String(JBF.cfg.depthSure));
    }
    // And at that dial the card in question is left completely alone.
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.strict, { rule: 'thin',
      mode: 'hide', enabled: true, useLikes: true, suspected: [], whitelist: [],
      thinScore: 6, depthSure: 8.2 }));
    await sleep(40);
    const L = JBF._internals.comments;
    L.set('dad', { per1k: 21 / 1377 * 1000, total: 21, mode: 'open' });
    JBF._internals.setScoreFor(() => ({ multiple: 2.42, expected: 10.39, deviations: 1 }));
    const dad = { id: 'dad', name: 'x', chats: 1377, ratio: 25.12, tokens: 2951,
      days: 1, messages: 34588, publicChats: 0, chatsPerDay: 1377 };
    JBF._internals.evaluate(dad);
    JBF._internals.setScoreFor(null);
    ok('a card at 1.8x its cohort comment rate is cleared, not marked',
       !dad.flagged, dad.reason);
    // But a card held out of the top tier by the peer guard keeps its
    // outline however busy its comments: a confirmed bot sat at 2.3x.
    L.set('sofia', { per1k: 14 / 742 * 1000, total: 14, mode: 'open' });
    JBF._internals.setScoreFor(() => ({ multiple: 1.1, expected: 9.7, deviations: 1 }));
    const sofia = { id: 'sofia', name: 'x', chats: 742, ratio: 10.70, tokens: 473,
      days: 1, messages: 7938, publicChats: 0, chatsPerDay: 742 };
    JBF._internals.evaluate(sofia);
    JBF._internals.setScoreFor(null);
    ok('but one demoted from the top tier still keeps its outline',
       sofia.flagged, sofia.reason);
    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe growth-shape rules mark rather than hide');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.balanced, { rule: 'thin',
      mode: 'hide', enabled: true, useLikes: true, flagFlatGrowth: true,
      suspected: [], whitelist: [] }));
    await sleep(40);
    const L = JBF._internals.comments;
    const H = JBF._internals.history;
    const judge = (id, com, chats) => {
      L.set(id, { per1k: com / chats * 1000, total: com, mode: 'open' });
      // Nine sightings, evenly spaced over 18 hours, with identical chat
      // increments: traffic arriving at a perfectly constant rate.
      const now = Date.now(), rows = [];
      for (let i = 0; i <= 8; i++) {
        rows.push([now - (8 - i) * 2.25 * 36e5,
                   chats - (8 - i) * 60, Math.round((chats - (8 - i) * 60) * 7.88)]);
      }
      H.set(id, rows);
      const rec = { id, name: id, chats, ratio: 7.88, tokens: 2630, days: 1,
        messages: Math.round(chats * 7.88), publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec); return rec;
    };
    // Every live flatness reading this project has is from a card judged
    // genuine (1.31, 1.36, 1.53) and the threshold of 1.35 splits the first
    // two by four percent. The rule came from simulation, never measurement.
    const quiet = judge('flat-quiet', 1, 774);
    ok('metered-looking growth is marked, never hidden',
       quiet.flagged && !quiet.confident, quiet.reason);
    const loud = judge('flat-loud', 9, 774);
    ok('and a comment section above its cohort clears it outright',
       !loud.flagged, loud.reason);
    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nan odd rate with nobody talking is enough on its own');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    const L = JBF._internals.comments;
    const judge = (id, chats, ratio, tokens, com, peer) => {
      JBF._internals.setScoreFor(() => ({ multiple: peer, expected: ratio / peer, deviations: 1 }));
      L.set(id, { per1k: com / chats * 1000, total: com, mode: 'open' });
      const rec = { id, name: id, chats, ratio, days: 1, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats };
      JBF._internals.evaluate(rec);
      JBF._internals.setScoreFor(null);
      return rec;
    };
    // A hand-labelled bot that every other rule missed. 16.3 msg/chat on a
    // 2,635-token card is depth 6.2 — unremarkable, and the definition is
    // real, so no token rule could ever see it. What it was: 2.71x its
    // cohort with not one comment on 307 chats.
    for (const [name, preset] of Object.entries(JBF.PRESETS)) {
      await JBF.saveCfg(Object.assign({}, preset, { rule: 'thin', mode: 'hide',
        enabled: true, useLikes: true, suspected: [], whitelist: [] }));
      await sleep(30);
      const r = judge('hotel-' + name, 307, 16.31, 2635, 0, 2.71);
      ok(`${name}: it is hidden`, r.flagged && r.confident, r.reason);
      ok(`${name}: on the cohort rate, not the token count`,
         /what cards its size and age run at/.test(r.reason), r.reason);
    }
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.balanced, { rule: 'thin' }));
    await sleep(30);
    // Both halves are required. The quiet genuine cards top out at 2.17 on
    // the peer score; the ones above that all have people talking.
    ok('an odd rate with a busy comment section is not',
       !judge('loud', 1427, 24.81, 2951, 51, 2.39).flagged,
       judge('loud', 1427, 24.81, 2951, 51, 2.39).reason);
    ok('and a dead comment section at an ordinary rate is not either', (() => {
      const r = judge('ordinary', 1446, 19.29, 4074, 6, 1.84);
      return !(r.flagged && /what cards its size and age run at/.test(r.reason));
    })(), judge('ordinary', 1446, 19.29, 4074, 6, 1.84).reason);
    ok('the rule has its own switch', (() => {
      JBF.cfg.flagOddQuiet = false;
      const r = judge('off', 307, 16.31, 2635, 0, 2.71);
      JBF.cfg.flagOddQuiet = true;
      return !(r.flagged && r.confident);
    })());
    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe two depth tiers cannot be put out of order');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    // Inverted by hand: the "sure" line below the "suspect" line. Left alone
    // this collapses the middle tier and every marked card hides at once.
    await JBF.saveCfg({ thinScore: 15, depthSure: 11 });
    ok('an inverted pair is repaired on save', JBF.cfg.depthSure > JBF.cfg.thinScore,
       `${JBF.cfg.thinScore} -> ${JBF.cfg.depthSure}`);
    await JBF.saveCfg({ thinScore: 11, depthSure: 11 });
    ok('and so is a collapsed one', JBF.cfg.depthSure > JBF.cfg.thinScore,
       `${JBF.cfg.thinScore} -> ${JBF.cfg.depthSure}`);
    // Every preset ships ordered.
    const bad = Object.entries(JBF.PRESETS)
      .filter(([, p]) => !(p.depthSure > p.thinScore)).map(([n]) => n);
    ok('every preset ships with its tiers in order', bad.length === 0,
       bad.join(', ') || 'all three');
    // The guards each preset inherits have to keep clear of the populations
    // they were measured against: 26,652 chats is the smallest live card the
    // depth rule misreads, 4.66 the lowest genuine comment rate in the band.
    const tight = Object.entries(JBF.PRESETS).filter(([, p]) =>
      (p.trustAbove > 0 && 26652 / p.trustAbove < 1.25) ||
      (p.silenceRatio > 0 && 4.66 / p.silenceRatio < 1.25)).map(([n]) => n);
    ok('and with margin over what was actually measured', tight.length === 0,
       tight.join(', ') || 'all three clear 1.25x');
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nthe panel can switch the new rule off');
  await (async function () {
    const root = window.document.getElementById('jbf-panel-host').shadowRoot;
    const box = root.getElementById('flagSilence');
    ok('the silence rule has its own switch in the panel', !!box,
       box ? 'present' : 'missing');
    ok('and the switch is wired to the setting', (() => {
      if (!box) return false;
      const before = JBF.cfg.flagSilence;
      box.checked = !before;
      box.dispatchEvent(new window.Event('change'));
      const flipped = JBF.cfg.flagSilence !== before;
      box.checked = before;
      box.dispatchEvent(new window.Event('change'));
      return flipped;
    })());
  })();

  console.log('\nsilence is only readable inside the band it was measured in');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true, useLikes: true,
      flagSilence: true, suspected: [], whitelist: [] });
    await sleep(60);
    const L = JBF._internals.comments;
    // Real ages matter: at a made-up 30 days these cards look like they are
    // gaining thousands of chats a day and the velocity rule fires instead,
    // which would have made this block pass for the wrong reason.
    const judge = (id, chats, comments, ratio, tokens, days) => {
      L.set(id, { per1k: comments / chats * 1000, total: comments, mode: 'open' });
      days = days || 400;
      const rec = { id, name: id, chats, ratio, days, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats / days };
      JBF._internals.evaluate(rec); return rec;
    };
    const hides = r => !!(r.flagged && r.confident);

    // THE MEASUREMENT THIS RULE ALMOST SHIPPED WITHOUT. Across 74 live cards
    // past the chat floor, comments per 1,000 chats falls hard with size:
    // median 8.3 at 400-2k chats, 5.5 at 2k-7k, 3.2 at 7k-30k, 2.8 at
    // 30k-80k. A flat "under 4 per 1,000" cut — which the hand-labelled set
    // on its own appeared to support — hides 73% of the live sample. Every
    // card below is real, ordinary, and nobody's idea of botted.
    const ORDINARY_BIG = [
      ['gojo',        167638,  545, 12.0, 2638, 1072],
      ['levi',         26652,   50, 47.3, 1159, 1134],
      ['task-force',   66386,  241, 32.4, 4770,  798],
      ['chatgpt-plus',168834,  459, 20.1, 1599, 1120],
      ['naruto-rpg',   69459,  126, 64.1, 7471,  487],
      ['story-gen',    85844,   62, 33.6,  206,  979]
    ];
    const wronglyHidden = ORDINARY_BIG.filter(r => hides(judge.apply(null, r)))
      .map(r => r[0]);
    ok('six large ordinary cards, all under 4 comments per 1,000, survive',
       wronglyHidden.length === 0, wronglyHidden.join(', ') || 'all six kept');

    // Inside the band, the same rate is the whole verdict.
    ok('a card in the band with the same rate is hidden',
       hides(judge('in-band', 2281, 3, 12.5, 4800, 60)),
       judge('in-band', 2281, 3, 12.5, 4800, 60).reason);

    // The band ceiling (7,000) sits below the default guard (10,000), but the
    // cautious preset moves the guard to 6,000 — inside the band. Silence has
    // to respect it, or that preset hides a card the depth rule would only
    // mark, in the same breath.
    ok('silence respects the broad-audience guard too', (() => {
      const g = JBF.cfg.trustAbove;
      JBF.cfg.trustAbove = 6000;
      const r = judge('broad-quiet', 6500, 5, 12.0, 4000, 60);
      JBF.cfg.trustAbove = g;
      return !hides(r);
    })());

    ok('but not one just under the band',
       !hides(judge('too-small', 900, 1, 12.5, 4800, 60)),
       judge('too-small', 900, 1, 12.5, 4800, 60).reason);
    ok('and not one just over it',
       !hides(judge('too-big', 9000, 12, 12.5, 4800, 60)),
       judge('too-big', 9000, 12, 12.5, 4800, 60).reason);

    // The lowest ordinary rate measured in the band was 4.5; the highest
    // botted one 2.2. The threshold sits between them with room on each side.
    ok('the threshold keeps room on both sides of what was measured',
       JBF.cfg.silenceRatio > 2.2 * 1.25 && JBF.cfg.silenceRatio < 4.5 / 1.25,
       String(JBF.cfg.silenceRatio));
    ok('a card at the lowest ordinary rate measured is not touched',
       !hides(judge('ordinary-band', 5516, 25, 18.5, 6537, 60)),
       judge('ordinary-band', 5516, 25, 18.5, 6537, 60).reason);

    ok('the rule can be switched off on its own', (() => {
      JBF.cfg.flagSilence = false;
      const off = !hides(judge('in-band-2', 2281, 3, 12.5, 4800, 60));
      JBF.cfg.flagSilence = true;
      return off;
    })());

    // Spending a request on every card would be rude to the site and slow
    // for you. Only cards already in question, or sitting in the band where
    // silence is readable, are worth one.
    ok('no lookup is spent on a card outside the band that nothing flagged', (() => {
      const src = JBF._internals.askAboutFlagged
        ? JBF._internals.askAboutFlagged.toString() : '';
      return /silenceMinChats/.test(src) && /silenceMaxChats/.test(src);
    })());

    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\na broad audience is expensive to fake');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg({ rule: 'thin', mode: 'hide', enabled: true, suspected: [], whitelist: [] });
    await sleep(60);
    const judge = (chats, ratio, tokens, days) => {
      const rec = { id: 'b' + chats + tokens, name: 'x', chats, ratio, days, tokens,
        messages: Math.round(chats * ratio), publicChats: 0, chatsPerDay: chats / days };
      JBF._internals.evaluate(rec); return rec;
    };
    // Depth's premise is "not enough character there to talk that long", and
    // it breaks on one kind of card: the tiny famous utility card where the
    // PLAYER supplies everything. Seven live cards scored past the upper
    // tier on ratio alone — a 206-token Story Generator, a 120-token one
    // with 329,054 chats. All seven had 26,652 chats or more.
    const famousThin = judge(85844, 33.6, 206, 979);
    ok('a 206-token card with 85,844 chats is not hidden on its ratio',
       famousThin.flagged && !famousThin.confident, famousThin.reason);
    ok('and it says why it was spared',
       /too broad an audience/.test(famousThin.reason), famousThin.reason);
    // The same shape at a size a botter can actually reach is still hidden.
    const reachable = judge(900, 33.6, 206, 1);
    ok('the same card at 900 chats is hidden',
       reachable.flagged && reachable.confident, reachable.reason);
    ok('the guard sits in the gap between the two populations',
       JBF.cfg.trustAbove > 4181 && JBF.cfg.trustAbove < 26652,
       String(JBF.cfg.trustAbove));
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log('\nevery card labelled by hand over the life of this project');
  await (async function () {
    const was = JSON.parse(JSON.stringify(JBF.cfg));
    await JBF.saveCfg(Object.assign({}, JBF.PRESETS.balanced, {
      mode: 'hide', enabled: true, useLikes: true, flagSilence: true,
      suspected: [], whitelist: [], flagTrend: false, flagFlatGrowth: false,
      flagStaleRatio: false, flagVelocity: false }));
    await sleep(60);
    const L = JBF._internals.comments;
    // name, chats, messages, msg/chat, peer (null = never measured), tokens,
    // comments (-1 = never looked up), comment mode, hand label.
    const SET = [
      ['Alosha',                 44,  7893, 179.39, 50.49,  515,  0, 'open',          'bot'],
      ['Hotel booked the room',  307,  5008,  16.31,  2.71, 2635,  0, 'open',          'bot'],
      ['Undertale',             167,  5490,  32.87,  9.25, 1815,  0, 'disabled',      'bot'],
      ['School Queen Bee',      305,  5804,  19.03,  3.02, 1722,  1, 'open',          'bot'],
      ['I married a lesbian',   416, 10317,  24.80,  null,  639, 15, 'open',          'bot'],
      ['Apocalyptic Sanctuary', 503,  8114,  16.13,  null, 1452,  2, 'open',          'bot'],
      ['Sofia',                 742,  7938,  10.70,  null,  473, 14, 'open',          'bot'],
      ['Emily Sweaty',         1731, 24234,  14.00,  null, 2700,  3, 'open',          'bot'],
      ['Your Sweet Step Mom',  2281, 28513,  12.50,  null, 4800,  3, 'open',          'bot'],
      ['Friends w Apt',        4221, 70299,  16.65,  null, 2750,  9, 'open',          'bot'],
      ['dads new fiancee',      238,  4478,  18.82,  4.18, 2120, 21, 'open',          'legit'],
      ['Bully strawmanning',    317,  4589,  14.48,  2.21, 1355, 10, 'open',          'legit'],
      ['Succubus Crush',       2552, 37095,  14.54,  1.37, 1351, 24, 'open',          'legit'],
      ['Stuck in One Room',    2821, 63310,  22.44,  2.06, 2286, 19, 'open',          'legit'],
      ['Pregnant Cult Member',  829, 13345,  16.10,  1.82, 4359, -1, 'open',          'legit'],
      ['Kidnapped For Content',2495, 34460,  13.81,  1.30, 4919, 27, 'followed_only', 'legit'],
      ['Wife futa coworker',   2948, 37699,  12.79,  1.18, 3544, 15, 'open',          'legit'],
      ['No One Thinks',        6245,122891,  19.68,  1.52, 3521, 86, 'open',          'legit'],
      ['Yandere Best Friend',  5786, 60405,  10.44,  0.97, 3225, 63, 'open',          'legit'],
      ['heroines',             1787, 31451,  17.60,  null, 6598, 20, 'open',          'legit'],
      ['A Smile and a Smirk',  1707, 22351,  13.09,  1.24, 3330, 10, 'open',          'legit'],
      ['Betrayed Hero Party',  2577, 32575,  12.64,  1.19, 4006, 42, 'open',          'legit'],
      ['Arielle',              1238, 18758,  15.15,  1.36, 3834, 13, 'open',          'legit'],
      ['Your girlfriend cold', 1126, 14160,  12.58,  1.21, 1922, 14, 'open',          'legit'],
      ['Lonely MILF',          3839, 27771,   7.23,  0.66, 1688, 23, 'open',          'legit'],
      ['DeepSeek-chan',         272,  4151,  15.26,  null, 3614,  9, 'open',          'legit']
    ];
    const verdict = (row, tag) => {
      const [n, ch, msg, ratio, peer, tok, com, mode] = row;
      JBF._internals.setScoreFor(peer != null
        ? () => ({ multiple: peer, expected: ratio / peer, deviations: 1 })
        : () => null);
      const id = n + tag;
      if (com >= 0) L.set(id, { per1k: com / ch * 1000, total: com, mode });
      const rec = { id, name: n, chats: ch, ratio, tokens: tok, days: 1,
        messages: msg, publicChats: 0, chatsPerDay: ch };
      JBF._internals.evaluate(rec);
      JBF._internals.setScoreFor(null);
      return (rec.flagged && rec.confident) ? 'hidden' : rec.flagged ? 'marked' : 'clean';
    };
    for (const tag of ['-peer', '-nopeer']) {
      const useP = tag === '-peer';
      const v = r => verdict(useP ? r : r.slice(0, 4).concat([null], r.slice(5)), tag);
      const bots = SET.filter(r => r[8] === 'bot');
      const leg  = SET.filter(r => r[8] === 'legit');
      const missed = bots.filter(r => v(r) === 'clean').map(r => r[0]);
      const wrong  = leg.filter(r => v(r) === 'hidden').map(r => r[0]);
      const noise  = leg.filter(r => v(r) !== 'clean').map(r => r[0]);
      const label = useP ? 'with a learned baseline' : 'on a fresh install';
      // One card is only reachable once a baseline exists: its depth is 6.2
      // off a real 2,635-token definition, so no token rule can see it, and
      // what gives it away is 2.71x its cohort with a dead comment section.
      // Until the peer score exists there is nothing to catch it with.
      const needsBaseline = ['Hotel booked the room'];
      const reallyMissed = useP ? missed : missed.filter(n => !needsBaseline.includes(n));
      ok(`${label}: no botted card goes untouched`,
         reallyMissed.length === 0, reallyMissed.join(', ') || `all ${bots.length} caught`);
      if (!useP) {
        ok('and the one that needs a baseline is named, not quietly dropped',
           missed.every(n => needsBaseline.includes(n)), missed.join(', ') || 'none missed');
      }
      ok(`${label}: no genuine card is hidden`,
         wrong.length === 0, wrong.join(', ') || `none of the ${leg.length}`);
      ok(`${label}: and none of them is even marked`,
         noise.length === 0, noise.join(', ') || 'all clean');
    }
    L.clear();
    for (const k of Object.keys(JBF.cfg)) delete JBF.cfg[k];
    Object.assign(JBF.cfg, was);
    await JBF.saveCfg({});
  })();

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
