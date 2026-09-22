/* =====================================================================
 * J.AI Bot Filter — engine
 * ---------------------------------------------------------------------
 * The messages-per-chat ratio is not on the page: the grid shows total
 * MESSAGES and PUBLIC chats, never the real chat count. So this replays
 * JanitorAI's own list request from the performance timeline
 *
 *   /hampter/characters?...  ->  { data: [ { id, stats:{chat,message},
 *                                  total_tokens, first_published_at } ] }
 *
 * and matches records to cards by the uuid in their href.
 *
 * TWO SIGNALS, neither deciding alone:
 *
 *   depth    (messages/chats) / total_tokens * 1000 / days^0.28
 *            A thin card cannot hold anyone for fifteen messages.
 *   silence  comments / chats * 1000
 *            Chats are cheap to manufacture; comments are not. Catches
 *            bots that look completely ordinary on depth.
 *
 * NO THRESHOLD HERE IS GLOBAL, and that is the mistake this file has made
 * more than once. Two cards measured at the same depth carry opposite
 * labels. A comment rate that separates cleanly between 1,000 and 7,000
 * chats says nothing past 30,000, where three quarters of ordinary cards
 * sit below the line. So age enters as an exponent, size as a band, and
 * where the two signals disagree the card is MARKED rather than decided.
 * Before changing a number, check it against the population it came from.
 *
 * Two older rules are selectable but off by default: a learned size-and-age
 * baseline ("Similar cards") and a fixed cut-off.
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

    // --- depth ------------------------------------------------------
    flagThin: true,
    thinRatio: 10,             // only cards claiming real engagement are asked

    // Where MARKING starts, and where depth decides ON ITS OWN. Two
    // thresholds because one cannot do it: of 23 hand-labelled cards the
    // closest pair across the line is a botted card at 11.1 and a genuine
    // one at 11.0. The single threshold that tried (10.4) hid the genuine
    // one as soon as its numbers drifted. Between these two the comment
    // test decides; above depthSure nothing else was ever needed.
    thinScore: 11,
    depthSure: 15,

    // Just under thinScore a card is MARKED instead: visible, outlined,
    // score on the badge, so a near-miss is something you can argue with.
    borderlineFrom: 0.85,

    // Gate on MARKING a card under the chat floor. 2.5 when clearing it
    // meant a hide; as the gate on an outline it can afford 2.0, which
    // catches a hand-labelled bot at 2.18x and costs one extra mark across
    // 45 live cards between 50 and 400 chats.
    confidentMultiple: 2.0,

    // --- comments ---------------------------------------------------
    //
    // The one number a script cannot manufacture from chats. It settles
    // pairs depth cannot: Apocalyptic Sanctuary (depth 11.1, 1.9 per 1k,
    // botted) against Succubus Crush (11.0, 11.1 per 1k, genuine).
    //
    // THE RATE FALLS HARD WITH SIZE — median per 1,000 chats runs 8.3 at
    // 400-2k, 5.5 at 2k-7k, 3.2 at 7k-30k, 2.8 at 30k-80k. A flat "under 4
    // is suspicious" cut, which the labelled set alone appears to support,
    // hides 73% of a live sample including Gojo Satoru and Levi Ackerman.
    // Never use this as a flat threshold; only inside a measured band.
    useLikes: true,           // stored key kept for settings compatibility
    // Corroboration for a card depth already put between the two tiers:
    // this fraction of what cards its size actually get. It was a flat 5,
    // which is 0.6x the 8.3 a small card gets — but 0.9x the 5.5 of a
    // mid-sized one and nearly 2x the 2.8 of a large one, so on the strict
    // preset ordinary cards were reading as quiet. Banding it keeps the
    // measured behaviour for small cards and fixes the rest.
    quietFraction: 0.6,
    quietMinChats: 400,        // below this, one comment either way is noise

    // A card drawing this many times the discussion its cohort gets has
    // demonstrably earned its traffic, and is never flagged on depth or the
    // peer score at whatever dial setting. Measured: the highest hand-
    // labelled BOTTED card reaches 4.3x its cohort rate; a card labelled
    // plainly genuine sat at 10.8x (89.4 per 1,000 chats against the 8.3 its
    // size normally gets) and got marked anyway once the dial was turned up.
    // Five sits in that gap. This does not touch the silence rule, which is
    // about the opposite end.
    vouchMultiple: 5,

    // --- silence ----------------------------------------------------
    //
    // Three confirmed bots score 2.6, 4.9 and 5.1 on depth — invisible to
    // every other rule here. What gives them away is thousands of chats
    // producing almost no conversation. Within 1,000-7,000 chats:
    //
    //   botted   1.3 1.7 2.2                                   (n=3)
    //   genuine  4.5 5.5 8.1 8.3 9.2 11.2 13.1 13.7 26.2       (n=9)
    //
    // Nine genuine cards is a thin basis and there were only two cards to
    // measure between 7,000 and 30,000 chats, so the ceiling stops at the
    // edge of what was seen rather than extrapolating. Has its own switch.
    flagSilence: true,
    silenceRatio: 3,
    silenceMinChats: 1000,
    silenceMaxChats: 7000,

    // --- peer rule (off by default) ---------------------------------
    // Multiples of the normal ratio for cards of this size and age. Live
    // sample past the chat floor: 2.5x flags 3.7%, 3x flags 2.3%.
    maxMultiple: 2.25,
    peerLowSide: true,
    // The low side ("chats arriving with nobody talking") gets a more
    // forgiving number of its own: a low ratio has innocent explanations a
    // high one doesn't, and sharing one threshold meant tightening the high
    // side quietly flagged large, ordinary cards as chat-inflated.
    lowMultiple: 4.0,

    // --- fixed rule (off by default) --------------------------------
    flagHigh: true,
    highRatio: 40,
    flagLow: false,
    lowRatio: 4,

    // --- growth -----------------------------------------------------
    // Lifetime chats/day. A safety net, not a detector: adding 20k fake
    // chats to an established card moves its lifetime rate only ~1.3x.
    flagVelocity: true,
    maxChatsPerDay: 2500,
    // A lifetime average needs a lifetime. At 7 days this flagged the top
    // card on weekly trending, honestly running 14,078 chats/day. Past 30
    // days nothing in 401 live cards came near (median 343, p99 2,698).
    minVelocityDays: 30,

    // Growth between two of your own sightings — the only thing here that
    // sees a burst on an established card, where the lifetime rate barely
    // moves.
    flagTrend: true,
    minTrendRatio: 2,          // new chats arriving with almost no messages
    // A burst has to be a burst FOR THIS CARD, not just past an absolute
    // rate a genuinely hot card clears without trying.
    minTrendSpike: 5,
    // And only against a settled rate. Everything on 24-hour trending is
    // climbing, so ordinary acceleration reads as a 6-7x spike — two plainly
    // genuine day-old cards were hidden that way.
    minTrendDays: 7,

    // Growth SHAPE, not rate: a card people like is busy in the evening and
    // quiet at 4am, and one being fed at a configured rate is not. Needs
    // several sightings, which browsing daily gives you free. Both are set
    // where a real card should never land — a false positive on evidence
    // this strong is expensive.
    flagFlatGrowth: true,
    maxFlatness: 1.35,         // busiest stretch vs quietest, across sightings
    flagStaleRatio: true,
    maxRatioDrift: 0.45,       // fresh chats running at half the lifetime ratio

    // Which listings to ACT on. Inflated cards mostly surface on 24-hour
    // trending. The filter still learns from every list it sees.
    lists: { trending24: true, trending: false, popular: false, latest: false, other: false },

    // Past this many chats a card is marked, never hidden on ratio. Each
    // chat is another account, so the audience is already demonstrated.
    // Sits mid-way in a 6x gap: every hand-labelled bot had at most 4,181
    // chats, every live card the depth rule misread at least 26,652. Set to
    // 0 and a 206-token Story Generator with 85,844 chats gets hidden,
    // which is exactly what shipped before.
    trustAbove: 10000,

    // ACTIVITY FLOOR, in total messages. Messages rather than chats because
    // the question is "has this card done enough to be worth judging", and a
    // card with 150 chats and 5,290 messages plainly has. Under minMessages
    // nothing is judged; between the two a card can only be MARKED.
    //
    // 4,000 rather than 5,000: of four confirmed bots the smallest sit at
    // 4,460 and 4,932 messages, and a 5,000 floor would un-hide both.
    minMessages: 3000,
    hideMessages: 4000,

    // Still used to fit the baseline and to report flag rates, but no longer
    // the judging floor.
    minChats: 200,

    // THE DEPTH SCORE NO LONGER HIDES A CARD BY ITSELF. It has to be joined
    // by the token-free peer score: this many times the msg/chat that cards
    // of the same size and age actually run at. Below it, the card is marked
    // and left to you however extreme its depth.
    //
    // 2.5 is where the hand-labelled cards sit either side. Confirmed botted:
    // 55.4x, 9.3x, 3.1x. Judged "probably not" or "not sure": 2.5x, 2.3x,
    // 1.3x — including one hidden purely on a 724-token definition that its
    // own labeller had stopped believing in.
    //
    // Set to 0 to let depth decide alone, which is what shipped before.
    peerSupport: 2.5,
    // And the same signal in the other direction: this far above its cohort
    // corroborates a hide, exactly as a dead comment section does. On one
    // labelled page the three confirmed bots ran at 3.77x, 4.92x and 9.12x
    // while the highest genuine card reached 3.39x. Four sits between them
    // with room on both sides, and catches a confirmed bot that depth alone
    // left at 11.6 — just under the tier that decides by itself.
    peerOdd: 4.0,
    minSamples: 150,           // no verdicts until the curve means something

    // Page 1 is where inflated cards concentrate, so learning "normal" from
    // it alone lets the suspects set the baseline: on a live page that put
    // normal at 9.3 msg/chat where a broader sample says 5.5. Pull deeper
    // pages purely to learn from.
    baselinePages: 8,

    // No "load more" on numbered pages, so replacements are fetched from
    // the API and rendered into the holes left by hidden cards.
    replace: true,
    maxReplacementPages: 4,
    showPanel: true,
    // Bumped when a release changes what the filter does by default, so an
    // install doesn't stay pinned to a calibration from months ago.
    cfgVersion: 10,

    whitelist: [],
    suspected: [],           // cards you have marked as botted yourself
    debug: false
  };

  // depthSure tracks thinScore at roughly the measured 1.4x spacing, so
  // moving the slider keeps the two tiers in proportion rather than
  // collapsing them together at one end of the range.
  const PRESETS = {
    cautious: { rule: 'thin', thinScore: 14, depthSure: 20, thinRatio: 12, peerSupport: 3.5, quietFraction: 0.45, silenceRatio: 2.2, maxMultiple: 3.5, lowMultiple: 5.0, peerLowSide: true, minChats: 400, trustAbove: 6000 },
    balanced: { rule: 'thin', thinScore: 11, depthSure: 15, thinRatio: 10, peerSupport: 2.5, quietFraction: 0.6, silenceRatio: 3.0, maxMultiple: 2.25, lowMultiple: 4.0, peerLowSide: true, minChats: 200, trustAbove: 10000 },
    // strict's trustAbove was 25,000, which left 1.07x of daylight over the
    // smallest live card the depth rule misreads (26,652 chats). One card's
    // growth and the preset reintroduces the bug the guard exists to stop.
    // Its silenceRatio was 4.0 against a lowest-measured genuine card of
    // 4.66 — 1.16x, which is not a margin either.
    strict:   { rule: 'thin', thinScore: 7, depthSure: 10, thinRatio: 8, peerSupport: 1.2, quietFraction: 0.85, silenceRatio: 3.5, maxMultiple: 1.9, lowMultiple: 3.0, peerLowSide: true, minChats: 100, trustAbove: 20000 }
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

  // id -> { per1k, total, mode }. Only cards worth a lookup land here.
  const comments = new Map();
  const commentsTried = new Set();
  const MAX_COMMENT_CACHE = 600;

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

  // A LISTING request, as opposed to whatever else the page fetched from the
  // same endpoint. Signed in, the home page also fills carousels — recently
  // viewed, your own chats — from /hampter/characters, and those cards were
  // going straight into the baseline. They are the worst possible sample of
  // "normal": self-selected, skewed old, and chosen by the one person whose
  // taste the filter must not learn. A listing carries a page number; a
  // carousel fetches a fixed set by id.
  function isListing(u) {
    try {
      const q = new URL(u, location.origin).searchParams;
      return q.has('page') && !q.has('ids') && !q.has('id');
    } catch (e) { return false; }
  }

  function apiUrls() {
    let out = [];
    try {
      out = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => API_RE.test(u) && sameOrigin(u) && !ownRequests.has(u) && isListing(u));
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
  // Baseline for the "Similar cards" rule (optional; off by default)
  // ------------------------------------------------------------------
  //
  // Percentiles were the wrong tool — they flag a fixed share by
  // construction, so a page of ordinary cards still lost 5% of it. This
  // fits a curve conditioned on size AND age, which are different
  // populations: a 19-hour-old card with 900 chats sits near 5 msg/chat, a
  // two-year-old with 900k sits near 25.
  //
  //   x = log10(chats)   a = log10(age in days)   y = ln(messages / chats)
  //   score = (y - expected at (x, a)) / robust spread on that side
  //
  // The spread is a MAD taken separately above and below the fit: low
  // ratios are common, high ones rare. Precomputed on a coarse grid and
  // interpolated, so a page costs a few lookups, not a neighbour scan.

  // Fitted on 401 live cards spanning four listings and ages from hours to
  // three years: the exponent that flattens the depth score across age.
  const THIN_AGE_POWER = 0.28;

  // Below this the depth score is one conversation wearing a number: of 40
  // live sub-floor cards past the "far out of line" bar, 34 had under 50
  // chats. Nothing below this is marked, let alone hidden.
  const MARK_FLOOR = 50;

  // The score divides by total_tokens, so a 127-token card reads eight times
  // higher than a 1,000-token one at the same conversation length. Under the
  // chat floor that artefact is the whole risk: of 40 live cards between 50
  // and 260 chats, the seven past twice the threshold ALL had <=606 tokens,
  // while the 30 with a real definition topped out at 9.6. So a sub-floor
  // card is hidden only above this — a labelled bot there sits at 21.8 on
  // 1,815 tokens, 2.3x past anything measured in its class.
  const SUBFLOOR_MIN_TOKENS = 1000;

  // What a comment section of this size normally looks like: median comments
  // per 1,000 chats, measured across 74 live cards past the activity floor.
  // The rate falls hard with size, which is why it is a table and not a
  // number — see the silence rule in the config.
  function expectedComments(chats) {
    return chats < 2000 ? 8.3 : chats < 7000 ? 5.5 : chats < 30000 ? 3.2 : 2.8;
  }

  // Spacing between the two depth tiers. Repairs a config that arrives with
  // them out of order; see normaliseTiers.
  const TIER_GAP = 1.36;

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

  // Expectation along one age band, at one size: a robust LOCAL LINE.
  //
  // A line, not a median. A local median has no slope, so where the sizes
  // thin out it regresses toward the dense part of the data instead of
  // continuing the trend — and a listing is exactly that shape, hundreds of
  // small cards from deeper pages against a few dozen big ones from page 1.
  // The curve collapsed to one flat number and every large card got far too
  // low a bar. Tricube distance weights, then two bisquare passes so a few
  // inflated neighbours cannot tilt it.
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

  // Indirection so tests can pin the peer score to a known multiple.
  let scoreForRef = scoreFor;

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
    // Confident means "hide it". Every rule here is direct evidence and
    // qualifies — a measured burst, growth shape, your own mark. The one
    // exception is the depth rule's marginal band, which lowers it below.
    rec.confident = true;
    rec.reason = '';
    rec.multiple = null;
    rec.expected = null;
    // These are set to true further down and never to false, so without this
    // they stick: change the dial and a card keeps a guard it no longer
    // trips, which made the export's `gates` column describe a config the
    // user had already moved off.
    rec.trusted = rec.runsNormal = rec.runsOdd = rec.earnsIt = false;
    rec.quiet = rec.silent = rec.healthyComments = rec.vouched = false;
    if (!cfg.enabled) return rec;

    // Talk per 1,000 tokens of character, at this card's age. No baseline,
    // no neighbours, no history. Computed under every rule because the
    // export and the guards read it.
    //
    // The age term is not optional: across 401 live cards median msg/chat is
    // 8.4 in a card's first two days and 30.8 past a year on the SAME amount
    // of character. Uncorrected, a threshold tuned on 24-hour trending flags
    // 91% of Popular; age^0.28 flattens the age buckets to within 1.16x
    // (was 7.1x) and takes Popular to 7%.
    rec.thin = (rec.tokens > 0 && rec.ratio > 0)
      ? rec.ratio / Math.max(50, rec.tokens) * 1000 /
        Math.pow(Math.max(1, rec.days || 1), THIN_AGE_POWER)
      : null;

    const sc = scoreForRef(rec.chats, rec.ratio, rec.days);
    rec.multiple = sc ? sc.multiple : null;
    rec.expected = sc ? sc.expected : null;
    rec.deviations = sc ? sc.deviations : null;
    rec.shape = growthShape(rec.id, rec.ratio);
    rec.over = (rec.thin != null && cfg.thinScore > 0) ? rec.thin / cfg.thinScore : null;
    const lk = comments.get(rec.id) || null;
    rec.comPer1k = lk ? lk.per1k : null;
    rec.comCount = lk ? lk.total : null;
    rec.commentMode = lk ? lk.mode : null;
    // comment_mode is 'open', 'disabled' or 'followed_only', and only
    // 'open' is a fair denominator: switching comments off freezes the count
    // while chats keep arriving so the rate decays on its own, and
    // 'followed_only' suppresses it by design. Three of 74 live cards had
    // them off, all ordinary, each with 92-299 comments banked first.
    // ("Off AND never a single comment" was tried as its own signal and
    // dropped — the one live card matching it was a tiny-token artefact.)
    rec.silent = (cfg.flagSilence && rec.commentMode === 'open' &&
      rec.comPer1k != null &&
      rec.chats >= cfg.silenceMinChats && rec.chats <= cfg.silenceMaxChats &&
      rec.comPer1k < cfg.silenceRatio);
    rec.quiet = (cfg.useLikes && rec.commentMode === 'open' &&
      rec.comPer1k != null && rec.chats >= cfg.quietMinChats &&
      rec.comPer1k < expectedComments(rec.chats) * cfg.quietFraction);
    // The mirror of the silence rule, and the only thing that cleared up the
    // borderline band. Every card called "probably not botted" by hand had a
    // comment section at or above what cards its size actually get; every
    // confirmed bot was below it, or had comments switched off. It clears a
    // near-miss MARK only — a busy comment section has never been allowed to
    // rescue a card from being hidden, because one confirmed bot ran 36.1
    // comments per 1,000 chats.
    rec.healthyComments = (cfg.useLikes && rec.commentMode === 'open' &&
      rec.comPer1k != null && rec.comPer1k >= expectedComments(rec.chats));
    // Far past healthy: enough discussion that the traffic is accounted for.
    // Unlike healthyComments, which only clears a near miss, this clears the
    // depth and peer rules outright \u2014 they are both arguments that the
    // conversation cannot be real, and this is the conversation.
    rec.vouched = (cfg.useLikes && cfg.vouchMultiple > 0 &&
      rec.commentMode === 'open' && rec.comPer1k != null &&
      rec.comPer1k >= expectedComments(rec.chats) * cfg.vouchMultiple);
    rec.suspected = (cfg.suspected || []).includes(rec.id);
    // NOT creatorShape() here: it walks every cached card, and evaluate()
    // runs once per candidate while vetting replacements, so calling it made
    // filling the page quadratic. Worked out on demand instead.

    // Scoring happens everywhere so the numbers are always readable; acting
    // on them is scoped to the listings you've switched on.
    if (!activeHere()) { rec.reason = 'not filtering this listing'; return rec; }

    if (cfg.whitelist.includes(rec.id)) { rec.reason = 'you marked this one as fine'; return rec; }

    // Your own call outranks every measurement below.
    if (rec.suspected) {
      rec.flagged = true;
      rec.reason = 'you marked this one as botted';
      return rec;
    }

    // Growth first: the only thing that sees a burst on an established card.
    const t = rec.trend;
    if (cfg.flagTrend && t && t.dc >= MIN_TREND_CHATS &&
        (rec.days || 0) >= cfg.minTrendDays) {
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

    // Under the floor the numbers are mostly noise: across 139 live cards
    // below 400 chats, median depth runs 18.5 at 1-50 chats, 6.2 at 50-100,
    // 5.4 at 100-200, 2.9 at 200-400. One long conversation is the signal.
    //
    // Between minMessages and hideMessages a card can be MARKED but never
    // hidden. Above hideMessages it is judged normally even if its chat
    // count is small — a card with 150 chats and 5,290 messages has done
    // enough to answer for it.
    //
    // The one exception below hideMessages is a card whose score cannot be
    // a tiny-denominator artefact (see SUBFLOOR_MIN_TOKENS): four ordinary
    // cards in that band score 29.9-76.5 off 127-606 tokens, and nothing
    // separates them from a labelled bot at 42.
    if (rec.messages < cfg.minMessages) {
      rec.reason = 'too little activity to judge';
      return rec;
    }
    if (rec.messages < cfg.hideMessages) {
      const substantial = rec.tokens >= SUBFLOOR_MIN_TOKENS;
      const farOut = rec.thin !== null &&
        rec.thin > Math.max(cfg.depthSure, cfg.thinScore);
      if (substantial && farOut && rec.ratio > cfg.thinRatio) {
        rec.flagged = true;
        rec.confident = true;
        rec.reason = `${rec.ratio.toFixed(1)} msg/chat from a ` +
          `${rec.tokens.toLocaleString('en-US')}-token card \u2014 not enough ` +
          'character there to talk that long';
      } else if (rec.over != null && rec.over >= cfg.confidentMultiple &&
                 rec.ratio > cfg.thinRatio) {
        rec.flagged = true;
        rec.confident = false;
        rec.reason = `${rec.thin.toFixed(1)} msg/chat per 1k tokens \u2014 far out ` +
          `of line, but ${fmt(rec.messages)} messages is too little to be sure. ` +
          'Shift-click to hide it.';
      } else {
        rec.reason = 'below the activity floor';
      }
      return rec;
    }

    // Each chat is another account, so past `trustAbove` a card has already
    // demonstrated the audience its message count claims and depth marks
    // rather than hides. Not theoretical: depth breaks on the tiny famous
    // utility card where the PLAYER supplies everything. Seven live cards
    // scored past 15 (a 206-token Story Generator, a 120-token card with
    // 329,054 chats) and every one had 26,652+ chats, against at most 4,181
    // for any hand-labelled bot.
    const broadAudience = cfg.trustAbove > 0 && rec.chats >= cfg.trustAbove;
    if (broadAudience) rec.trusted = true;

    // The token-free second opinion. `sc.multiple` is this card's msg/chat
    // against what cards of ITS OWN size and age actually run at — learned
    // from browsing, no token count anywhere in it. When that says the card
    // is normal, depth does not get to hide it on its own: the depth rule's
    // claim is "nobody could talk this long to this little character", and a
    // whole cohort talking exactly this long refutes it.
    //
    // Null until the baseline has enough samples, in which case depth
    // decides alone exactly as before.
    const runsNormal = cfg.peerSupport > 0 && sc && sc.multiple < cfg.peerSupport;
    if (runsNormal) rec.runsNormal = true;
    const runsOdd = cfg.peerOdd > 0 && sc && sc.multiple > cfg.peerOdd;
    if (runsOdd) rec.runsOdd = true;

    // Thousands of chats and nobody ever said anything — the family of bots
    // nothing else here can see. Scoped to the measured band; see
    // flagSilence for the numbers and their limits.
    //
    // `!broadAudience` matters even though the band ceiling (7,000) is below
    // the default guard (10,000): the cautious preset moves the guard to
    // 6,000, INSIDE the band. Without it that preset would refuse to hide a
    // card on ratio for having too broad an audience, then hide it on its
    // comment rate in the same breath.
    if (rec.silent && cfg.rule === 'thin' && !broadAudience) {
      rec.flagged = true;
      rec.confident = true;
      rec.reason = `${rec.comCount === 0 ? 'not one comment' : rec.comCount +
        (rec.comCount === 1 ? ' comment' : ' comments')} on ` +
        `${rec.chats.toLocaleString('en-US')} chats — ` +
        `${rec.comPer1k.toFixed(1)} per 1,000 where cards this size get about 9`;
      return rec;
    }

    if (rec.vouched && cfg.rule === 'thin' && rec.thin !== null &&
        rec.thin > cfg.thinScore * cfg.borderlineFrom) {
      rec.reason = `${rec.thin.toFixed(1)} msg/chat per 1k tokens is thin, but ` +
        `${rec.comPer1k.toFixed(0)} comments per 1,000 chats is ` +
        `${(rec.comPer1k / expectedComments(rec.chats)).toFixed(0)}x what cards ` +
        'its size get \u2014 the conversation is accounted for';
      return rec;
    }

    // Thin card carrying a big conversation count. Scoped to its own rule,
    // though the number is computed under all of them for the export.
    //
    // Three tiers, because one could not carry the weight: the old single
    // cut at 10.4 sat three percent from a genuine card, and hid it the
    // moment its numbers drifted from 10.31 to 10.43.
    if (cfg.flagThin && cfg.rule === 'thin' && rec.thin !== null &&
        rec.ratio > cfg.thinRatio && rec.thin > cfg.thinScore) {
      rec.flagged = true;

      const thinNote = `${rec.ratio.toFixed(1)} msg/chat from a ` +
        `${rec.tokens.toLocaleString('en-US')}-token card \u2014 not enough ` +
        'character there to talk that long';

      // Far enough out that nothing else was ever needed. `sureAt` guards an
      // inverted config: depthSure below thinScore would make every marked
      // card clear the upper tier at once, collapsing the middle one.
      const sureAt = Math.max(cfg.depthSure, cfg.thinScore);
      if (rec.thin > sureAt && !broadAudience && !runsNormal) {
        rec.confident = true;
        rec.reason = thinNote;
        return rec;
      }
      // In between: hidden only if the comments agree. Never RESCUED by a
      // healthy count — that was tried and measured wrong, two hand-labelled
      // bots carrying 15.1 and 24.6 per 1,000 against 14.5 on a genuine one.
      // The comment rate corroborates downward, never upward.
      if (rec.quiet && !broadAudience && !runsNormal) {
        rec.confident = true;
        rec.reason = thinNote + `, and only ${rec.comPer1k.toFixed(1)} ` +
          'comments per 1,000 chats to show for it';
        return rec;
      }
      if (runsOdd && !broadAudience) {
        rec.confident = true;
        rec.reason = thinNote + `, and ${sc.multiple.toFixed(1)}x the rate ` +
          'cards of its size and age actually run at';
        return rec;
      }
      rec.confident = false;
      if (runsNormal) {
        rec.reason = thinNote + `, but at ${sc.multiple.toFixed(1)}x the rate ` +
          'cards its size and age run at, it is not out of the ordinary for ' +
          'them. Shift-click to hide it.';
        return rec;
      }
      rec.reason = broadAudience
        ? thinNote + `, but ${fmt(rec.chats)} separate chats \u2014 too broad ` +
          'an audience to be cheap to fake. Shift-click to hide it.'
        : thinNote + '. Shift-click to hide it, click to mark it fine.';
      return rec;
    }

    // Just under the line. Depth alone never hides here, but the comment
    // rate still decides both ways: two cards measured at the same 10.8
    // carry opposite labels and only this can tell them apart.
    if (cfg.flagThin && cfg.rule === 'thin' && rec.thin !== null &&
        rec.ratio > cfg.thinRatio && rec.over >= cfg.borderlineFrom) {
      rec.flagged = true;
      const near = `${rec.ratio.toFixed(1)} msg/chat from a ` +
        `${rec.tokens.toLocaleString('en-US')}-token card \u2014 close to the line ` +
        `(${(rec.over * 100).toFixed(0)}% of it)`;
      if (rec.quiet && !broadAudience && !runsNormal) {
        rec.confident = true;
        rec.reason = near + `, and only ${rec.comPer1k.toFixed(1)} comments ` +
          'per 1,000 chats to back it up';
        return rec;
      }
      // Depth alone in this band was producing noise: three cards judged
      // "probably not botted" by hand all landed here, all with healthy
      // comment sections. A near miss is only worth showing you when
      // something else leans the same way.
      if (rec.healthyComments) {
        rec.flagged = false;
        rec.reason = near + `, but ${rec.comPer1k.toFixed(1)} comments per 1,000 ` +
          'chats is a normal amount for its size';
        return rec;
      }
      rec.confident = false;
      rec.reason = near + '. Shift-click to hide it, click to mark it fine.';
      return rec;
    }
    if (cfg.rule === 'thin' && rec.thin !== null) {
      rec.reason = `${rec.thin.toFixed(1)} msg/chat per 1k tokens \u2014 within reason`;
      return rec;
    }
    // No token count (older cached record, or a field the site stopped
    // sending): fall through to the size-and-age rule rather than going
    // silent.

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

    // `broadAudience` is worked out above, where the depth rule needs it.
    // It guards the HIGH side only: the low side is the chat-inflation
    // attack, and exempting big cards from it would blind the filter to the
    // one thing a chat count can itself be lying about.

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

    if (rec.flagged && rec.confident && cfg.mode === 'hide' && cfg.enabled && !revealed) {
      el.setAttribute('data-jbf', 'hidden');
      el.style.setProperty('display', 'none', 'important');
      removeBadge(el);
      return;
    }
    if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');

    if (rec.flagged && cfg.enabled) {
      el.setAttribute('data-jbf', rec.confident ? 'flagged' : 'maybe');
      addBadge(el, rec);
    } else {
      el.setAttribute('data-jbf', 'ok');
      // A card that passed still gets a badge, or there would be nothing to
      // shift-click when you disagree with the verdict. It is invisible
      // until you hover the card, so a clean page still looks clean.
      if (cfg.enabled && rec.chats >= cfg.minChats && rec.thin !== null) addBadge(el, rec);
      else removeBadge(el);
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
        const sus = (cfg.suspected || []).slice();
        const fine = (cfg.whitelist || []).slice();
        const drop = (arr, v) => { const i = arr.indexOf(v); if (i !== -1) arr.splice(i, 1); };

        if (ev.shiftKey) {
          // Shift-click marks it botted, and clicking again un-marks it.
          if (sus.indexOf(id) === -1) { sus.push(id); drop(fine, id); } else drop(sus, id);
        } else {
          // Plain click marks it fine, and clicking again un-marks it.
          if (fine.indexOf(id) === -1) { fine.push(id); drop(sus, id); } else drop(fine, id);
        }
        saveCfg({ suspected: sus, whitelist: fine });
      }, true);
      el.appendChild(b);
    }
    b.setAttribute('data-jbf-id', rec.id);
    // Flagged badges are loud. A card that passed gets a quiet one that only
    // shows when you hover the card, so the grid stays clean but every card
    // can still be marked.
    b.className = 'jbf-badge' +
      (rec.flagged ? (rec.confident ? '' : ' jbf-badge--maybe') : ' jbf-badge--quiet') +
      (rec.suspected ? ' jbf-badge--mine' : '');
    b.textContent = rec.suspected ? '\u2715 botted'
      : rec.flagged ? rec.ratio.toFixed(1) + ' m/c'
      : (rec.thin != null ? rec.thin.toFixed(1) : rec.ratio.toFixed(1));
    b.title =
      `${rec.name}\n` +
      `${fmt(rec.chats)} chats · ${fmt(rec.messages)} messages · ` +
      `${rec.ratio.toFixed(1)} msg/chat\n` +
      (rec.tokens ? `${fmt(rec.tokens)}-token card, ${Math.round(rec.days)}d old ` +
        `\u2192 depth score ${rec.thin != null ? rec.thin.toFixed(1) : '?'} ` +
        `(marked past ${cfg.thinScore}, hidden past ${cfg.depthSure})\n` : '') +
      (rec.comPer1k != null
        ? `${rec.comCount} ${rec.comCount === 1 ? 'comment' : 'comments'} \u2014 ` +
          `${rec.comPer1k.toFixed(1)} per 1,000 chats` +
          (rec.commentMode === 'disabled'
            ? ', comments since switched off \u2014 not counted as evidence' : '') + '\n'
        : '') +
      (rec.trusted ? 'too many separate chats to hide on ratio alone\n' : '') +
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
      (rec.suspected ? '\n\nYou marked this botted. Shift-click to undo.'
        : (cfg.whitelist || []).includes(rec.id)
          ? '\n\nYou marked this fine. Click to undo.'
          : '\n\nClick: mark it fine.  Shift-click: mark it botted.');
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

  // Which listing is on screen. The page URL wins where it says something;
  // the API query is only a fallback, because the resource timeline keeps
  // every request the session ever made and the most recent can belong to a
  // listing you left minutes ago. Anything off the home page is "other" —
  // tag and search pages carry sort=popular without being Popular.
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

  // Deliberately NOT apiGet: these two endpoints are public, and sending
  // the session token to them when the site doesn't would be gratuitous.
  async function publicGet(path) {
    if (!sameOrigin(path)) return null;
    try {
      const r = await fetch(path, { credentials: 'omit', headers: { accept: 'application/json' } });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  async function fetchComments(rec) {
    if (commentsTried.has(rec.id)) return false;
    commentsTried.add(rec.id);
    const [c, s2] = await Promise.all([
      publicGet('/hampter/reviews/counts/' + rec.id),
      publicGet('/hampter/reviews/settings/' + rec.id)
    ]);
    if (!c && !s2) return false;
    comments.set(rec.id, {
      per1k: (c && typeof c.total === 'number' && rec.chats > 0)
        ? c.total / rec.chats * 1000 : null,
      total: c && c.total,
      mode: s2 && s2.comment_mode
    });
    if (comments.size > MAX_COMMENT_CACHE) comments.delete(comments.keys().next().value);
    return true;
  }

  // Two reasons to spend a lookup: the card is already flagged (or close
  // enough that the comment rate could change the verdict), or it sits in
  // the silence band where the comment rate IS the verdict. Nothing else
  // gets one. Measured cost of the second: 0 cards per page on 24-hour
  // trending, 0 on Popular, 3 on 7-day trending.
  async function askAboutFlagged() {
    if (!cfg.useLikes || !cfg.enabled) return;
    const inSilenceBand = r => cfg.flagSilence && cfg.rule === 'thin' &&
      r.chats >= cfg.silenceMinChats && r.chats <= cfg.silenceMaxChats;
    const want = records.filter(r => !commentsTried.has(r.id) && r.chats > 0 &&
      (r.flagged || inSilenceBand(r) ||
       (r.over != null && r.over >= cfg.confidentMultiple)));
    if (!want.length) return;
    let got = 0;
    for (const rec of want.slice(0, 12)) {
      if (await fetchComments(rec)) got++;
      await new Promise(r => setTimeout(r, 120));
    }
    if (got) applyAll();
  }

  async function scan() {
    scanQueued = false;
    await replayApi();
    for (const rec of findCards()) records.push(rec);
    applyAll();
    askAboutFlagged();
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
      // Every verdict, so the panel can show its working. A hidden card
      // leaves no trace on the page by definition — without this there is
      // no way for anyone, including me, to find out why it went.
      verdicts: records.filter(r => r.flagged).map(r => ({
        id: r.id, name: r.name, reason: r.reason, confident: !!r.confident
      })),
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
      'public_chats', 'card_tokens', 'msg_per_chat_per_1k_tokens',
      'comments', 'comments_per_1k_chats', 'comment_mode', 'gates', 'your_label',
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
      r.comCount == null ? '' : r.comCount,
      r.comPer1k == null ? '' : r.comPer1k.toFixed(1),
      r.commentMode || '',
      // Which guards actually fired on this card. Every one of these was
      // being computed and thrown away, which made a verdict impossible to
      // argue with from the export alone.
      [r.trusted && 'broad-audience', r.runsNormal && 'peer-says-normal',
       r.runsOdd && 'peer-says-odd', r.vouched && 'comments-vouch',
       r.healthyComments && 'comments-healthy', r.quiet && 'comments-quiet',
       r.silent && 'comments-silent', r.earnsIt && 'earns-its-ratio']
        .filter(Boolean).join(' '),
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
      // Saved settings bypass saveCfg entirely, so the tier invariant has to
      // be re-established here too.
      normaliseTiers(cfg);
      // Settings saved before the card-depth rule existed pin rule:'peer'.
      // Left alone, an upgrade silently keeps judging on the learned
      // baseline — and on live data that baseline ranks a genuine card
      // (2.25x) ABOVE a botted one (2.19x), which is the whole reason the
      // depth rule exists. Move them across, keep everything else they set.
      if (saved && (saved.cfgVersion || 0) < DEFAULTS.cfgVersion) {
        cfg.rule = DEFAULTS.rule;
        cfg.flagThin = true;
        // The threshold is CALIBRATION, not a preference, so a saved one is
        // replaced rather than kept. An install carrying 8.6 from an earlier
        // release was hiding a card that the re-measured labels put safely
        // on the right side of 10.4 — and no amount of shipping a new
        // default fixes that while the old value still wins the merge.
        cfg.thinScore = DEFAULTS.thinScore;
        cfg.thinRatio = DEFAULTS.thinRatio;
        cfg.minChats = Math.max(cfg.minChats || 0, DEFAULTS.minChats);
        // v7: the second tier and the comment test. These are calibration
        // too, and an install that has never seen them has no saved opinion
        // worth keeping. trustAbove especially: it shipped as 0, which is
        // the setting that let large minimal cards be hidden on ratio alone.
        cfg.depthSure = DEFAULTS.depthSure;
        cfg.quietMinChats = DEFAULTS.quietMinChats;
        cfg.flagSilence = DEFAULTS.flagSilence;
        cfg.silenceRatio = DEFAULTS.silenceRatio;
        cfg.silenceMinChats = DEFAULTS.silenceMinChats;
        cfg.silenceMaxChats = DEFAULTS.silenceMaxChats;
        if (!(cfg.trustAbove > 0)) cfg.trustAbove = DEFAULTS.trustAbove;
        // v8: the activity floor moved from chats to messages, and the peer
        // score became a two-way guard on the depth rule.
        cfg.minMessages = DEFAULTS.minMessages;
        cfg.hideMessages = DEFAULTS.hideMessages;
        cfg.peerOdd = DEFAULTS.peerOdd;
        delete cfg.peerNormal;          // v8 name; became peerSupport in v9
        cfg.peerSupport = DEFAULTS.peerSupport;
        cfg.vouchMultiple = DEFAULTS.vouchMultiple;
        delete cfg.quietRatio;          // flat; banded as quietFraction in v10
        cfg.quietFraction = DEFAULTS.quietFraction;
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

  // The depth rule's two tiers only mean anything in order: a card is marked
  // past thinScore and hidden on depth alone past depthSure. Inverted, every
  // marked card clears the upper tier at once and the middle tier — the one
  // that asks the comments before hiding — silently disappears. The slider
  // writes both together and every preset is ordered, so this is here for
  // hand-edited storage and for whatever the next release gets wrong.
  function normaliseTiers(c) {
    if (!(c.thinScore > 0)) return c;
    if (!(c.depthSure > c.thinScore)) {
      c.depthSure = Math.round(c.thinScore * TIER_GAP * 10) / 10;
    }
    return c;
  }

  async function saveCfg(patch) {
    Object.assign(cfg, patch);
    normaliseTiers(cfg);
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
      /* The quiet badge sits on cards that passed. Invisible until you
         hover the card, but still there to click. */
      .jbf-badge--quiet{background:rgba(28,28,30,.72);color:rgba(255,255,255,.82);
        border-color:rgba(255,255,255,.22);opacity:0;transition:opacity .12s}
      [data-jbf="ok"]:hover > .jbf-badge--quiet{opacity:1}
      .jbf-badge--quiet:hover{background:#704F73;border-color:#AC6CAE;color:#fff}
      /* A card you marked yourself, so you can see which verdicts are yours. */
      .jbf-badge--mine{background:#8a2c2c;border-color:#d46a6a;color:#fff;opacity:1}
      /* Over the line, but not by enough to act on alone. Shown, never
         hidden — it is a question for you, not a verdict. */
      .jbf-badge--maybe{background:rgba(28,28,30,.85);color:#e8c98a;
        border-color:rgba(232,201,138,.5)}
      [data-jbf="maybe"]{outline:2px dashed rgba(232,201,138,.45);outline-offset:-2px;
        border-radius:6px}
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
      // Swappable so the peer guard can be tested against a known multiple
      // rather than a whole synthetic population.
      setScoreFor: fn => { scoreForRef = fn || scoreFor; },
                  ingest, noteSample, scoreFor, rebuildBaseline, flagRate,
      history, growthShape, creatorShape, noteHistory, evaluate, comments, publicGet,
      creatorWalks: () => creatorWalks, wouldFlag, fillGaps, askAboutFlagged,
      apiUrls, isListing }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JBF;
