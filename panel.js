/* =====================================================================
 * J.AI Bot Filter — in-page panel
 * Shadow-DOM isolated so JanitorAI's stylesheet can't reach it.
 * ===================================================================== */

var JBF_PANEL = (function () {
  'use strict';

  const CSS = `
    :host{all:initial;
      /* janitorai's own palette, read off the site: accent --colour-purple-500,
         surfaces --colour-grey-700/600, body --colour-grey-550 */
      --jbf-accent:#704F73; --jbf-accent-hi:#AC6CAE; --jbf-accent-dim:#8a628d}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}

    .fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;
      width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.12);cursor:pointer;
      background:#2a2b2e;color:rgba(255,255,255,.92);font-size:17px;line-height:40px;text-align:center;
      box-shadow:0 4px 16px rgba(0,0,0,.5);transition:transform .12s,background .12s}
    .fab:hover{transform:scale(1.06)}
    .fab.on{background:var(--jbf-accent);border-color:var(--jbf-accent-hi);color:#fff}

    .chip{position:fixed;right:66px;bottom:23px;z-index:2147483000;
      background:#2a2b2e;color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.12);border-radius:15px;
      padding:6px 12px;font-size:11.5px;font-weight:500;cursor:pointer;
      box-shadow:0 3px 12px rgba(0,0,0,.45);white-space:nowrap;transition:background .12s}
    .chip:hover{background:#313338;color:#fff}
    .chip.on{background:var(--jbf-accent);border-color:var(--jbf-accent-hi);color:#fff}

    .wrap{position:fixed;right:16px;bottom:68px;z-index:2147483000;width:334px;
      background:#252629;color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.1);border-radius:10px;
      box-shadow:0 16px 48px rgba(0,0,0,.65);display:none;overflow:hidden}
    .wrap.open{display:block}

    header{display:flex;align-items:center;gap:10px;padding:13px 14px;
      background:#2a2b2e;border-bottom:1px solid rgba(255,255,255,.1)}
    header h1{margin:0;font-size:13.5px;font-weight:650;letter-spacing:.2px;flex:1}
    .x{background:none;border:0;color:rgba(255,255,255,.45);cursor:pointer;font-size:17px;
      padding:0 2px;line-height:1}
    .x:hover{color:rgba(255,255,255,.92)}

    .sw{position:relative;width:36px;height:20px;flex:none}
    .sw input{opacity:0;width:100%;height:100%;margin:0;cursor:pointer;position:relative;z-index:2}
    .sw i{position:absolute;inset:0;background:rgba(255,255,255,.12);border-radius:10px;
      transition:background .15s;pointer-events:none}
    .sw i::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;
      background:#fff;border-radius:50%;transition:transform .15s}
    .sw input:checked + i{background:var(--jbf-accent-hi)}
    .sw input:checked + i::after{transform:translateX(16px)}

    .body{padding:14px;max-height:76vh;overflow-y:auto}

    .status{background:#2a2b2e;border:1px solid rgba(255,255,255,.1);border-radius:6px;
      padding:10px 12px;margin-bottom:16px}
    .status .big{font-size:13px;font-weight:600;color:#ffffff;line-height:1.35}
    .status .sub{font-size:11.2px;color:rgba(255,255,255,.5);margin-top:3px;line-height:1.45}
    .status.warm{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.28)}
    .status.warm .big{color:#fbbf24}

    .sect{font-size:10px;text-transform:uppercase;letter-spacing:.8px;
      color:rgba(255,255,255,.4);margin:0 0 9px;font-weight:700}
    .group{margin-bottom:17px}
    .group:last-child{margin-bottom:0}

    .strength{display:flex;align-items:baseline;gap:7px}
    .strength b{font-size:19px;font-weight:700;color:#fff;line-height:1}
    .strength span{font-size:11.5px;color:rgba(255,255,255,.5);line-height:1.3}
    input[type=range]{width:100%;accent-color:var(--jbf-accent-hi);margin:10px 0 3px;cursor:pointer}
    .ends{display:flex;justify-content:space-between;font-size:10.2px;color:rgba(255,255,255,.4)}

    .seg{display:flex;border:1px solid rgba(255,255,255,.12);border-radius:5px;overflow:hidden}
    .seg button{flex:1;background:#1c1c1e;border:0;color:rgba(255,255,255,.6);padding:8px 0;
      font-size:11.8px;cursor:pointer;transition:background .12s}
    .seg button:hover{background:#2a2b2e;color:rgba(255,255,255,.9)}
    .seg button.sel{background:var(--jbf-accent);color:#fff;font-weight:600;
      box-shadow:inset 0 0 0 1px var(--jbf-accent-hi)}

    .quick{display:flex;gap:6px;margin-top:11px}
    .quick button{flex:1;background:#2a2b2e;border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.75);
      border-radius:5px;padding:6px 0;font-size:11px;cursor:pointer}
    .quick button:hover{background:#313338;color:#fff}
    .quick button.sel{background:var(--jbf-accent);border-color:var(--jbf-accent-hi);color:#fff;font-weight:600}

    .row{display:flex;align-items:flex-start;gap:9px;margin:11px 0;font-size:12.3px}
    .row.mid{align-items:center}
    .row label{flex:1;cursor:pointer;color:rgba(255,255,255,.85);line-height:1.35;padding-top:1px}
    .row.indent{padding-left:24px}
    .row .why{display:block;font-size:10.5px;color:rgba(255,255,255,.4);margin-top:2px}
    input[type=checkbox]{accent-color:var(--jbf-accent-hi);width:15px;height:15px;cursor:pointer;
      flex:none;margin-top:1px}
    input[type=number]{width:70px;background:#1c1c1e;border:1px solid rgba(255,255,255,.12);
      color:rgba(255,255,255,.92);border-radius:6px;padding:4px 6px;font-size:12px;flex:none}
    .unit{font-size:10.8px;color:rgba(255,255,255,.4);flex:none}

    details{border-top:1px solid rgba(255,255,255,.08);margin-top:16px;padding-top:12px}
    summary{cursor:pointer;font-size:11.5px;color:rgba(255,255,255,.5);list-style:none;
      display:flex;align-items:center;gap:6px;user-select:none}
    summary::-webkit-details-marker{display:none}
    summary::before{content:"\\203A";display:inline-block;transition:transform .15s;
      font-size:15px;line-height:1}
    details[open] summary::before{transform:rotate(90deg)}
    summary:hover{color:rgba(255,255,255,.9)}
    .adv{padding-top:14px}

    .wide{width:100%;background:#2a2b2e;border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.75);
      border-radius:5px;padding:8px;font-size:11.5px;cursor:pointer;margin-top:8px}
    .wide:hover{background:#313338;color:#fff}
    .wide.danger:hover{background:rgba(245,101,101,.1);border-color:rgba(245,101,101,.4);color:#f56565}

    table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:10px}
    th{color:rgba(255,255,255,.4);text-align:right;font-weight:600;padding:3px 0;
      border-bottom:1px solid rgba(255,255,255,.08)}
    th:first-child{text-align:left}
    td{text-align:right;padding:3px 0;color:rgba(255,255,255,.75)}
    td:first-child{text-align:left;color:rgba(255,255,255,.5)}

    .note{font-size:11.2px;color:rgba(255,255,255,.5);line-height:1.45}
    .vd{display:block;width:100%;text-align:left;background:#1c1c1e;
      border:1px solid rgba(255,255,255,.1);border-radius:5px;padding:6px 8px;
      margin-bottom:5px;cursor:pointer;color:rgba(255,255,255,.85);font-size:11.5px}
    .vd:hover{background:#313338;border-color:var(--jbf-accent-hi)}
    .vd b{display:block;font-weight:600;font-size:11.8px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .vd span{display:block;color:rgba(255,255,255,.5);font-size:10.6px;
      line-height:1.35;margin-top:2px}
    .vd .tag{display:inline-block;font-size:9.5px;letter-spacing:.4px;
      text-transform:uppercase;font-weight:700;margin-bottom:2px}
    .vd.hid .tag{color:var(--jbf-accent-hi)}
    .vd.maybe .tag{color:#e8c98a}
    .foot{font-size:10.5px;line-height:1.5;color:rgba(255,255,255,.35);margin:13px 0 0}
    .hidden{display:none}
    .dim{opacity:.4}
  `;

  const HTML = `
    <button class="chip" id="chip" hidden></button>
    <button class="fab" id="fab" title="J.AI Bot Filter">&#9878;</button>

    <div class="wrap" id="wrap">
      <header>
        <h1>J.AI Bot Filter</h1>
        <span class="sw"><input type="checkbox" id="enabled" title="Turn the filter on or off"><i></i></span>
        <button class="x" id="close" title="Close">&times;</button>
      </header>

      <div class="body">
        <div class="status" id="status">
          <div class="big" id="st-big">&ndash;</div>
          <div class="sub" id="st-sub"></div>
        </div>

        <div class="group">
          <p class="sect">How much to filter</p>
          <div class="strength" id="strength">
            <b id="pct">&ndash;</b><span id="pctwhy">of the cards it has seen</span>
          </div>
          <input type="range" id="peerRange" min="15" max="60" step="1">
          <div class="ends"><span id="endLo">Only the worst</span><span id="endHi">Hide more</span></div>
          <div class="ends" style="margin-top:2px"><span id="rateNote"></span></div>
          <div class="quick">
            <button data-preset="cautious">Cautious</button>
            <button data-preset="balanced">Balanced</button>
            <button data-preset="strict">Strict</button>
          </div>
        </div>

        <div class="group" id="verdictBox">
          <p class="sect">What it did on this page</p>
          <div id="verdicts"></div>
          <p class="foot" style="margin-top:6px">Click any of these to overrule it.</p>
        </div>

        <div class="group">
          <p class="sect">Where it runs</p>
          <div class="row mid"><input type="checkbox" id="l-trending24">
            <label for="l-trending24">Trending today</label></div>
          <div class="row mid"><input type="checkbox" id="l-trending">
            <label for="l-trending">Trending (weekly)</label></div>
          <div class="row mid"><input type="checkbox" id="l-popular">
            <label for="l-popular">Popular</label></div>
          <div class="row mid"><input type="checkbox" id="l-latest">
            <label for="l-latest">Latest</label></div>
          <div class="row mid"><input type="checkbox" id="l-other">
            <label for="l-other">Search, tags and everywhere else</label></div>
          <p class="foot" style="margin-top:6px" id="listsNote"></p>
        </div>

        <div class="group">
          <p class="sect">What happens to them</p>
          <div class="seg" id="mode">
            <button data-mode="hide">Remove them</button>
            <button data-mode="badge">Just mark them</button>
          </div>
          <div class="row" id="replaceRow">
            <input type="checkbox" id="replace">
            <label for="replace">Fill the gaps with clean cards
              <span class="why">Pulls from further down the list so you still get a full page</span>
            </label>
          </div>
        </div>

        <details id="adv">
          <summary>Advanced</summary>
          <div class="adv">

            <div class="group">
              <p class="sect">Judge cards by</p>
              <div class="seg" id="rule">
                <button data-rule="thin">Card depth</button>
                <button data-rule="peer">Similar cards</button>
                <button data-rule="fixed">Fixed number</button>
              </div>
              <div id="fixedBox" class="hidden">
                <div class="row mid">
                  <input type="checkbox" id="flagHigh">
                  <label for="flagHigh">Flag above</label>
                  <input type="number" id="highRatio" min="1" max="300" step="1">
                  <span class="unit">msg/chat</span>
                </div>
                <div class="row mid">
                  <input type="checkbox" id="flagLow">
                  <label for="flagLow">Flag below</label>
                  <input type="number" id="lowRatio" min="0.5" max="100" step="0.5">
                  <span class="unit">msg/chat</span>
                </div>
              </div>
              <div class="row" id="lowSideRow">
                <input type="checkbox" id="peerLowSide">
                <label for="peerLowSide">Also flag unusually <em>low</em> ratios
                  <span class="why">Chats arriving without conversation — what
                  chat-inflation looks like</span>
                </label>
              </div>
            </div>

            <div class="group">
              <p class="sect">Extra checks</p>
              <div class="row">
                <input type="checkbox" id="flagTrend">
                <label for="flagTrend">Watch how cards grow
                  <span class="why">Compares a card against the last time you saw it.
                  Catches bursts a lifetime average can't.</span>
                </label>
              </div>
              <div class="row">
                <input type="checkbox" id="useLikes">
                <label for="useLikes">Read the comment count
                  <span class="why">Asks janitorai how many comments a card has, for ones
                  already in question — a few requests per page, no login needed. Where
                  the depth score is too close to call, this decides it. A busy comment
                  section never rescues a card on its own.</span>
                </label>
              </div>
              <div class="row">
                <input type="checkbox" id="flagSilence">
                <label for="flagSilence">Flag chats nobody comments on
                  <span class="why">Thousands of chats leaving almost no comments behind.
                  Catches botted cards that look completely ordinary otherwise. Only
                  applies between 1,000 and 7,000 chats, where the rate was measured
                  — past that, ordinary cards go quiet too.</span>
                </label>
              </div>
              <div class="row">
                <input type="checkbox" id="flagFlatGrowth">
                <label for="flagFlatGrowth">Flag traffic that never sleeps
                  <span class="why">Real cards get busy in the evening and quiet
                  overnight. Needs sightings spread over at least 18 hours.</span>
                </label>
              </div>
              <div class="row">
                <input type="checkbox" id="flagStaleRatio">
                <label for="flagStaleRatio">Flag a ratio that's all history
                  <span class="why">When the chats arriving now run far below the
                  card's lifetime messages-per-chat. Needs 36 hours of sightings.</span>
                </label>
              </div>
              <div class="row">
                <input type="checkbox" id="flagVelocity">
                <label for="flagVelocity">Flag runaway growth
                  <span class="why">Only past 30 days \u2014 a card\u2019s first weeks are all launch spike</span>
                </label>
                <input type="number" id="maxChatsPerDay" min="100" max="100000" step="100">
                <span class="unit">/day</span>
              </div>
              <div class="row indent mid">
                <label for="minChats">Skip cards under
                  <span class="why">Too little data to judge fairly</span>
                </label>
                <input type="number" id="minChats" min="0" max="100000" step="10">
                <span class="unit">chats</span>
              </div>
              <div class="row indent mid" id="trustRow">
                <label for="trustAbove">Trust cards over
                  <span class="why">Messages are cheap to fake; chats are not — each one
                  is another account. Past this many a card is marked rather than
                  hidden, whatever its ratio: the cards that fooled this rule were all
                  tiny, famous ones with tens of thousands of chats. 0 turns it off.</span>
                </label>
                <input type="number" id="trustAbove" min="0" max="1000000" step="100">
                <span class="unit">chats</span>
              </div>
              <div class="row indent mid">
                <label for="lowMultiple">Chat-inflation cutoff
                  <span class="why">The other direction — chats arriving with nobody
                  talking. Kept looser than the main slider, because a low ratio has
                  innocent explanations a high one doesn't.</span>
                </label>
                <input type="number" id="lowMultiple" min="1.5" max="20" step="0.5">
                <span class="unit">× below</span>
              </div>
            </div>

            <div class="group">
              <p class="sect" id="learnedHead">What it has learned</p>
              <div class="note" id="baseinfo"></div>
              <table id="btable"></table>
              <div class="note" id="wlinfo" style="margin-bottom:2px"></div>
              <button class="wide" id="clearwl">Unmark the cards you marked as fine</button>
              <button class="wide" id="clearsus">Unmark the cards you marked as botted</button>
              <button class="wide" id="copy">Copy this page's numbers</button>
              <button class="wide danger" id="reset">Forget what it learned</button>
            </div>

            <p class="foot">
              Ratio = messages &divide; chats, taken from JanitorAI's own data &mdash; the
              same numbers as a card's hover tooltip. It climbs with popularity, so cards
              are only ever compared against others of a similar size.
            </p>
          </div>
        </details>
      </div>
    </div>
  `;

  function mount(api) {
    const host = document.createElement('div');
    host.id = 'jbf-panel-host';
    host.style.cssText = 'all:initial;position:static';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const holder = document.createElement('div');
    holder.innerHTML = HTML;
    root.appendChild(holder);
    (document.body || document.documentElement).appendChild(host);

    const $ = id => root.getElementById(id);
    const wrap = $('wrap'), fab = $('fab');

    fab.addEventListener('click', () => {
      wrap.classList.toggle('open');
      if (wrap.classList.contains('open')) refresh();
    });
    $('close').addEventListener('click', () => wrap.classList.remove('open'));

    $('chip').addEventListener('click', () => {
      if (api.setRevealed) api.setRevealed(!(api.isRevealed && api.isRevealed()));
      refresh();
    });

    const bindCheck = (id, key) =>
      $(id).addEventListener('change', e => api.save({ [key]: e.target.checked }));
    const bindNum = (id, key) =>
      $(id).addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (isFinite(v)) api.save({ [key]: v });
      });

    ['enabled', 'replace', 'peerLowSide', 'flagHigh', 'flagLow', 'flagVelocity', 'flagTrend',
     'flagFlatGrowth', 'flagStaleRatio', 'useLikes', 'flagSilence']
      .forEach(k => bindCheck(k, k));

    const LISTS = ['trending24', 'trending', 'popular', 'latest', 'other'];
    LISTS.forEach(k => $('l-' + k).addEventListener('change', e => {
      const lists = Object.assign({}, api.getCfg().lists);
      lists[k] = e.target.checked;
      api.save({ lists });
    }));
    ['highRatio', 'lowRatio', 'maxChatsPerDay', 'minChats', 'trustAbove', 'lowMultiple']
      .forEach(k => bindNum(k, k));

    // Label tracks the drag; the page only re-filters on release. Right is
    // always more aggressive, which means a SMALLER number, so both
    // mappings are inverted across their range.
    const posToMult = v => (75 - v) / 10;    // 15..60  ->  6.0x..1.5x
    const multToPos = m => 75 - m * 10;
    const posToThin = v => (26 - v / 5);     // 20..100 ->  22 .. 6
    const thinToPos = t => (26 - t) * 5;
    // The depth rule has two tiers and the slider carries both, or dragging
    // far enough puts the mark line above the hide line and the middle tier
    // vanishes. 1.36 is the spacing the labelled set measured.
    const TIER_GAP = 1.36;

    $('peerRange').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $('pct').textContent = (api.getCfg().rule === 'thin'
        ? posToThin(v).toFixed(0) : posToMult(v).toFixed(1) + '\u00d7');
    });
    $('peerRange').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      const t = posToThin(v);
      api.save(api.getCfg().rule === 'thin'
        ? { thinScore: t, depthSure: Math.round(t * TIER_GAP * 10) / 10 }
        : { maxMultiple: posToMult(v) });
    });

    root.querySelectorAll('#mode button').forEach(b =>
      b.addEventListener('click', () => api.save({ mode: b.dataset.mode })));
    root.querySelectorAll('#rule button').forEach(b =>
      b.addEventListener('click', () => api.save({ rule: b.dataset.rule })));
    root.querySelectorAll('.quick button').forEach(b =>
      b.addEventListener('click', () => api.preset(b.dataset.preset)));

    $('copy').addEventListener('click', async () => {
      const text = api.exportRows();
      try { await navigator.clipboard.writeText(text); $('copy').textContent = 'Copied ✓'; }
      catch (e) { console.log('[JBF] page data:\n' + text); $('copy').textContent = 'Logged to console'; }
      setTimeout(() => { $('copy').textContent = "Copy this page's numbers"; }, 1600);
    });

    $('clearsus').addEventListener('click', () => api.save({ suspected: [] }));
    $('clearwl').addEventListener('click', () => {
      if (api.clearWhitelist) api.clearWhitelist();
      refresh();
    });

    $('reset').addEventListener('click', () => {
      if (api.clearBaseline) api.clearBaseline();
      refresh();
    });

    function syncInputs() {
      const c = api.getCfg();
      $('enabled').checked = c.enabled;
      $('replace').checked = c.replace;
      $('peerLowSide').checked = c.peerLowSide;
      $('flagHigh').checked = c.flagHigh;
      $('flagLow').checked = c.flagLow;
      $('flagVelocity').checked = c.flagVelocity;
      $('flagTrend').checked = c.flagTrend;
      $('useLikes').checked = c.useLikes;
      $('flagSilence').checked = c.flagSilence;
      $('flagFlatGrowth').checked = c.flagFlatGrowth;
      $('flagStaleRatio').checked = c.flagStaleRatio;
      LISTS.forEach(k => { $('l-' + k).checked = !!(c.lists && c.lists[k]); });
      // NOT the slider — refresh() owns it, since which number it carries
      // depends on the rule. Setting it here pinned it to the peer position
      // wherever it had just been dragged.
      $('highRatio').value = c.highRatio;
      $('lowRatio').value = c.lowRatio;
      $('maxChatsPerDay').value = c.maxChatsPerDay;
      $('minChats').value = c.minChats;
      $('trustAbove').value = c.trustAbove;
      $('lowMultiple').value = c.lowMultiple;

      root.querySelectorAll('#mode button').forEach(b =>
        b.classList.toggle('sel', b.dataset.mode === c.mode));
      const presets = api.presets || {};
      root.querySelectorAll('.quick button').forEach(b => {
        const p = presets[b.dataset.preset];
        b.classList.toggle('sel', !!p && p.rule === c.rule && p.minChats === c.minChats &&
          (c.rule === 'thin' ? p.thinScore === c.thinScore : p.maxMultiple === c.maxMultiple));
      });
      root.querySelectorAll('#rule button').forEach(b =>
        b.classList.toggle('sel', b.dataset.rule === c.rule));

      // Drives whichever rule is selected; only "a fixed number" ignores it.
      // Disabling it for everything but the peer rule is what made it go
      // dead when the depth rule became the default.
      const peer = c.rule === 'peer';
      const slid = peer || c.rule === 'thin';
      $('fixedBox').classList.toggle('hidden', c.rule !== 'fixed');
      $('lowSideRow').classList.toggle('hidden', !peer);
      $('peerRange').disabled = !slid;
      $('strength').classList.toggle('dim', !slid);
      $('replaceRow').classList.toggle('hidden', c.mode !== 'hide');
      fab.classList.toggle('on', !!c.enabled);
    }

    const esc = t => String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    function refresh() {
      const c = api.getCfg();
      const s = api.stats();
      // The gate is the number of cards past the chat floor that the curve
      // is actually fitted from, NOT the raw sample count. Using the raw
      // count here meant the panel could cheerfully say "nothing unusual"
      // while the engine had no verdict for anything on the page.
      const warming = s.rule === 'peer' && !s.ready;

      $('status').classList.toggle('warm', !!(c.enabled && warming));

      const LIST_NAMES = { trending24: 'Trending today', trending: 'weekly Trending',
        popular: 'Popular', latest: 'Latest', other: 'this page' };

      if (!c.enabled) {
        $('st-big').textContent = 'Filter is off';
        $('st-sub').textContent = 'Nothing on the page is being changed.';
      } else if (s.activeHere === false) {
        $('st-big').textContent = 'Not filtering ' + (LIST_NAMES[s.listKind] || 'this page');
        $('st-sub').textContent = 'Switch it on under "Where it runs" if you want it here.' +
          (c.rule === 'peer' ? ' It is still learning from these cards either way.' : '');
      } else if (warming) {
        $('st-big').textContent = 'Learning what’s normal';
        $('st-sub').textContent =
          `${s.fitSize || 0} of the ${s.needSamples || 150} cards it needs. Nothing is being ` +
          'judged yet, so the controls below will not change the page until it catches up.';
      } else if (!s.total) {
        $('st-big').textContent = 'No cards here';
        $('st-sub').textContent = 'Open a page with a grid of characters.';
      } else if (!s.flagged) {
        $('st-big').textContent = 'Nothing unusual on this page';
        $('st-sub').textContent = `Checked ${plural(s.total, 'card', 'cards')}.`;
      } else if (c.mode === 'hide') {
        $('st-big').textContent = s.revealed
          ? `${plural(s.flagged, 'card', 'cards')} shown for review`
          : `${plural(s.flagged, 'card', 'cards')} removed`;
        $('st-sub').textContent = s.replaced
          ? `Replaced with ${plural(s.replaced, 'card', 'cards')} from further down the list.`
          : (c.replace
              ? (s.replaceStatus || 'No replacements available right now.')
              : 'Gap-filling is off, so the page is shorter.');
      } else {
        $('st-big').textContent = `${plural(s.flagged, 'card', 'cards')} marked`;
        $('st-sub').textContent = 'Look for the red badge — it shows the ratio.';
      }

      if (c.rule === 'thin') {
        $('peerRange').min = 20; $('peerRange').max = 100;
        $('peerRange').value = thinToPos(c.thinScore);
        $('pct').textContent = c.thinScore.toFixed(0);
        $('pctwhy').textContent = 'messages per chat per 1,000 tokens of character \u2014 ' +
          'more than a card that size can hold someone for.';
      } else {
        $('peerRange').min = 15; $('peerRange').max = 60;
        $('peerRange').value = multToPos(c.maxMultiple);
        $('pct').textContent = c.maxMultiple.toFixed(1) + '\u00d7';
        $('pctwhy').textContent = (s.flagRate == null)
          ? 'the normal messages-per-chat for a card\u2019s size and age'
          : `the normal messages-per-chat for a card\u2019s size and age \u2014 ` +
            `${s.flagRate < 0.1 ? 'under 0.1' : s.flagRate.toFixed(1)}% of what it has seen`;
      }

      const sus = s.suspected || 0;
      // What the current setting is actually doing, here, now.
      const judged = s.usable || 0;
      $('rateNote').textContent = !s.enabled ? ''
        : s.activeHere === false ? 'not acting on this listing'
        : !judged ? ''
        : s.flagged ? `hiding ${s.flagged} of the ${judged} cards it can judge here`
        : `nothing on this page is past it (${judged} cards judged)`;

      const learned = c.rule === 'peer';
      $('listsNote').textContent = learned
        ? 'It learns typical ratios from every list you browse \u2014 this only decides where it acts.'
        : 'This only decides where it acts. Nothing is learned; each card is judged on its own numbers.';
      $('endLo').textContent = learned ? 'Only the extremes' : 'Only the worst';
      $('endHi').textContent = 'Hide more';
      // The learned-baseline machinery is meaningless under the other rules.
      for (const id of ['trustRow', 'learnedHead', 'baseinfo', 'btable', 'reset']) {
        const el = $(id); if (el) el.classList.toggle('hidden', !learned);
      }

      // Show the working: what it acted on here, and why.
      const vs = s.verdicts || [];
      $('verdictBox').classList.toggle('hidden', !c.enabled || !vs.length);
      if (vs.length) {
        $('verdicts').innerHTML = vs.map(v =>
          `<button class="vd ${v.confident ? 'hid' : 'maybe'}" data-id="${v.id}">` +
          `<span class="tag">${v.confident
            ? (c.mode === 'hide' ? 'hidden' : 'marked') : 'marked \u2014 not sure'}</span>` +
          `<b>${esc(v.name)}</b><span>${esc(v.reason)}</span></button>`).join('');
        root.querySelectorAll('.vd').forEach(b => b.addEventListener('click', () => {
          const id = b.dataset.id;
          const fine = (api.getCfg().whitelist || []).slice();
          if (fine.indexOf(id) === -1) fine.push(id);
          const sus = (api.getCfg().suspected || []).filter(x => x !== id);
          api.save({ whitelist: fine, suspected: sus });
        }));
      }

      $('wlinfo').textContent =
        (s.whitelisted ? `${s.whitelisted} marked fine` : 'Click a badge to mark a card fine') +
        (sus ? `, ${sus} marked botted` : ', shift-click to mark it botted') +
        '. A card you mark botted is hidden like any other; hover a card that ' +
        'passed and its badge appears.';
      $('clearwl').style.display = s.whitelisted ? '' : 'none';
      $('clearsus').style.display = sus ? '' : 'none';

      $('baseinfo').textContent = s.baselineSamples
        ? `Typical ratios learned from ${s.baselineSamples.toLocaleString('en-US')} cards.`
        : 'Nothing learned yet.';

      const rows = api.baseline ? api.baseline() : [];
      $('btable').innerHTML = rows.length
        ? '<tr><th>chats</th><th>age</th><th>normal msg/chat</th></tr>' +
          rows.map(b => `<tr><td>${b.chats.toLocaleString('en-US')}</td>` +
            `<td>${b.days < 2 ? '1 day' : b.days < 60 ? b.days + ' days' : '2 years'}</td>` +
            `<td>${b.expected.toFixed(1)}</td></tr>`).join('')
        : '';

      const chip = $('chip');
      if (c.enabled && c.mode === 'hide' && s.flagged > 0) {
        chip.hidden = false;
        chip.classList.toggle('on', !!s.revealed);
        chip.textContent = s.revealed
          ? `Hide ${s.flagged} again`
          : `Show ${plural(s.flagged, 'removed card', 'removed cards')}`;
      } else {
        chip.hidden = true;
      }

      syncInputs();
    }

    syncInputs();
    refresh();
    return { refresh, syncInputs, open: () => wrap.classList.add('open'), host };
  }

  return { mount };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JBF_PANEL;
