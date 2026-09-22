# J.AI Bot Filter

Hides botted JanitorAI cards and backfills the gaps with clean ones, so you still get a
full page.

A userscript — Firefox, Chrome, anything Tampermonkey runs on.

<img src="docs/panel.png" width="330" alt="The filter's panel">

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open **[jai-bot-filter.user.js](../../raw/main/jai-bot-filter.user.js)** — your script
   manager will offer to install it.
3. Open JanitorAI. A ⚖ button appears bottom-right.

It updates itself from this repo, so you install once.

---

## The maths

Three signals. None of them decides alone, and only the first uses the card's size.

### 1. Depth — is there enough card to talk that long?

A long conversation needs material, and the card's definition *is* that material. The API
reports its size as `total_tokens`, so:

```
depth = (messages / chats) / total_tokens × 1000 / days^0.28
```

Messages per chat, per 1,000 tokens of character. A thin card can't hold anyone for fifteen
messages, so when it reports that it did, something else produced them.

The age term isn't optional. Across 401 live cards, median messages-per-chat is 8.4 in a
card's first two days and 30.8 past a year, on the same amount of character. Without
`days^0.28` a threshold tuned on 24-hour trending flags 91% of the Popular listing.

### 2. Peers — is this unusual for cards of its own size and age?

```
peer = (messages / chats) / what cards of this size and age actually run at
```

Learned from the listings you browse — **no token count anywhere in it.**

**The depth score cannot hide a card by itself.** This has to agree: under **2.5×** the
card is marked and left to you however extreme its depth reads.

It also flags on its own. A card running **2.4× its cohort with a dead comment section** is
hidden on those two facts, with no depth in it at all — which is the only thing that caught
a hand-labelled bot at 16.3 msg/chat on a *2,635-token* card. Its depth was 6.2:
unremarkable, and the definition is real, so no token rule could ever have seen it.

Only *listing* pages feed this. Signed in, the home page also fills carousels from the same
endpoint — your recently-viewed and your own chats — and those were going straight into the
baseline. They are the worst possible sample of normal: self-selected, skewed old, and
chosen by the one person whose taste the filter must not learn.

### 3. Comments — did any of that conversation leave a trace?

```
comments per 1k = comments / chats × 1000
```

Chats are cheap to manufacture; somebody writing a sentence underneath is not. Compared
against what cards of the same size actually get — **8.3 per 1,000 under 2,000 chats, 5.5
up to 7,000, 3.2 up to 30,000, 2.8 above** — because the rate falls hard with size.

Every comparison against it is a *fraction of the cohort rate*, never a flat number — a
flat one was above what larger cards actually get, so ordinary cards read as quiet.

Far below it and the card is hidden on this alone: it catches a family of bots that look
completely ordinary on depth, scoring 1.7, 3.3 and 3.5 there. At or above it, a near miss
on depth is not even worth marking. Every card judged "probably not botted" by hand had a
comment section at or above its cohort; every confirmed bot was below it, or had comments
switched off.

Past **5× its cohort rate**, the card is never flagged on depth or the peer score at any
dial setting: that much discussion accounts for the traffic. The bar is high because a busy
comment section is not proof — the loudest hand-labelled *botted* card reached 4.3×, while
the genuine card this rule exists for sits at 10.8× (89.4 per 1,000 against the 8.3 its
size gets).

### How a verdict is reached

| | |
|---|---|
| peer over **2.4×** with a dead comment section | **hidden** — no depth involved |
| comments over **5× cohort** | **never flagged at all** on depth or peers |
| peer under **2.5×** | **never hidden on depth**, however extreme the depth score |
| depth over **15** | **hidden**, if the peer score agrees — *marked* if it doesn't |
| depth over **11** | hidden if the comment rate **or** the peer score agrees; cleared if comments run **1.3× cohort**; else *marked* |
| depth over **9.4** | *marked* — unless the comment section is normal for its size, then left alone |
| **1,000–7,000 chats** with under **3** comments per 1k | **hidden** |
| **10,000+ chats** | never hidden on depth — only marked |
| under **4,000 messages** | hidden only with 1,000+ tokens of definition, else marked |
| under **3,000 messages** | not judged at all |

The dial moves all of this together — the two depth tiers and the peer gate — so the
aggressive end is aggressive on every axis rather than just sharpening one. It cannot drag
the **hide** line below 11, though: past that line depth decides alone, and cards measured
genuine run all the way up to 11.0. The *mark* line goes as low as you like.

*Marked* means shown with an amber outline and the number on the badge. Shift-click hides a
card for good; plain click marks it fine. Your call always wins.

---

## Why no single threshold

Every version of this that used one number failed, and the labelled set shows why:

