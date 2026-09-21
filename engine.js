/* =====================================================================
 * J.AI Bot Filter — engine
 * ---------------------------------------------------------------------
 * WHERE THE NUMBERS COME FROM
 *
 * The messages-per-chat ratio cannot be read off a card: the grid shows
 * total MESSAGES and PUBLIC (shared) chats, and the real chat count isn't
 * rendered at all. So this reads JanitorAI's own list API instead — the
 * same request the page just made, replayed from the performance timeline:
 *
 *   /hampter/characters?...  ->  { data: [ { id, stats:{chat,message},
 *                                  total_tokens, first_published_at, ... } ] }
 *
 * and matches records to cards by the uuid in their href.
 *
 * THE RULE
 *
 * A long conversation needs material, and the card's definition is that
 * material — reported as total_tokens on every listing. Messages-per-chat
 * divided by it, corrected for the card's age, is how much talk the card
 * produces per unit of content. A thin card cannot hold anyone for fifteen
 * messages, so when it reports that it did, something else produced them.
 *
 * Both numbers arrive in the listing the page already fetched, so the
 * default setup makes no extra requests, learns nothing, and never reads
 * your session token.
 *
 * The age term is not optional, and neither is any of the other scaling
 * here: across 401 live cards, median messages-per-chat is 8.4 in a card's
 * first two days and 30.8 past a year, on the same amount of character.
 * Every threshold in this file is therefore tied to the population it was
 * measured on — the recurring bug in this project has been applying one
 * calibrated on a day-old card to a two-year-old one.
 *
 * Two older rules remain, off the default path: a learned size-and-age
 * baseline ("Similar cards") and a fixed cut-off. Both are selectable;
 * neither runs unless you pick it.
 * ===================================================================== */

var JBF = (function () {
  'use strict';

  const API_RE = /\/hampter\/characters(\?|$)/;
  const UUID_RE = /\/characters\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  // ------------------------------------------------------------------
  // Config
  // ------------------------------------------------------------------

  const DEFAULTS = {
    enabled: true,
    mode: 'hide',              // 'hide' | 'badge'
    rule: 'thin',              // 'thin' | 'peer' | 'fixed'

    // THE MAIN RULE — see the note at the top of this file for the idea.
    //
    // Calibrated against cards labelled by hand, out of all 204 then on
    // 24-hour trending (score = msg/chat per 1k tokens, at one day old):
    //
    //   botted   Sofia 41.3 · Sasuke 19.0 · Alice 11.1 · Lonely 9.7
    //   genuine  No One Thinks 5.2 · heroines 2.2 · Popular Girls 2.0
    //
    // "Lonely" (1,115 chats, 14.9 msg/chat) and "heroines" (1,007, 14.6)
    // are the same card to any ratio test, and 4.4x apart here: 1,538
    // tokens against 6,598.
    flagThin: true,
    thinRatio: 10,             // only cards claiming real engagement are asked
    thinScore: 9,              // msg/chat per 1,000 tokens of character

    // Peer rule: flag cards above this percentile of similar-sized cards.
    // How many times the normal ratio counts as odd. Stated as a multiple
    // because that is a thing you can picture: 2.5 means "two and a half
    // times the messages per chat that cards of this size and age get".
    // Live sample past the chat floor: 2.5x flags 3.7%, 3x flags 2.3%.
    maxMultiple: 2.25,
    // Chat-inflation pushes the ratio DOWN (chats arrive, nobody talks), so
    // the low side is watched by default. The slider's span is split between
    // the two ends, so "5%" still means 5% of cards in total.
    peerLowSide: true,
    // The low side gets its own, more forgiving threshold. It is a different
    // claim — "chats arriving with nobody talking" — and a low ratio has
    // innocent explanations a high one doesn't: a genre people bounce off
    // after one message, a weak opener, a card that got linked somewhere.
    // Sharing one number meant tightening the high side quietly flagged
    // large, perfectly ordinary cards as chat-inflated.
    lowMultiple: 4.0,

    // Fixed rule.
    flagHigh: true,
    highRatio: 40,
    flagLow: false,
    lowRatio: 4,

    // Velocity: lifetime chats per day. Only meaningful once a card has
    // some history — on a page of same-day cards, chats/day is just the
    // chat count again, which flags the biggest card and nothing useful.
    flagVelocity: true,
    maxChatsPerDay: 2500,
    // Was 7 days, which is still inside the launch spike: the top card on
    // weekly trending was 7 days old and running 14,078 chats/day, and got
    // flagged for it. A lifetime average only means something once there is
    // a lifetime to average over. Measured on 401 live cards, nothing older
    // than 30 days came near the threshold (median 343/day, p99 2,698), so
    // this is a safety net rather than a working detector — which matches
    // the measurement that adding 20,000 fake chats to an established card
    // moves its lifetime rate by only 1.27x. The growth-shape rules are
    // what actually see a burst.
    minVelocityDays: 30,

    // Measured growth between two of your own sightings of a card. Lifetime
    // averages can't see a burst on an established card — adding 20k chats to
    // a year-old card moves its lifetime rate by about 1.3x, which crosses no
    // threshold. A delta does see it.
    flagTrend: true,
    minTrendRatio: 2,          // new chats arriving with almost no messages
    // A burst has to be a burst FOR THIS CARD. The rule used to compare a
    // two-hour delta against the lifetime threshold of 2,500/day, which a
    // genuinely hot card clears without trying — the top card on weekly
    // trending was running 14,078 chats/day honestly. Requiring the recent
    // rate to also be a multiple of the card's own lifetime rate makes it a
    // step change rather than a popularity contest.
    minTrendSpike: 5,

    // Growth SHAPE, not growth rate. Needs several sightings of the same
    // card, which browsing a listing daily gives you for free — cards sit
    // on Trending for days. Both are deliberately set where a real card
    // should never land, because these fire on evidence the ratio can't
    // supply and a false positive here is expensive.
    flagFlatGrowth: true,
    maxFlatness: 1.35,         // busiest stretch vs quietest, across sightings
    flagStaleRatio: true,
    maxRatioDrift: 0.45,       // fresh chats running at half the lifetime ratio

    // Which listings to act on. Inflated cards mostly surface on 24-hour
    // trending; by the time something reaches trending or popular it has
    // usually earned it. The filter still LEARNS from every list it sees —
    // only the judging is scoped.
    lists: { trending24: true, trending: false, popular: false, latest: false, other: false },

    // Above this many chats a card is not flagged on ratio alone. Chats are
    // the expensive half of the pair to fake, so a card that has drawn this
    // many has already demonstrated the audience its message count claims.
    // Set to 0 to judge every card on ratio regardless of size.
    trustAbove: 0,

    minChats: 50,              // don't judge cards with too little data
    minSamples: 150,           // no verdicts until the curve means something

    // The listing ranks by messages, so page 1 is where inflated cards
    // concentrate. Learning "normal" from only what's on screen lets the
    // suspects set the baseline — measured on a live page, that put normal
    // at 9.3 msg/chat where a broader sample says 5.5, which is enough to
    // hide the very cards it should catch. So pull deeper pages purely to
    // learn from; they are ordinary cards, not competing for the top.
    baselinePages: 8,

    // JanitorAI uses numbered pages, so there's no "load more" to click.
    // Instead we pull the next page's characters from the API and render
    // them into the holes left by hidden cards.
    replace: true,
    maxReplacementPages: 4,
    showPanel: true,
    // Bumped when a release changes what the filter does by default, so an
    // existing install doesn't stay pinned to a rule it was given months ago.
    cfgVersion: 5,

    whitelist: [],
    suspected: [],           // cards you have marked as botted yourself
    debug: false
  };

  const PRESETS = {
    cautious: { rule: 'thin', thinScore: 12, thinRatio: 12, maxMultiple: 3.5, lowMultiple: 5.0, peerLowSide: true, minChats: 100, trustAbove: 0 },
    balanced: { rule: 'thin', thinScore: 9, thinRatio: 10, maxMultiple: 2.25, lowMultiple: 4.0, peerLowSide: true, minChats: 50, trustAbove: 0 },
    strict:   { rule: 'thin', thinScore: 7, thinRatio: 8, maxMultiple: 1.9, lowMultiple: 3.0, peerLowSide: true, minChats: 25, trustAbove: 0 }
  };

  let cfg = Object.assign({}, DEFAULTS);
  let storage = null;

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  const api = new Map();       // character id -> raw API record
  const samples = new Map();   // character id -> [chats, messages]  (baseline store)
  const records = [];          // rendered cards
  const replayed = new Set();  // API urls already replayed
  const singleTried = new Set();
  // URLs WE invented (next-page lookups). They land in the browser's
  // resource timeline too, so without this the filter reads its own
  // requests back as "the list the page is showing" and starts pulling
  // replacements out of a completely different sort.
  const ownRequests = new Set();

  let observer = null, perfObserver = null;
  let scanQueued = false, panel = null, panelApi = null, started = false, saveTimer = null;

  let revealed = false;                 // "show hidden" toggle
  const pool = [];                      // vetted replacement characters
  const usedReplacements = new Set();
  const fetchedPages = new Set();
  let fillBusy = false;
  let replaceStatus = '';

  const trends = new Map();    // character id -> {dc, dm, hours, ts}
  const MIN_TREND_HOURS = 2;   // let the window grow before believing a delta
  const MIN_TREND_CHATS = 50;

  // A short history of each card, newest last: [timestamp, chats, messages].
  // One snapshot tells you a rate; several tell you its SHAPE, which is the
  // part a ratio cannot fake. Real traffic is lumpy — it follows the clock,
  // peaks in the evening and sags overnight. Traffic that has been bought
  // arrives at a rate someone configured, so it comes in flat, or in
  // identical bursts. This is the one axis where a botted card and a
  // genuinely popular one stop looking alike.
  const history = new Map();
  const HIST_MAX = 12;
  const HIST_MIN_GAP_H = 0.33;   // don't record the same page load twice
  const HIST_KEEP = 800;         // cards whose history is worth persisting
  const SHAPE_MIN_SPANS = 4;     // below this there is no shape to speak of
  // And it has to cover enough of the CLOCK. Simulated against a card whose
  // traffic follows a normal day (4:1 peak to trough) sampled at the
  // irregular intervals real browsing produces: over a 10-hour window a
  // perfectly ordinary card scored 1.08 and would have been flagged 87-100%
  // of the time, because ten hours sits inside one part of the day and there
  // is no variation to see. From 18 hours it never was, while metered
  // traffic was still caught every time.
  const SHAPE_MIN_HOURS = 18;
  const SHAPE_MAX_GAP_H = 8;     // sampled too coarsely to see a day's shape
  // The stale-ratio check has a bias of its own: a chat opened minutes
  // before the last sighting has barely any messages yet, so messages-per-
  // NEW-chat reads low on a healthy card. Over 2 hours a healthy card scores
  // 0.27 and would be flagged outright. Across conversation lengths from 3
  // to 18 hours it only clears the threshold with margin past 36 hours.
  const DRIFT_MIN_HOURS = 36;
  // Same bias, same fix, for "chats arriving with nobody talking".
  const TREND_RATIO_MIN_HOURS = 12;

  const MAX_SAMPLES = 4000;
  const MAX_API = 3000;
  const log = (...a) => { if (cfg.debug) console.log('[JBF]', ...a); };

  // ------------------------------------------------------------------
  // API capture
  // ------------------------------------------------------------------

  // The list API accepts page 1 anonymously but wants the site's own bearer
  // token for anything deeper. The app keeps it in the sb-*-auth-token
  // cookies; we read it in-page and send it to the same origin it came
  // from, exactly as the site does. It is never logged or sent anywhere else.
  let cachedToken = null, tokenChecked = false;

  // The token goes to janitorai.com and nowhere else. API_RE matches a path,
  // and a path can live on any host, so every URL is origin-checked before
  // it is fetched or given a header.
  function sameOrigin(u) {
    try { return new URL(u, location.href).origin === location.origin; }
    catch (e) { return false; }
  }

  function authToken() {
    if (tokenChecked) return cachedToken;
    tokenChecked = true;
    cachedToken = null;
    try {
      const jar = {};
      for (const part of document.cookie.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1);
      }
      const keys = Object.keys(jar).filter(k => /^sb-.*auth-token\.\d+$/.test(k)).sort();
      if (!keys.length) return null;
      let raw = keys.map(k => decodeURIComponent(jar[k])).join('');
      if (raw.startsWith('base64-')) raw = raw.slice(7);
      let session;
      try {
        session = JSON.parse(decodeURIComponent(escape(
          atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
      } catch (e) { session = JSON.parse(raw); }
      cachedToken = session.access_token ||
        (session.currentSession && session.currentSession.access_token) || null;
    } catch (e) { cachedToken = null; }
    return cachedToken;
  }

  function apiHeaders(url) {
    const h = { accept: 'application/json' };
    if (!sameOrigin(url)) return h;
    const t = authToken();
    if (t) h.authorization = 'Bearer ' + t;
    return h;
  }

  // One retry with a freshly-read token, in case it rotated mid-session.
  async function apiGet(url) {
    if (!sameOrigin(url)) throw new Error('refusing to call a cross-origin url');
    let r = await fetch(url, { headers: apiHeaders(url), credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) {
      tokenChecked = false;
      const t = authToken();
      if (t) r = await fetch(url, { headers: apiHeaders(url), credentials: 'same-origin' });
    }
    return r;
  }

  function apiUrls() {
    let out = [];
    try {
      out = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => API_RE.test(u) && sameOrigin(u) && !ownRequests.has(u));
    } catch (e) { /* no perf timeline */ }
    return out;
  }

  function ingest(list) {
    let added = 0;
    for (const c of (list || [])) {
      if (!c || !c.id || !c.stats) continue;
      const chat = c.stats.chat, message = c.stats.message;
      if (typeof chat !== 'number' || typeof message !== 'number') continue;
      if (!api.has(c.id)) added++;
      api.set(c.id, c);
      if (chat >= 1) {
        const pub = c.first_published_at || c.created_at;
        const t = pub ? Date.parse(pub) : NaN;
        noteSample(c.id, chat, message, isFinite(t) ? (Date.now() - t) / 864e5 : 0);
        noteHistory(c.id, chat, message);
      }
    }
    if (api.size > MAX_API) {
      const drop = api.size - MAX_API;
      let i = 0;
      for (const k of api.keys()) { if (i++ >= drop) break; api.delete(k); }
    }
    if (samples.size > MAX_SAMPLES) {
      const drop = samples.size - MAX_SAMPLES;
      let i = 0;
      for (const k of samples.keys()) { if (i++ >= drop) break; samples.delete(k); }
    }
    if (added) { queueSampleSave(); baselineDirty = true; }
    return added;
  }

  // Keep one snapshot per card and, when enough time has passed between two
  // sightings, the growth between them. The snapshot is deliberately NOT
  // refreshed on every sighting — otherwise browsing often would keep
  // resetting the clock and no window would ever mature.
  function noteSample(id, chat, message, ageDays) {
    const now = Date.now();
    const prev = samples.get(id);
    const age = ageDays > 0 ? ageDays : (prev && prev[3]) || 0;

    if (!prev) { samples.set(id, [chat, message, now, age]); return; }
    if (!prev[2]) { samples.set(id, [prev[0], prev[1], now, age]); return; }

    const hours = (now - prev[2]) / 36e5;
    if (hours < MIN_TREND_HOURS) {
      if (age && !prev[3]) samples.set(id, [prev[0], prev[1], prev[2], age]);
      return;
    }

    const dc = chat - prev[0], dm = message - prev[1];
    if (dc >= MIN_TREND_CHATS) trends.set(id, { dc, dm, hours, ts: now });
    samples.set(id, [chat, message, now, age]);
  }

  // Kept separately from the trend snapshot, and on a much shorter fuse:
  // the trend store deliberately holds one old reading so a window can
  // mature, which is the opposite of what a shape needs.
  function noteHistory(id, chat, message) {
    let h = history.get(id);
    if (!h) { h = []; history.set(id, h); }
    const now = Date.now(), last = h[h.length - 1];
    if (last) {
      if ((now - last[0]) / 36e5 < HIST_MIN_GAP_H) return;
      if (chat < last[1]) { h.length = 0; }        // counter reset; start again
    }
    h.push([now, chat, message]);
    if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX);
  }

  // What the growth between sightings looks like.
  //
  //   burstiness  fastest interval rate / slowest. Human traffic on a card
  //               this size swings by a lot across a day. A number near 1
  //               means the arrivals are being metered.
  //   incRatio    messages per chat among only the NEW chats. A card whose
  //               lifetime ratio is 17 but whose fresh chats run at 4 was
  //               inflated earlier and is coasting on the average.
  function growthShape(id, lifetimeRatio) {
    const h = history.get(id);
    if (!h || h.length < SHAPE_MIN_SPANS + 1) return null;
    const hours = (h[h.length - 1][0] - h[0][0]) / 36e5;
    if (hours < SHAPE_MIN_HOURS) return null;

    const rates = [];
    let dcTotal = 0, dmTotal = 0;
    for (let i = 1; i < h.length; i++) {
      const dt = (h[i][0] - h[i - 1][0]) / 36e5;
      const dc = h[i][1] - h[i - 1][1];
      if (dt <= 0 || dc < 0) continue;
      rates.push(dc / dt);
      dcTotal += dc; dmTotal += h[i][2] - h[i - 1][2];
    }
    if (rates.length < SHAPE_MIN_SPANS) return null;

    const gaps = [];
    for (let i = 1; i < h.length; i++) gaps.push((h[i][0] - h[i - 1][0]) / 36e5);
    gaps.sort((a, b) => a - b);
    const medGap = gaps[gaps.length >> 1] || 0;

    const sorted = rates.slice().sort((a, b) => a - b);
    // Compare typical-fast with typical-slow rather than the extremes, so
    // one stalled page load doesn't read as a quiet night.
    const lo = sorted[Math.floor(sorted.length * 0.25)];
    const hi = sorted[Math.floor(sorted.length * 0.75)];
    const burstiness = lo > 0.01 ? hi / lo : (hi > 0.01 ? Infinity : 1);
    const incRatio = dcTotal >= MIN_TREND_CHATS ? dmTotal / dcTotal : null;
    const drift = (incRatio !== null && lifetimeRatio > 0) ? incRatio / lifetimeRatio : null;
    return { spans: rates.length, hours, medGap, burstiness, incRatio, drift, gained: dcTotal };
  }

  // How this card sits against the creator's OTHER cards.
  //
  // This is not a follower count — deliberately, because that punished new
  // and small creators for being new and small. It compares a creator only
  // with themselves. Someone who buys traffic buys it for one card, so the
  // bought one stands apart from the rest of their shelf. A creator who
  // simply writes well has a shelf that rises together.
  let creatorCache = null, creatorCacheAt = -1, creatorBuilding = false;
  let creatorWalks = 0;   // guarded by a test: this must not scale with page size
  function creatorIndex() {
    if (creatorCache && creatorCacheAt === lastRebuild) return creatorCache;
    // scoreFor() below can trigger a rebuild, which moves lastRebuild and
    // would otherwise invalidate the cache we are in the middle of filling.
    if (creatorBuilding) return creatorCache || new Map();
    creatorBuilding = true;
    creatorWalks++;
    const byCreator = new Map();
    for (const c of api.values()) {
      const cid = c && c.creator_id;
      if (!cid || !c.stats || !(c.stats.chat >= cfg.minChats)) continue;
      const pub = c.first_published_at || c.created_at;
      const t = pub ? Date.parse(pub) : NaN;
      const days = isFinite(t) ? (Date.now() - t) / 864e5 : 0;
      const sc = scoreFor(c.stats.chat, c.stats.message / c.stats.chat, days);
      if (!sc) continue;
      if (!byCreator.has(cid)) byCreator.set(cid, []);
      byCreator.get(cid).push({ id: c.id, multiple: sc.multiple, chats: c.stats.chat });
    }
    creatorCache = byCreator; creatorCacheAt = lastRebuild;
    creatorBuilding = false;
    return byCreator;
  }

  function creatorShape(rec) {
    const raw = api.get(rec.id);
    const cid = raw && raw.creator_id;
    if (!cid) return null;
    const all = creatorIndex().get(cid);
    if (!all || all.length < 3) return null;          // need a shelf to compare to
    const others = all.filter(c => c.id !== rec.id);
    if (others.length < 2) return null;
    const ms = others.map(c => c.multiple).sort((a, b) => a - b);
    const med = ms[ms.length >> 1];
    const big = others.filter(c => c.chats >= rec.chats * 0.5).length;
    return {
      cards: all.length,
      othersMedian: med,
      standsApart: med > 0 ? (rec.multiple || 0) / med : null,
      peersNearItsSize: big
    };
  }

  async function replayApi() {
    const urls = apiUrls().filter(u => !replayed.has(u));
    if (!urls.length) return 0;
    let added = 0;
    for (const u of urls.slice(0, 12)) {
      replayed.add(u);
      try {
        const r = await apiGet(u);
        if (!r.ok) continue;
        const j = await r.json();
        added += ingest(j && j.data);
      } catch (e) { log('replay failed', u, e); }
    }
    return added;
  }

  // Cards the list responses didn't cover (a character page, a carousel).
  let singleQueue = [], singleBusy = 0;
  const SINGLE_MAX = 3;

  function queueSingle(id) {
    if (api.has(id) || singleTried.has(id)) return;
    singleTried.add(id);
    singleQueue.push(id);
    pumpSingles();
  }

  function pumpSingles() {
    while (singleBusy < SINGLE_MAX && singleQueue.length) {
      const id = singleQueue.shift();
      singleBusy++;
      apiGet('/hampter/characters/' + id)
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (j) ingest([j.id ? j : j.character]); })
        .catch(() => {})
        .then(() => { singleBusy--; if (singleQueue.length) pumpSingles(); else queueScan(); });
    }
  }

  // ------------------------------------------------------------------
  // Baseline — what a card of this size normally looks like
  // ------------------------------------------------------------------
  //
  // Percentiles were the wrong tool: they flag a fixed share by construction,
  // so a page of perfectly ordinary cards still lost 5% of it. This instead
  // fits a curve and measures how far a card sits from it.
  //
  //   x = log10(chats),  y = ln(messages / chats)
  //   expected y = median y of the ~K nearest cards in x (no bucket edges)
  //   score     = (y - expected) / robust spread on that side of the curve
  //
  // The spread is a MAD taken separately above and below the fit, because
  // the residuals are not symmetric — low ratios are common, high ones rare.
  // A score is then an absolute statement: on a live 2,135-card sample a
  // typical 34-card page contains 0.14 cards past 3.5. Usually nothing.

  // ---- the "Similar cards" rule (optional; off by default) ------------
  //
  // Expectation fitted from cards you have browsed, conditioned on size AND
  // age, because those are different populations: a 19-hour-old card with
  // 900 chats sits near 5 msg/chat, a two-year-old with 900k sits near 25.
  //
  //   x = log10(chats)   a = log10(age in days)   y = ln(messages / chats)
  //   score = (y - expected at (x, a)) / robust spread on that side
  //
  // Precomputed on a coarse grid and interpolated, so a page costs a few
  // lookups rather than a nearest-neighbour scan.

  // Fitted on 401 live cards spanning four listings and ages from hours to
  // three years: the exponent that flattens the depth score across age.
  const THIN_AGE_POWER = 0.28;

  const GX = 22, GA = 14;
  // Leave-one-out on 1,954 live cards: a neighbourhood of ~81 fits better
  // than 151 (median |residual| 0.231 vs 0.236).
  const NEIGHBOURS = 81;
  // Age is a HARD band, not a weighted axis. Day-old cards sit near 5
  // msg/chat at every size; established ones climb from 4 to 36. A weighted
  // axis lets the fit walk between those populations when one runs short of
  // neighbours — a browser whose day-old samples stopped at 800 chats was
  // told "normal" for a DAY-OLD card with 3,259 was 25.5, the established
  // figure, so everything past the crossover scored at half its true value.
  // Each age row is now fitted only from cards of comparable age.
  const AGE_BAND = 0.25;      // log10 days: within a factor of ~1.8
  const MIN_BAND = 60;        // widen the band until it holds this many
  // Where the spread is tight, a card can be well outside local norms while
  // still under the multiple. These add sensitivity there; they never relax
  // it elsewhere, because scaling the threshold by local spread would let
  // contamination raise its own bar.
  const TIGHT_DEVIATIONS = 4, TIGHT_MIN_MULTIPLE = 1.4;
  // What counts as an outlier when cleaning the baseline. Fixed on purpose:
  // tying it to the user's threshold meant a permissive setting left the
  // contamination in the fit, which is exactly when it matters most.
  const TRIM_MULTIPLE = 2.5;

  let fit = [];                 // [{x, a, y}]
  let gxs = [], gas = [], gz = [], gs = [];
  let fitReady = false;
  let baselineDirty = true;
  let lastRebuild = 0;

  function medianOf(sorted) {
    return sorted.length ? sorted[sorted.length >> 1] : 0;
  }

  // Median of values weighted by how close each neighbour is.
  function weightedMedian(pairs) {          // [weight, value]
    const s = pairs.slice().sort((p, q) => p[1] - q[1]);
    let total = 0;
    for (const p of s) total += p[0];
    let acc = 0;
    for (const p of s) { acc += p[0]; if (acc >= total / 2) return p[1]; }
    return s.length ? s[s.length - 1][1] : 0;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  // Expectation along one age band, at one size: a robust LOCAL LINE.
  //
  // "Line" is the word that matters. A local median has no slope, so where
  // the sizes thin out it regresses toward the dense part of the data
  // instead of continuing the trend — and a listing is exactly that shape,
  // hundreds of small cards from deeper pages against a few dozen big ones
  // from page 1. The curve collapsed to one flat number and every large
  // card got far too low a bar.
  //
  // A line keeps the slope where the data thins while still following a
  // curve that bends: on a 2,000-card synthetic of the real site-wide
  // shape it recovers 7.9 / 4.3 / 9.8 / 35.8 / 36.3 / 23.2 as
  // 7.3 / 4.3 / 10.2 / 34.1 / 37.7 / 22.6 across five decades, dip included.
  //
  // Tricube distance weights, then two bisquare passes so a few inflated
  // neighbours cannot tilt it.
  function localLine(pts, x, K) {
    const d = [];
    for (let i = 0; i < pts.length; i++) d.push([Math.abs(pts[i].x - x), pts[i]]);
    d.sort((p, q) => p[0] - q[0]);
    const near = d.slice(0, K);
    if (near.length < 8) return null;

    const h = Math.max(1e-6, near[near.length - 1][0]);
    let w = near.map(p => Math.pow(1 - Math.pow(p[0] / h, 3), 3));

    const solve = () => {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < near.length; i++) {
        const W = w[i], P = near[i][1];
        sw += W; sx += W * P.x; sy += W * P.y; sxx += W * P.x * P.x; sxy += W * P.x * P.y;
      }
      const den = sw * sxx - sx * sx;
      if (!(Math.abs(den) > 1e-12) || !(sw > 0)) return { a: sw > 0 ? sy / sw : 0, b: 0 };
      const bb = (sw * sxy - sx * sy) / den;
      return { a: (sy - bb * sx) / sw, b: bb };
    };

    let f = solve();
    for (let pass = 0; pass < 2; pass++) {
      const res = near.map(p => Math.abs(p[1].y - (f.a + f.b * p[1].x)));
      const sorted = res.slice().sort((p, q) => p - q);
      const scale = 6 * (sorted[sorted.length >> 1] || 0) || 1e-9;
      w = w.map((W, i) => W * Math.pow(Math.max(0, 1 - Math.pow(res[i] / scale, 2)), 2));
      f = solve();
    }
    const res = near.map(p => Math.abs(p[1].y - (f.a + f.b * p[1].x))).sort((p, q) => p - q);
    return { y: f.a + f.b * x, spread: res[res.length >> 1] || 0 };
  }

  function buildGrid(pool) {
    gz = []; gs = [];
    for (let i = 0; i < GX; i++) { gz.push(new Array(GA).fill(0)); gs.push(new Array(GA).fill(0)); }

    for (let j = 0; j < GA; j++) {
      // Age stays a hard band. Day-old cards and established ones are
      // different populations and must never be fitted together — a card
      // a day old is capped by the clock, not by how good it is.
      let w = AGE_BAND, band = [];
      for (let t = 0; t < 14 && band.length < MIN_BAND; t++, w *= 1.5) {
        band = pool.filter(p => Math.abs(p.a - gas[j]) <= w);
      }
      if (band.length < MIN_BAND) band = pool;
      const K = Math.min(NEIGHBOURS, Math.max(20, Math.round(band.length * 0.25)));

      let last = null;
      for (let i = 0; i < GX; i++) {
        const f = localLine(band, gxs[i], K) || last;
        if (!f) continue;
        last = f;
        gz[i][j] = f.y; gs[i][j] = f.spread;
      }
    }
  }

  function rebuildBaseline() {
    baselineDirty = false;
    lastRebuild = Date.now();

    fit = [];
    for (const pair of samples.values()) {
      const chats = pair[0], messages = pair[1], ageDays = pair[3];
      if (!(chats >= 1) || !(messages > 0) || !(ageDays > 0)) continue;
      // Calibrate only on cards we would actually judge. Tiny cards are wild
      // (ratios of 1 and of 200 both occur at 3 chats) and including them
      // inflates the spread, which drags genuine outliers back toward normal.
      if (chats < cfg.minChats) continue;
      fit.push({
        x: Math.log10(chats),
        a: Math.log10(Math.max(ageDays, 0.04)),
        y: Math.log(messages / chats)
      });
    }

    fitReady = fit.length >= cfg.minSamples;
    if (!fitReady) return;

    let x0 = Infinity, x1 = -Infinity, a0 = Infinity, a1 = -Infinity;
    for (const p of fit) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.a < a0) a0 = p.a; if (p.a > a1) a1 = p.a;
    }
    if (x1 - x0 < 1e-6) x1 = x0 + 1e-6;
    if (a1 - a0 < 1e-6) a1 = a0 + 1e-6;

    gxs = []; gas = [];
    for (let i = 0; i < GX; i++) gxs.push(x0 + (x1 - x0) * (i / (GX - 1)));
    for (let j = 0; j < GA; j++) gas.push(a0 + (a1 - a0) * (j / (GA - 1)));

    buildGrid(fit);

    // One trimmed refit. The baseline is built from whatever you browse,
    // which includes inflated cards; letting them set "normal" pulls the
    // curve toward them. Dropping the obvious outliers once and refitting
    // gives an expectation of what an ordinary card does.
    const kept = fit.filter(p => {
      const m = Math.exp(p.y - expectedAt(p.x, p.a));
      return m <= TRIM_MULTIPLE && m >= 1 / TRIM_MULTIPLE;
    });
    if (kept.length >= cfg.minSamples) buildGrid(kept);
  }

  function axisPos(axis, v) {
    if (v <= axis[0]) return { i: 0, t: 0 };
    if (v >= axis[axis.length - 1]) return { i: axis.length - 2, t: 1 };
    let i = 1;
    while (i < axis.length && axis[i] < v) i++;
    const lo = axis[i - 1], hi = axis[i];
    return { i: i - 1, t: hi === lo ? 0 : (v - lo) / (hi - lo) };
  }

  function bilinear(grid, x, a) {
    if (!grid.length) return 0;
    const px = axisPos(gxs, x), pa = axisPos(gas, a);
    const v00 = grid[px.i][pa.i], v10 = grid[px.i + 1][pa.i];
    const v01 = grid[px.i][pa.i + 1], v11 = grid[px.i + 1][pa.i + 1];
    return (v00 * (1 - px.t) + v10 * px.t) * (1 - pa.t) +
           (v01 * (1 - px.t) + v11 * px.t) * pa.t;
  }

  const expectedAt = (x, a) => bilinear(gz, x, a);
  const spreadAt = (x, a) => bilinear(gs, x, a);

  function ensureFit() {
    if (baselineDirty && Date.now() - lastRebuild > 1500) rebuildBaseline();
    else if (baselineDirty && !fitReady) rebuildBaseline();
  }

  // What's normal for a card of this size AND age, and how far past it this is.
  function scoreFor(chats, ratio, ageDays) {
    ensureFit();
    if (!fitReady || !(chats >= 1) || !(ratio > 0) || !(ageDays > 0)) return null;
    const x = Math.log10(chats), a = Math.log10(Math.max(ageDays, 0.04));
    const expected = Math.exp(expectedAt(x, a));
    const spread = spreadAt(x, a);
    const multiple = ratio / expected;
    // How far out it is measured against how much cards like it actually vary.
    const deviations = spread > 1e-6 ? Math.abs(Math.log(multiple)) / spread : 0;
    return { expected, multiple, spread, deviations };
  }

  // Share of everything seen that the current setting flags — counted, not assumed.
  function flagRate() {
    ensureFit();
    if (!fitReady || !fit.length) return null;
    let hit = 0, seen = 0;
    const step = Math.max(1, Math.floor(fit.length / 800));
    for (let i = 0; i < fit.length; i += step) {
      const p = fit[i];
      const m = Math.exp(p.y - expectedAt(p.x, p.a));
      const sp = spreadAt(p.x, p.a);
      const dev = sp > 1e-6 ? Math.abs(Math.log(m)) / sp : 0;
      const tight = dev > TIGHT_DEVIATIONS &&
        (m > TIGHT_MIN_MULTIPLE || (cfg.peerLowSide && m < 1 / TIGHT_MIN_MULTIPLE));
      seen++;
      if (m > cfg.maxMultiple || (cfg.peerLowSide && m < 1 / cfg.maxMultiple) || tight) hit++;
    }
    return seen ? 100 * hit / seen : null;
  }

  // ------------------------------------------------------------------
  // Card discovery — match rendered cards to API records by uuid
  // ------------------------------------------------------------------

  function idFromHref(href) {
    const m = UUID_RE.exec(href || '');
    return m ? m[1].toLowerCase() : null;
  }

  function cardRootFor(a) {
    let el = a, best = null;
    for (let depth = 0; depth < 7 && el && el !== document.body; depth++) {
      const parent = el.parentElement;
      if (!parent) break;
      const ids = new Set();
      parent.querySelectorAll('a[href*="/characters/"]').forEach(x => {
        const id = idFromHref(x.getAttribute('href'));
        if (id) ids.add(id);
      });
      if (ids.size > 1) break;      // parent holds a sibling card — stop here
      best = parent;
      el = parent;
    }
    return best || a;
  }

  // The results grid: the known container, else whichever element directly
  // holds the most character cards.
  function mainGrid() {
    const known = document.querySelector(GRID_SELECTOR);
    if (known) return known;

    const counts = new Map();
    for (const a of document.querySelectorAll('a[href*="/characters/"]')) {
      if (!idFromHref(a.getAttribute('href'))) continue;
      if (a.closest(NOT_GRID)) continue;
      const card = cardRootFor(a);
      const holder = card && card.parentElement;
      if (!holder) continue;
      counts.set(holder, (counts.get(holder) || 0) + 1);
    }
    let best = null, n = 0;
    for (const [el, c] of counts) if (c > n) { best = el; n = c; }
    return best;
  }

  function findCards() {
    const out = [];
    const grid = mainGrid();
    if (!grid) return out;
    for (const a of grid.querySelectorAll('a[href*="/characters/"]')) {
      if (a.closest(NOT_GRID)) continue;
      const id = idFromHref(a.getAttribute('href'));
      if (!id) continue;
      const rec = api.get(id);
      if (!rec) { queueSingle(id); continue; }

      const root = cardRootFor(a);
      if (!root || root.dataset.jbfSeen === id) continue;
      if (records.some(r => r.id === id && r.root === root)) continue;

      const chats = rec.stats.chat, messages = rec.stats.message;
      if (chats < 1) continue;

      const published = rec.first_published_at || rec.created_at;
      const days = published ? Math.max(1, (Date.now() - new Date(published)) / 864e5) : null;

      // A framework can recycle a card node for a different character; drop
      // any stale record pointing at this same element first.
      for (let i = records.length - 1; i >= 0; i--) {
        if (records[i].root === root) records.splice(i, 1);
      }
      root.dataset.jbfSeen = id;
      out.push({
        root, id,
        href: a.getAttribute('href'),
        name: rec.name || '(unnamed)',
        creator: rec.creator_name || '',
        chats, messages,
        ratio: messages / chats,
        publicChats: rec.public_chat_count,
        // The card-depth rule reads this. Leaving it off meant every record
        // built from a real page had no token count, so that rule quietly
        // declined to judge anything and nothing was ever filtered. The
        // hand-built records in the tests had it, which is why they passed.
        tokens: typeof rec.total_tokens === 'number' ? rec.total_tokens : null,
        days,
        chatsPerDay: days ? chats / days : null,
        trend: trends.get(id) || null,
        flagged: false, reason: '', multiple: null, expected: null,
        isReplacement: root.hasAttribute('data-jbf-replacement'),
        replacedBy: null
      });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // The rule
  // ------------------------------------------------------------------

  function evaluate(rec) {
    rec.flagged = false;
    rec.reason = '';
    rec.multiple = null;
    rec.expected = null;
    if (!cfg.enabled) return rec;

    // Always compute the peer percentile, even when another rule decides
    // the verdict — it's the number worth reading in the export.
    // Talk per 1,000 tokens of character, at this card's age. No baseline,
    // no neighbours, no history.
    //
    // The age term is not optional: across 401 live cards, median
    // messages-per-chat is 8.4 in a card's first two days and 30.8 past a
    // year on the SAME amount of character (2,754 tokens young, 1,413 old).
    // Uncorrected, a threshold tuned on 24-hour trending flagged 91% of the
    // Popular listing. Dividing by age^0.28 flattens the median across every
    // age bucket to within 1.16x (was 7.1x) and takes Popular to 7%.
    rec.thin = (rec.tokens > 0 && rec.ratio > 0)
      ? rec.ratio / Math.max(50, rec.tokens) * 1000 /
        Math.pow(Math.max(1, rec.days || 1), THIN_AGE_POWER)
      : null;

    const sc = scoreFor(rec.chats, rec.ratio, rec.days);
    rec.multiple = sc ? sc.multiple : null;
    rec.expected = sc ? sc.expected : null;
    rec.deviations = sc ? sc.deviations : null;
    rec.shape = growthShape(rec.id, rec.ratio);
    rec.suspected = (cfg.suspected || []).includes(rec.id);
    // NOT creatorShape() — that walks every card the session has cached and
    // scores each one. evaluate() runs once per candidate while vetting
    // replacements, so calling it here made filling the page quadratic and
    // it simply never finished. It is worked out on demand instead, for the
    // export and the badge, where it is wanted once rather than per card.

    // Scoring happens everywhere so the numbers are always there to read;
    // acting on them is scoped to the listings you've switched on.
    if (!activeHere()) { rec.reason = 'not filtering this listing'; return rec; }

    if (cfg.whitelist.includes(rec.id)) { rec.reason = 'you marked this one as fine'; return rec; }

    // Measured growth first: it's the only thing that sees a burst on an
    // established card, where the lifetime average barely moves.
    const t = rec.trend;
    if (cfg.flagTrend && t && t.dc >= MIN_TREND_CHATS) {
      const perDay = t.dc / (t.hours / 24);
      const newRatio = t.dc > 0 ? t.dm / t.dc : null;
      // Against the card's own lifetime rate, not just an absolute number.
      const spike = rec.chatsPerDay > 0 ? perDay / rec.chatsPerDay : Infinity;
      if (perDay > cfg.maxChatsPerDay && spike >= cfg.minTrendSpike) {
        rec.flagged = true;
        rec.reason = `gained ${Math.round(t.dc).toLocaleString('en-US')} chats in ` +
          `${t.hours < 48 ? Math.round(t.hours) + 'h' : Math.round(t.hours / 24) + 'd'} ` +
          `(${Math.round(perDay).toLocaleString('en-US')}/day, ` +
          `${spike === Infinity ? 'from nothing' : Math.round(spike) + 'x its usual'})`;
        return rec;
      }
      if (newRatio !== null && t.hours >= TREND_RATIO_MIN_HOURS &&
          newRatio < cfg.minTrendRatio) {
        rec.flagged = true;
        rec.reason = `gained ${Math.round(t.dc).toLocaleString('en-US')} chats but only ` +
          `${Math.round(t.dm).toLocaleString('en-US')} messages since you last saw it`;
        return rec;
      }
    }

    // Shape of that growth across several sightings. This is the one thing
    // here that a high ratio cannot imitate: a card people actually like
    // gets busy in the evening and quiet at 4am, and a card being fed at a
    // configured rate does not.
    const g = rec.shape;
    if (g) {
      if (cfg.flagFlatGrowth && g.spans >= 5 &&
          g.hours >= SHAPE_MIN_HOURS && g.medGap <= SHAPE_MAX_GAP_H &&
          isFinite(g.burstiness) && g.burstiness < cfg.maxFlatness) {
        rec.flagged = true;
        rec.reason = `chats arriving at a near-constant rate for ${Math.round(g.hours)}h ` +
          `(busiest stretch only ${g.burstiness.toFixed(2)}x the quietest)`;
        return rec;
      }
      if (cfg.flagStaleRatio && g.drift !== null && g.gained >= 150 &&
          g.hours >= DRIFT_MIN_HOURS && g.drift < cfg.maxRatioDrift) {
        rec.flagged = true;
        rec.reason = `its ${rec.ratio.toFixed(1)} msg/chat is history — the ` +
          `${Math.round(g.gained).toLocaleString('en-US')} chats since you first saw it ` +
          `are running at ${g.incRatio.toFixed(1)}`;
        return rec;
      }
    }

    // Velocity needs real history. Under minVelocityDays the lifetime
    // average is just the launch spike, and on a page where every card was
    // published today it degenerates into "biggest chat count wins".
    if (cfg.flagVelocity && rec.chatsPerDay && rec.days >= cfg.minVelocityDays
        && rec.chatsPerDay > cfg.maxChatsPerDay) {
      rec.flagged = true;
      rec.reason = `${Math.round(rec.chatsPerDay).toLocaleString('en-US')} chats/day over ${Math.round(rec.days)} days`;
      return rec;
    }

    if (rec.chats < cfg.minChats) { rec.reason = 'below sample floor'; return rec; }

    // Thin card carrying a big conversation count. Scoped to its own rule:
    // picking "a fixed number" or "cards of similar size" should give you
    // that and nothing else. The depth number is still computed under every
    // rule, because the guard below and the export both read it.
    if (cfg.flagThin && cfg.rule === 'thin' && rec.thin !== null &&
        rec.ratio > cfg.thinRatio && rec.thin > cfg.thinScore) {
      rec.flagged = true;
      rec.reason = `${rec.ratio.toFixed(1)} msg/chat from a ` +
        `${rec.tokens.toLocaleString('en-US')}-token card \u2014 not enough character ` +
        `there to talk that long`;
      return rec;
    }
    if (cfg.rule === 'thin' && rec.thin !== null) {
      rec.reason = `${rec.thin.toFixed(1)} msg/chat per 1k tokens \u2014 within reason`;
      return rec;
    }
    // No token count on this card (an older cached record, or a field the
    // site stopped sending). Fall through to the size-and-age rule rather
    // than declining to judge it — degrading beats going silent.

    if (cfg.rule === 'fixed') {
      if (cfg.flagHigh && rec.ratio > cfg.highRatio) {
        rec.flagged = true;
        rec.reason = `${rec.ratio.toFixed(1)} msg/chat — above ${cfg.highRatio}`;
      } else if (cfg.flagLow && rec.ratio < cfg.lowRatio) {
        rec.flagged = true;
        rec.reason = `${rec.ratio.toFixed(1)} msg/chat — below ${cfg.lowRatio}`;
      }
      return rec;
    }

    if (!sc) { rec.reason = 'still learning what\'s normal'; return rec; }

    // Audience breadth (off by default; the depth rule prices size in).
    // Chats are the expensive half of the pair to fake — each one is
    // another account — so past `trustAbove` a high ratio is taken as real.
    // Guards the HIGH side only: the low side is the chat-inflation attack,
    // and exempting big cards from it would blind the filter to the one
    // thing a chat count can itself be lying about.
    const broadAudience = cfg.trustAbove > 0 && rec.chats >= cfg.trustAbove;
    if (broadAudience) rec.trusted = true;

    // If the card has enough character behind it to account for its ratio,
    // the ratio is not evidence against it — whatever the baseline thinks.
    // Measured on the live 24-hour list: a genuine 6,598-token card scored
    // 2.25x here while a botted 1,538-token one scored 2.19x. The peer rule
    // had them the wrong way round, and only the depth number could tell.
    const earnsIt = rec.thin !== null && rec.thin <= cfg.thinScore;
    if (earnsIt) rec.earnsIt = true;

    const high = !broadAudience && !earnsIt && sc.multiple > cfg.maxMultiple;
    const lowCut = 1 / (cfg.lowMultiple || cfg.maxMultiple);
    const low = cfg.peerLowSide && sc.multiple < lowCut;

    // Cards in a tightly-clustered part of the distribution — the very large
    // ones — can be far outside local norms while still under the multiple.
    // Without this the ratio rule never touches them at all.
    const tight = sc.deviations > TIGHT_DEVIATIONS &&
      ((!broadAudience && !earnsIt && sc.multiple > TIGHT_MIN_MULTIPLE) ||
       (cfg.peerLowSide && sc.multiple < 1 / TIGHT_MIN_MULTIPLE));

    if (earnsIt && sc.multiple > cfg.maxMultiple) {
      rec.reason = `${sc.multiple.toFixed(1)}x the normal ratio, but there are ` +
        `${rec.tokens.toLocaleString('en-US')} tokens of character behind it`;
    }
    if (broadAudience && sc.multiple > cfg.maxMultiple) {
      rec.reason = `${sc.multiple.toFixed(1)}x the normal ratio, but ` +
        `${fmt(rec.chats)} separate chats — too broad an audience to be cheap to fake`;
    }

    if (high || (tight && sc.multiple > 1)) {
      rec.flagged = true;
      rec.reason = high
        ? `${rec.ratio.toFixed(1)} msg/chat — ${sc.multiple.toFixed(1)}x the ` +
          `${sc.expected.toFixed(1)} normal for a card this size and age`
        : `${rec.ratio.toFixed(1)} msg/chat — only ${sc.multiple.toFixed(1)}x the ` +
          `${sc.expected.toFixed(1)} normal, but cards this size barely vary`;
    } else if (low || tight) {
      rec.flagged = true;
      rec.reason = `${rec.ratio.toFixed(1)} msg/chat — ${(1 / sc.multiple).toFixed(1)}x ` +
        `below the ${sc.expected.toFixed(1)} normal for its size and age, ` +
        `chats without conversation`;
    }
    return rec;
  }

  // ------------------------------------------------------------------
  // Applying verdicts
  // ------------------------------------------------------------------

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  function applyAll() {
    prune();
    let hidden = 0;
    for (const rec of records) {
      evaluate(rec);
      applyOne(rec);
      if (rec.flagged && cfg.mode === 'hide') hidden++;
    }
    if (panelApi) panelApi.refresh();
    // Always reconcile: it also has to hand replacements BACK when the
    // threshold tightens or hide mode is switched off, which never happens
    // if this only runs when something is currently hidden.
    fillGaps();
    return hidden;
  }

  function applyOne(rec) {
    const el = rec.root;
    if (!el || !el.isConnected) return;

    if (rec.flagged && cfg.mode === 'hide' && cfg.enabled && !revealed) {
      el.setAttribute('data-jbf', 'hidden');
      el.style.setProperty('display', 'none', 'important');
      removeBadge(el);
      return;
    }
    if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');

    if (rec.flagged && cfg.enabled) {
      el.setAttribute('data-jbf', 'flagged');
      addBadge(el, rec);
    } else {
      el.setAttribute('data-jbf', 'ok');
      removeBadge(el);
    }
  }

  function addBadge(el, rec) {
    let b = el.querySelector(':scope > .jbf-badge');
    if (!b) {
      b = document.createElement('div');
      b.className = 'jbf-badge';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      // Where the numbers can't decide, your judgement should. One click
      // marks a card as fine and it is never flagged again.
      b.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = b.getAttribute('data-jbf-id');
        if (!id) return;
        // Shift-click is the other half of the judgement: it records that
        // YOU believe this card is botted. Nothing is hidden on the
        // strength of it — it goes into the export as a label, so a run of
        // cards you are sure about can be checked against every signal at
        // once and settle what actually separates them.
        if (ev.shiftKey) {
          const sus = (cfg.suspected || []).slice();
          const at = sus.indexOf(id);
          if (at === -1) sus.push(id); else sus.splice(at, 1);
          saveCfg({ suspected: sus });
          return;
        }
        const list = (cfg.whitelist || []).slice();
        if (list.indexOf(id) === -1) list.push(id);
        saveCfg({ whitelist: list });
      }, true);
      el.appendChild(b);
    }
    b.setAttribute('data-jbf-id', rec.id);
    b.textContent = rec.ratio.toFixed(1) + ' m/c';
    b.title =
      `${rec.name}\n` +
      `${fmt(rec.chats)} chats · ${fmt(rec.messages)} messages · ` +
      `${rec.ratio.toFixed(1)} msg/chat\n` +
      (rec.tokens ? `${fmt(rec.tokens)}-token card, ${Math.round(rec.days)}d old ` +
        `\u2192 depth score ${rec.thin != null ? rec.thin.toFixed(1) : '?'} ` +
        `(threshold ${cfg.thinScore})\n` : '') +
      (rec.expected != null ? `normal for this size and age: ${rec.expected.toFixed(1)} msg/chat ` +
        `(this is ${rec.multiple.toFixed(1)}x)\n` : '') +
      (rec.deviations ? `cards like it vary by ${rec.deviations.toFixed(1)}x less than this\n` : '') +
      (rec.chatsPerDay ? `${Math.round(rec.chatsPerDay).toLocaleString()} chats/day over ${Math.round(rec.days)}d\n` : '') +
      (rec.trend ? `since you last saw it: +${Math.round(rec.trend.dc).toLocaleString()} chats, ` +
        `+${Math.round(rec.trend.dm).toLocaleString()} messages` +
        (rec.trend.dc > 0
          ? ` (${(rec.trend.dm / rec.trend.dc).toFixed(1)} per new chat, lifetime ` +
            `${rec.ratio.toFixed(1)})`
          : '') + '\n' : '') +
      rec.reason +
      '\n\nClick to mark it fine \u2014 shift-click to mark it botted.';
  }

  function removeBadge(el) {
    const b = el.querySelector(':scope > .jbf-badge');
    if (b) b.remove();
  }

  function prune() {
    for (let i = records.length - 1; i >= 0; i--) {
      if (!records[i].root || !records[i].root.isConnected) records.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------
  // Replacement — render next-page characters into the holes
  // ------------------------------------------------------------------

  // Only the results grid is ours to touch. The page also carries "My Chats"
  // and other carousels full of /characters/ links — filtering or appending
  // into those means hiding the user's own chats and dropping strangers into
  // them, which is exactly what happened.
  const GRID_SELECTOR = '.pp-cc-list-container';
  const NOT_GRID = '[class*="chatList"], [class*="carousel"], [class*="Carousel"]';

  const SEL = {
    name: '.pp-cc-name',
    charLink: 'a[href*="/characters/"]',
    msgCount: '.pp-cc-chats-count',
    pubCount: '.pp-cc-public-chats-count',
    avatar: '.pp-cc-avatar',
    creatorLink: 'a[href*="/profiles/"]',
    creatorName: '.pp-cc-creator-name',
    desc: '.pp-cc-description',
    tokens: '.pp-cc-tokens-count',
    tags: 'ul'
  };

  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Descriptions contain author-supplied HTML. Parse it to text rather than
  // injecting it — DOMParser builds an inert document, nothing executes.
  function plainText(html) {
    if (!html) return '';
    try { return new DOMParser().parseFromString(String(html), 'text/html').body.textContent || ''; }
    catch (e) { return String(html).replace(/<[^>]*>/g, ''); }
  }

  // JanitorAI shows roughly the first 200 characters, cut at a word
  // boundary, with an ellipsis. Authors routinely put 2,000 characters in
  // there; writing the lot makes the card enormous and — because the grid
  // rows size to their tallest item — stretches every card beside it.
  const DESC_LIMIT = 200;

  function shortDesc(html) {
    const text = plainText(html);
    const tidy = t => t.replace(/\s+/g, ' ').trim();
    // Count against the uncollapsed text and cut hard, mid-word — that's
    // what the site does, which is why its cards end like "one particular...".
    if (text.length <= DESC_LIMIT) return tidy(text);
    return tidy(text.slice(0, DESC_LIMIT)) + '...';
  }

  function statsOf(ch) {
    const chats = ch.stats.chat, messages = ch.stats.message;
    const published = ch.first_published_at || ch.created_at;
    const t = published ? Date.parse(published) : NaN;
    const days = isFinite(t) ? Math.max(1, (Date.now() - t) / 864e5) : null;
    return {
      chats, messages, ratio: messages / chats, days,
      chatsPerDay: days ? chats / days : null,
      publicChats: ch.public_chat_count,
      tokens: typeof ch.total_tokens === 'number' ? ch.total_tokens : null
    };
  }

  // Would this candidate be flagged by the current rules? If so it's no
  // better than what it would replace.
  function wouldFlag(ch) {
    if (!ch || !ch.stats || !(ch.stats.chat >= 1)) return true;
    const probe = Object.assign({ id: ch.id, name: ch.name }, statsOf(ch));
    evaluate(probe);
    return probe.flagged;
  }

  function findDonor() {
    for (const r of records) {
      if (r.flagged || r.isReplacement) continue;
      const el = r.root;
      if (!el || !el.isConnected) continue;
      if (el.querySelector(SEL.name) && el.querySelector(SEL.charLink)) return el;
    }
    return null;
  }

  function buildReplacement(donor, ch) {
    const clone = donor.cloneNode(true);
    const set = (sel, txt) => { const e = clone.querySelector(sel); if (e) e.textContent = txt; };

    // Strip anything that belonged to the donor.
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.querySelectorAll('.jbf-badge').forEach(n => n.remove());
    clone.removeAttribute('data-jbf');
    clone.removeAttribute('data-jbf-seen');
    clone.style.removeProperty('display');

    const link = clone.querySelector(SEL.charLink);
    if (!link) return null;
    link.setAttribute('href', `/characters/${ch.id}_character-${slug(ch.name)}`);

    set(SEL.name, ch.name || '');
    set(SEL.msgCount, fmt(ch.stats.message));
    set(SEL.pubCount, String(ch.public_chat_count == null ? 0 : ch.public_chat_count));
    set(SEL.creatorName, '@' + (ch.creator_name || ''));
    set(SEL.tokens, (ch.total_tokens || 0) + ' tokens');

    const img = clone.querySelector(SEL.avatar);
    if (img && ch.avatar) {
      img.setAttribute('src', `https://ella.janitorai.com/bot-avatars/${ch.avatar}?width=400`);
      img.setAttribute('alt', ch.name || '');
      img.removeAttribute('srcset');
    }

    const cl = clone.querySelector(SEL.creatorLink);
    if (cl && ch.creator_id) {
      cl.setAttribute('href', `/profiles/${ch.creator_id}_profile-of-${slug(ch.creator_name)}`);
    }

    const desc = clone.querySelector(SEL.desc);
    if (desc) {
      const p = desc.querySelector('p') || desc;
      p.textContent = shortDesc(ch.description);
      // Belt and braces: never let a replacement outgrow the card it was
      // modelled on, whatever the text turns out to be.
      const donorDesc = donor.querySelector(SEL.desc);
      const h = donorDesc ? donorDesc.getBoundingClientRect().height : 0;
      if (h > 0) {
        desc.style.maxHeight = Math.round(h) + 'px';
        desc.style.overflow = 'hidden';
      }
    }

    const ul = clone.querySelector(SEL.tags);
    if (ul) {
      const tags = Array.isArray(ch.tags) ? ch.tags : [];
      [...ul.children].forEach((li, i) => {
        const t = tags[i];
        if (!t) { li.remove(); return; }
        const sp = li.querySelector('span');
        if (sp) sp.textContent = t.name || t.slug || '';
        const a = li.querySelector('a');
        if (a && t.id != null) a.setAttribute('href', `/search?mode=all&sort=popular&tag_id=${t.id}&page=1`);
      });
    }

    clone.setAttribute('data-jbf-replacement', ch.id);
    return clone;
  }

  // Which listing is on screen.
  //
  // The page URL wins where it says something, because it is what you are
  // actually looking at. The API query is only a fallback: the resource
  // timeline keeps every request the session ever made, so the most recent
  // one can belong to a listing you left minutes ago.
  //
  // Anything off the home page is "other" — tag and search pages carry
  // sort=popular in their own URLs without being the Popular listing.
  function listKind() {
    let path = '/', sm = '', sort = '';
    try {
      const u = new URL(location.href);
      path = u.pathname || '/';
      sm = (u.searchParams.get('segment') || '').toLowerCase();
      sort = (u.searchParams.get('sort') || '').toLowerCase();
    } catch (e) { /* fall through to the API query */ }

    if (path !== '/' && path !== '') return 'other';

    if (!sm && !sort) {
      const q = currentQuery();
      if (q) {
        sm = (q.searchParams.get('special_mode') || '').toLowerCase();
        sort = (q.searchParams.get('sort') || '').toLowerCase();
      }
    }

    if (sm === 'trending24' || sm === 'trending_24' || sm === 'trending24h') return 'trending24';
    if (sm.indexOf('trending') === 0) return 'trending';
    if (sort.indexOf('popular') === 0 || sm.indexOf('popular') === 0) return 'popular';
    if (sort.indexOf('latest') === 0 || sm.indexOf('latest') === 0) return 'latest';
    return 'other';
  }

  function activeHere() {
    const l = cfg.lists || {};
    const k = listKind();
    return l[k] !== undefined ? !!l[k] : false;
  }

  // The list query the page is currently showing — the site's own most
  // recent call, never one of ours. Replacements have to continue THIS
  // list, otherwise they arrive from another sort entirely and land at
  // message counts nothing like the rest of the page.
  function currentQuery() {
    const urls = apiUrls();
    for (let i = urls.length - 1; i >= 0; i--) {
      try { return new URL(urls[i]); } catch (e) { /* skip unparseable */ }
    }
    return null;
  }

  // Fetch one page of the current listing: everything on it feeds the
  // baseline, and the clean ones become replacement candidates.
  async function fetchListPage(href) {
    if (fetchedPages.has(href)) return 'cached';
    fetchedPages.add(href);
    ownRequests.add(href);
    try {
      const r = await apiGet(href);
      if (!r.ok) return (r.status === 401 || r.status === 403) ? 'auth' : 'error';
      const j = await r.json();
      ingest(j && j.data);
      for (const ch of (j && j.data) || []) {
        if (!ch || !ch.id || !ch.stats) continue;
        if (usedReplacements.has(ch.id)) continue;
        if (records.some(rec => rec.id === ch.id)) continue;
        if (wouldFlag(ch)) continue;
        pool.push(ch);
      }
      return 'ok';
    } catch (e) { return 'error'; }
  }

  function pageUrl(q, n) {
    const u = new URL(q.href);
    u.searchParams.set('page', String(n));
    return u.href;
  }

  // Learn from deeper pages of whatever listing you're on, once per listing.
  let seededFor = '';
  // Only the size-and-age rule needs a learned baseline. Seeding cost eight
  // extra requests on EVERY listing you opened, to build a curve the default
  // rule never reads — and those are the requests that need the session
  // token, since page 2 onward returns 401 without it. Gated, the default
  // setup makes no extra requests and never touches the token at all.
  function needsBaseline() {
    return cfg.rule === 'peer';
  }

  async function seedBaseline() {
    if (!needsBaseline()) return;
    const kind = listKind();
    if (seededFor === kind) return;
    const q = currentQuery();
    if (!q) return;
    seededFor = kind;

    const start = parseInt(q.searchParams.get('page') || '1', 10) || 1;
    for (let i = 1; i <= cfg.baselinePages; i++) {
      const res = await fetchListPage(pageUrl(q, start + i));
      if (res === 'auth' || res === 'error') break;
    }
    baselineDirty = true;
    queueScan();
  }

  async function ensurePool(want) {
    if (pool.length >= want) return;
    const q = currentQuery();
    if (!q) { replaceStatus = 'no list request seen yet'; return; }

    const startPage = parseInt(q.searchParams.get('page') || '1', 10) || 1;
    for (let i = 1; i <= cfg.baselinePages + cfg.maxReplacementPages && pool.length < want; i++) {
      const res = await fetchListPage(pageUrl(q, startPage + i));
      if (res === 'auth') {
        replaceStatus = 'log in to JanitorAI to pull replacements from later pages';
        break;
      }
      if (res === 'error') { replaceStatus = 'could not load more cards'; break; }
      if (res === 'ok') replaceStatus = '';
    }

    // Last resort: anything already cached that isn't on screen.
    if (!pool.length) {
      for (const ch of api.values()) {
        if (usedReplacements.has(ch.id)) continue;
        if (records.some(rec => rec.id === ch.id)) continue;
        if (wouldFlag(ch)) continue;
        pool.push(ch);
        if (pool.length >= want) break;
      }
    }
  }

  function replacementNodes() {
    return [...document.querySelectorAll('[data-jbf-replacement]')];
  }

  function currentGrid() {
    const grid = mainGrid();
    if (grid) return grid;
    const r = records.find(x => !x.isReplacement && x.root && x.root.parentElement);
    return r ? r.root.parentElement : null;
  }

  // Keep the visible card count equal to what the page shipped with.
  // Replacements are APPENDED, never dropped into the hole a hidden card
  // left: the grid is sorted descending, and a page-2 card belongs after
  // every page-1 card, not in third place. Appending keeps that order.
  async function fillGaps() {
    if (fillBusy) return;

    if (!cfg.enabled || cfg.mode !== 'hide' || revealed || !cfg.replace) {
      if (replacementNodes().length) { releaseReplacements(); queueScan(); }
      return;
    }

    const pageSize = records.filter(r => !r.isReplacement).length;
    if (!pageSize) return;

    const visible = records.filter(r => !r.flagged).length;
    const deficit = pageSize - visible;
    const nodes = replacementNodes();

    // Slider moved the other way — hand the surplus back, from the end.
    if (deficit < 0) {
      let drop = -deficit;
      for (let i = nodes.length - 1; i >= 0 && drop > 0; i--, drop--) release(nodes[i]);
      queueScan();
      return;
    }
    if (deficit === 0) return;
    if (nodes.length >= pageSize) return;   // never more than a page of fillers

    const grid = currentGrid();
    const donor = findDonor();
    if (!grid || !donor) { replaceStatus = 'nothing clean to model a card on'; return; }

    fillBusy = true;
    try {
      await ensurePool(deficit);
      for (let i = 0; i < deficit; i++) {
        const ch = pool.shift();
        if (!ch) break;
        const node = buildReplacement(donor, ch);
        if (!node) break;
        usedReplacements.add(ch.id);
        grid.appendChild(node);
      }
    } finally {
      fillBusy = false;
    }
    queueScan();
  }

  // Take a replacement back out and return its character to the front of
  // the queue, so the next refill reuses it in the same order.
  function release(node) {
    const id = node.getAttribute('data-jbf-replacement');
    const ch = api.get(id);
    if (ch && !pool.some(p => p.id === id)) pool.unshift(ch);
    usedReplacements.delete(id);
    node.remove();
  }

  function releaseReplacements() {
    replacementNodes().forEach(release);
    replaceStatus = '';
  }

  function clearReplacements() {
    releaseReplacements();
    pool.length = 0;
    fetchedPages.clear();
    usedReplacements.clear();
  }

  function setRevealed(v) {
    revealed = !!v;
    applyAll();
    return revealed;
  }

  // ------------------------------------------------------------------
  // Scan loop
  // ------------------------------------------------------------------

  async function scan() {
    scanQueued = false;
    await replayApi();
    for (const rec of findCards()) records.push(rec);
    applyAll();
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    const run = () => scan();
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 600 });
    else setTimeout(run, 150);
  }

  function watch() {
    if (observer) return;

    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList' && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && !n.classList.contains('jbf-badge')) { queueScan(); return; }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    try {
      perfObserver = new PerformanceObserver(list => {
        if (list.getEntries().some(e => API_RE.test(e.name))) queueScan();
      });
      perfObserver.observe({ type: 'resource', buffered: false });
    } catch (e) { /* older browser: mutation observer still covers us */ }

    let lastPath = location.pathname + location.search;
    setInterval(() => {
      const now = location.pathname + location.search;
      if (now !== lastPath) {
        lastPath = now;
        clearReplacements();
        replayed.clear();
        ownRequests.clear();
        seededFor = '';
        setTimeout(seedBaseline, 400);
        records.length = 0;
        document.querySelectorAll('[data-jbf-seen]').forEach(el => el.removeAttribute('data-jbf-seen'));
        queueScan();
      }
    }, 700);
  }

  // ------------------------------------------------------------------
  // Stats / export
  // ------------------------------------------------------------------

  function pctOf(sorted, p) {
    if (!sorted.length) return null;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[i];
  }

  function getStats() {
    // Only rebuild the fitted curve if a rule actually reads it — otherwise
    // opening the panel did a few hundred milliseconds of work for nothing.
    if (baselineDirty && needsBaseline()) rebuildBaseline();
    const usable = records.filter(r => r.chats >= cfg.minChats);
    const ratios = usable.map(r => r.ratio).sort((a, b) => a - b);
    return {
      enabled: cfg.enabled, mode: cfg.mode, rule: cfg.rule,
      total: records.length,
      matched: records.length,
      usable: usable.length,
      flagged: records.filter(r => r.flagged).length,
      baselineSamples: samples.size,
      whitelisted: (cfg.whitelist || []).length,
      suspected: (cfg.suspected || []).length,
      listKind: listKind(),
      activeHere: activeHere(),
      ready: fitReady,
      fitSize: fit.length,
      needSamples: cfg.minSamples,
      flagRate: flagRate(),
      revealed,
      replaced: replacementNodes().length,
      replaceStatus,
      poolSize: pool.length,
      median: pctOf(ratios, 50) || 0,
      p10: pctOf(ratios, 10) || 0,
      p90: pctOf(ratios, 90) || 0,
      min: ratios.length ? ratios[0] : 0,
      max: ratios.length ? ratios[ratios.length - 1] : 0
    };
  }

  // The fitted curve, as a few readable points.
  // The fitted surface, read at a few ages so the age effect is visible.
  function baselineTable() {
    ensureFit();
    if (!fitReady) return [];
    const out = [];
    for (const chats of [300, 1000, 20000, 200000]) {
      for (const days of [1, 30, 730]) {
        const x = Math.log10(chats), a = Math.log10(days);
        if (x < gxs[0] - 0.5 || x > gxs[gxs.length - 1] + 0.5) continue;
        if (a < gas[0] - 0.5 || a > gas[gas.length - 1] + 0.5) continue;
        out.push({ chats, days, expected: Math.exp(expectedAt(x, a)) });
      }
    }
    return out;
  }

  function exportRows() {
    const head = ['name', 'creator', 'chats', 'messages', 'msg_per_chat',
      'normal_for_size_and_age', 'times_normal', 'chats_per_day', 'days_old',
      'public_chats', 'card_tokens', 'msg_per_chat_per_1k_tokens', 'your_label',
      // growth shape — blank until the card has been seen a few times
      'sightings', 'hours_watched', 'flatness', 'fresh_msg_per_chat', 'ratio_drift',
      // creator's other cards, compared only with each other
      'creator_cards', 'creator_median_times_normal', 'stands_apart_from_own_shelf',
      'flagged', 'reason', 'url'];
    const rows = [head];
    records.slice()
      .sort((a, b) => (b.multiple || 0) - (a.multiple || 0))
      .forEach(r => rows.push([
      String(r.name).replace(/\t/g, ' '),
      r.creator,
      r.chats,
      r.messages,
      r.ratio.toFixed(2),
      r.expected == null ? '' : r.expected.toFixed(2),
      r.multiple == null ? '' : r.multiple.toFixed(2),
      r.chatsPerDay ? Math.round(r.chatsPerDay) : '',
      r.days ? Math.round(r.days) : '',
      r.publicChats == null ? '' : r.publicChats,
      r.tokens == null ? '' : r.tokens,
      r.thin == null ? '' : r.thin.toFixed(2),
      r.suspected ? 'botted' : ((cfg.whitelist || []).includes(r.id) ? 'fine' : ''),
      r.shape ? r.shape.spans + 1 : '',
      r.shape ? Math.round(r.shape.hours) : '',
      r.shape && isFinite(r.shape.burstiness) ? r.shape.burstiness.toFixed(2) : '',
      r.shape && r.shape.incRatio != null ? r.shape.incRatio.toFixed(2) : '',
      r.shape && r.shape.drift != null ? r.shape.drift.toFixed(2) : '',
      (r.cshape = r.cshape || creatorShape(r)) ? r.cshape.cards : '',
      r.cshape ? r.cshape.othersMedian.toFixed(2) : '',
      r.cshape && r.cshape.standsApart != null ? r.cshape.standsApart.toFixed(2) : '',
      r.flagged ? 'yes' : 'no',
      r.reason,
      new URL(r.href, location.origin).href
    ]));
    return rows.map(r => r.join('\t')).join('\n');
  }

  // ------------------------------------------------------------------
  // Settings + sample persistence
  // ------------------------------------------------------------------

  function setStorage(adapter) { storage = adapter; }

  async function loadCfg() {
    if (!storage) return cfg;
    try {
      const saved = await storage.get();
      cfg = Object.assign({}, DEFAULTS, saved || {});
      // Settings saved before the card-depth rule existed pin rule:'peer'.
      // Left alone, an upgrade silently keeps judging on the learned
      // baseline — and on live data that baseline ranks a genuine card
      // (2.25x) ABOVE a botted one (2.19x), which is the whole reason the
      // depth rule exists. Move them across, keep everything else they set.
      if (saved && (saved.cfgVersion || 0) < DEFAULTS.cfgVersion) {
        cfg.rule = DEFAULTS.rule;
        cfg.flagThin = true;
        if (typeof saved.thinScore !== 'number') cfg.thinScore = DEFAULTS.thinScore;
        if (typeof saved.thinRatio !== 'number') cfg.thinRatio = DEFAULTS.thinRatio;
        cfg.cfgVersion = DEFAULTS.cfgVersion;
        if (storage) { try { storage.set(cfg); } catch (e) { /* best effort */ } }
      }
      if (!Array.isArray(cfg.whitelist)) cfg.whitelist = [];
      if (!Array.isArray(cfg.suspected)) cfg.suspected = [];
    } catch (e) { log('settings load failed', e); }
    try {
      if (storage.getData) {
        const d = await storage.getData();
        if (d && d.s) {
          for (const [id, pair] of Object.entries(d.s)) {
            if (Array.isArray(pair) && pair.length >= 2) samples.set(id, pair);   // [chats, messages, ts, ageDays]
          }
          baselineDirty = true;
        }
        if (d && d.t) {
          for (const [id, v] of Object.entries(d.t)) {
            if (Array.isArray(v) && v.length === 4) {
              trends.set(id, { dc: v[0], dm: v[1], hours: v[2], ts: v[3] });
            }
          }
        }
        if (d && d.h) {
          for (const [id, rows] of Object.entries(d.h)) {
            if (Array.isArray(rows) && rows.length) history.set(id, rows.slice(-HIST_MAX));
          }
        }
      }
    } catch (e) { log('baseline load failed', e); }
    return cfg;
  }

  function queueSampleSave() {
    if (!storage || !storage.setData || saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; flushSamples(); }, 3000);
  }

  async function flushSamples() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!storage || !storage.setData) return false;
    try {
      // Growth history was being thrown away at the end of every session,
      // which quietly made the whole delta side of this useless — it can
      // only tell you something once it has watched a card over time.
      const t = {};
      for (const [id, v] of trends) t[id] = [v.dc, v.dm, v.hours, v.ts];
      const h = {};
      let kept = 0;
      for (const [id, rows] of history) {
        if (rows.length < 2) continue;              // a lone reading has no shape
        if (++kept > HIST_KEEP) break;
        h[id] = rows;
      }
      await storage.setData({ v: 4, s: Object.fromEntries(samples), t, h });
      return true;
    }
    catch (e) { log('baseline save failed', e); return false; }
  }

  async function saveCfg(patch) {
    Object.assign(cfg, patch);
    if (storage) { try { await storage.set(cfg); } catch (e) { log('settings save failed', e); } }
    maybeSeedForRule();   // switching to the peer rule needs a baseline now
    applyAll();
    if (panelApi) panelApi.syncInputs();
    return cfg;
  }

  function maybeSeedForRule() {
    if (needsBaseline() && !seededFor) seedBaseline();
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (p) saveCfg(Object.assign({}, p));
  }

  function clearWhitelist() { return saveCfg({ whitelist: [] }); }

  function clearBaseline() {
    samples.clear();
    trends.clear();
    // Forget the fetched payloads too, and the record of what's been
    // fetched. Otherwise "start over" left the cached API responses in
    // place but unusable, and the next rebuild ran on whatever trickled
    // in afterwards — usually one corner of one list.
    api.clear();
    replayed.clear();
    fetchedPages.clear();
    pool.length = 0;
    usedReplacements.clear();
    ownRequests.clear();
    seededFor = '';
    baselineDirty = true;
    history.clear();
    if (storage && storage.setData) storage.setData({ v: 4, s: {}, t: {}, h: {} }).catch(() => {});

    // Rebuild straight away. Clearing without re-seeding left the filter
    // holding one page — well under the sample floor — so it had no verdict
    // for anything and every control in the panel looked broken.
    clearReplacements();
    queueScan();
    seedBaseline();
    applyAll();
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById('jbf-styles')) return;
    const s = document.createElement('style');
    s.id = 'jbf-styles';
    s.textContent = `
      /* Matches the site's own buttons: a muted mauve fill with a lighter
         outline and white text, on the site's 5px corner. */
      .jbf-badge{position:absolute;top:6px;left:6px;z-index:40;
        background:#704F73;color:#fff;border:1px solid #AC6CAE;
        font:600 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        padding:3px 6px;border-radius:5px;box-shadow:0 1px 4px rgba(0,0,0,.45);
        letter-spacing:.2px;pointer-events:auto;cursor:pointer;user-select:none}
      .jbf-badge:hover{background:#8a628d}
      [data-jbf="flagged"]{outline:2px solid #AC6CAE;outline-offset:-2px;
        border-radius:6px;opacity:.55;transition:opacity .15s}
      [data-jbf="flagged"]:hover{opacity:1}
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function mountPanel() {
    if (panel || typeof JBF_PANEL === 'undefined') return;
    panelApi = panel = JBF_PANEL.mount({
      getCfg: () => cfg, save: saveCfg, preset: applyPreset,
      stats: getStats, exportRows, baseline: baselineTable,
      clearBaseline, setRevealed, isRevealed: () => revealed,
      presets: PRESETS, defaults: DEFAULTS
    });
  }

  function openPanel() {
    if (!panel) { cfg.showPanel = true; mountPanel(); }
    if (panelApi) { panelApi.refresh(); panelApi.open(); return true; }
    return false;
  }

  async function start() {
    if (started) return;
    started = true;
    await loadCfg();
    injectStyles();
    if (cfg.showPanel) mountPanel();
    queueScan();
    watch();
    seedBaseline();
    setTimeout(queueScan, 900);
    setTimeout(queueScan, 2500);

    // Don't lose a half-built baseline when the tab goes away mid-debounce.
    const onLeave = () => { flushSamples(); };
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onLeave();
    });
  }

  return {
    start, setStorage, saveCfg, loadCfg, getStats, exportRows, baselineTable,
    applyPreset, applyAll, openPanel, clearBaseline, clearWhitelist, flushSamples,
    scan: queueScan,
    listKind, activeHere, seedBaseline,
    setRevealed, isRevealed: () => revealed, clearReplacements,
    get cfg() { return cfg; },
    DEFAULTS, PRESETS,
    _internals: { api, samples, records, trends, evaluate, findCards,
                  ingest, noteSample, scoreFor, rebuildBaseline, flagRate,
      history, growthShape, creatorShape, noteHistory, evaluate,
      creatorWalks: () => creatorWalks, wouldFlag, fillGaps }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JBF;