| | depth |
|---|---|
| botted (9) | 1.7 – 348.3 |
| genuine (16) | 2.0 – 11.0 |

Those ranges overlap almost completely at the bottom. The closest pair across the line is **11.1 botted,
11.0 genuine** — one percent apart. No depth threshold separates them. Their comment rates
are 4.0 and 11.1, which does.

The same trap caught the comment rule. On the labelled set alone, "under 4 comments per
1,000 chats" separates perfectly. On 74 live cards it flags **73% of them**, including Gojo
Satoru, Levi Ackerman and ChatGPT Plus — because the comment rate falls hard with size:

| chats | median comments / 1k |
|---|---|
| 400 – 2,000 | 8.3 |
| 2,000 – 7,000 | 5.5 |
| 7,000 – 30,000 | 3.2 |
| 30,000 + | ~3.0 |

So it's scoped to the band where it was actually measured. Same story for the depth rule at
the top end: the seven live cards it misread were all tiny, famous utility cards (a
206-token Story Generator with 85,844 chats), which is what the 10,000-chat guard is for.

**Every threshold here is tied to the population it was measured on, and stops at the edge
of it.** That is the one lesson this project keeps relearning.

---

## About the session token

**In the default setup it is never read.** Depth comes from the listing the page already
fetched. The comment count is one extra request to a public endpoint, spent on a few cards
per page, sent with `credentials: 'omit'`.

The peer score is learned from the listings you already load, so it costs nothing either.
Two optional things do need the token, because page 2+ of the character API returns `401`
without it: gap-filling with replacement cards, and the *Similar cards* rule. When used, the token
is read from the cookie janitorai.com already set, sent **only to janitorai.com** exactly
as the site does, and never stored or logged anywhere. There is no server behind this — the
source is plain and unminified, search for `authToken`.

Turn off *"Fill the gaps with clean cards"* and no token is read at all.

---

## Please be sceptical of it

A flagged card is "far from normal for its size", not "proven botted". Known weak spots:

- **Under 4,000 messages**, one long conversation is most of the signal. Only cards with a
  real definition behind them are hidden there; the rest get an outline for you to settle.
- **The silence rule rests on nine genuine cards** in its band, and there were only two
  cards to measure between 7,000 and 30,000 chats. If it hides something you recognise,
  switch it off in the panel — that's a calibration bug, not your mistake.
- **Requiring peer support can cost catches.** Every hand-labelled bot is still caught, but
  the peer score was only ever *measured* for the recent ones; for the older cards it is
  estimated, and on those estimates three would drop from hidden to marked — including one
  that nothing but the token score can see. `peerSupport: 0` in the panel reverts it.
- **The growth-shape rules mark, they don't hide.** Every live flatness reading in this
  project came from a card judged genuine — 1.31, 1.36 and 1.53 — and the threshold of 1.35
  splits the first two by four percent. The rule came from simulation, never measurement,
  so until there are real botted readings it doesn't decide alone, and a comment section
  above its cohort clears it.
- **Some cards are only reachable once a baseline exists.** One hand-labelled bot has an
  ordinary depth score off a real definition; nothing but the peer score sees it, and that
  takes a few days of browsing to learn. A fresh install misses it.
- **Both signals are weakest on large, old cards**, where genuine ones go quiet and famous
  minimal ones score enormous depth. Those are downgraded to marks.
- **Everything was measured on trending and popular listings** — that's what's reachable
  without a login, and it isn't the whole site.

Start in **Just mark them**, use **Copy this page's numbers**, and check a few by hand
before switching to hiding.

---

## Notes

- Only the results grid is touched. **My Chats**, Recently viewed and other carousels are
  left alone.
- Replacements are appended, never inserted mid-grid, and are checked against the same
  rules first — a card that would itself be flagged is never used as filler.
- If JanitorAI changes its API, the filter goes quiet rather than flagging at random.
- Settings stay in your browser.

## Development

```
engine.js               API capture, the rules, hiding, replacement
panel.js                in-page panel (shadow DOM)
userscript-adapter.js   GM_* storage + Tampermonkey menu entries
build.sh                concatenates the three into jai-bot-filter.user.js
test/test.js            335 assertions
```

Edit the three sources, never `jai-bot-filter.user.js` — `build.sh` overwrites it.

```sh
npm install jsdom && node test/test.js   # tests
./build.sh                               # rebuild
```

To ship: bump `VERSION` in `build.sh`, run `./build.sh`, push to `main`. Tampermonkey only
offers an update when that number goes up, so forgetting to bump it means nobody gets the
change.

Storage keys still carry the old `jrf-` prefix on purpose — they're a data contract, and
renaming them on the rebrand would have dropped everyone's settings on upgrade.

## Licence

MIT — see [LICENSE](LICENSE).
