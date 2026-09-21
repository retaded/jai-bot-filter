# J.AI Bot Filter

Hides JanitorAI bots producing **more conversation than their character definition can
account for**, and fills the gaps with clean ones from further down the list — so you still
get a full page.

By default it makes no extra requests, learns nothing, stores nothing about you, and never
touches your session token. Both numbers it needs are already in the listing the page
fetched.

A userscript — works in Firefox, Chrome and anything else Tampermonkey runs on.

<img src="docs/panel.png" width="330" alt="The filter's panel">

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open **[jai-bot-filter.user.js](../../raw/main/jai-bot-filter.user.js)** — your script
   manager will offer to install it.
3. Open JanitorAI. A ⚖ button appears bottom-right.

That's it. It updates itself from this repo, so you only install once.

---

## The panel

Drawn to match JanitorAI's own buttons — `#704F73` filled with a `#AC6CAE` outline and
white text — on the site's grey surfaces, read off its live stylesheet rather than
eyeballed.

It only shows controls the selected rule actually uses. Under the default card-depth rule
the learned-baseline machinery — the trust floor, the chat-inflation cutoff, the
learned-ratios table and *Forget what it learned* — is hidden, because none of it is
running. Under the slider it reports what the current setting is doing right now: *hiding
3 of the 31 cards it can judge here*.

---

## About the session token — read this

**In the default setup the token is never read.** The depth rule works off the listing the
page already fetched, so nothing needs page 2. The learned-baseline rule used to pull eight
extra pages on every listing you opened — those are the requests that need a token — and it
did that even when the rule wasn't selected. It is now gated on the rule that reads it.

The rest of this section applies only if you switch to *Similar cards*, or leave
gap-filling on.


This script reads your JanitorAI session token. You should know why before you trust it.

The chat count it needs **is not printed on a card**. The card shows total *messages* and
*public* chats; the real chat count is only in the hover tooltip and in the API the site
itself calls. So the script calls that same API.

Page 1 of that API is public. Page 2 onward — used only to fetch replacement cards —
returns `401` unless the request carries your bearer token. The script reads that token
from the `sb-*-auth-token` cookie janitorai.com already set in your browser, and:

- sends it **only to janitorai.com**, exactly as the site itself does
- **never** stores it, logs it, or sends it anywhere else — there is no server behind this
- is plain, unminified source: search for `authToken` and `apiGet` and check

**If you'd rather it never touched the token:** turn off *"Fill the gaps with clean cards"*
in the panel. Nothing else needs page 2, so no token is read. Hidden cards just leave the
page shorter.

---

## The main rule: how much card there is to talk about

**This is the only rule that needs nothing learned.** It works on the first page you open,
and it costs no extra requests — both numbers are already in the listing the site fetches.

A long conversation needs material. The card's definition — persona, scenario, opening
message, example dialogue — *is* that material, and the API reports its size as
`total_tokens`. Divide messages-per-chat by it and you get how much talk a card produces
per unit of content:

```
score = (messages / chats) / total_tokens * 1000
```

Measured across all 204 cards on 24-hour trending, against cards labelled by hand:

| card | chats | msg/chat | tokens | score | |
|---|---|---|---|---|---|
| Sofia | 239 | 19.5 | 473 | **41.3** | botted |
| Sasuke | 351 | 26.3 | 1,388 | **19.0** | botted |
| Alice & Tzipi | 958 | 17.9 | 1,620 | **11.1** | botted |
| Lonely young woman | 1,115 | 14.9 | 1,538 | **9.7** | botted |
| | | | | | |
| No One Thinks… | 2,410 | 18.2 | 3,485 | 5.2 | genuine |
| the group of heroines | 1,007 | 14.6 | 6,598 | 2.2 | genuine |
| Popular Girls | 7,407 | 7.7 | 3,883 | 2.0 | genuine |

Look at the two middle rows. **"Lonely" has 1,115 chats at 14.9 msg/chat; "the group of
heroines" has 1,007 chats at 14.6.** On every ratio-based measure ever tried here they are
the same card, and one is botted. On this one they are 4.4× apart, because one is a
1,538-token card and the other is a 6,598-token one.

That is the whole idea. A thin card cannot hold anyone's attention for fifteen messages, so
when it reports that it did, something else produced those messages. Note also that
`No One Thinks…` runs at a *higher* ratio (18.2) than either and is untouched — it has a
942-token opening message and 3,485 tokens of character behind it. It earned it.

On the live list the default setting flags 6 of the 118 cards with enough chats to judge.

### Where the rule is applied matters as much as the rule

The depth rule shipped once doing nothing at all. `findCards()` — the function that turns
the page's DOM plus the API payload into records — never copied `total_tokens` onto them,
so every real card had no depth number, the rule declined to judge any of them, and the
filter went silent. The whole test suite passed, because every test built its records by
hand with the field already set.

There are now assertions that run against records the **scanner** produced: that each one
carries a token count, that a depth score was computed from it, and that a real page ends
up with something flagged and something left alone. Deleting the one line that copies the
field fails three of them.

A card the API gives no token count for now falls through to the size-and-age rule instead
of being skipped, so a missing field degrades rather than switching the filter off.

The depth check is also scoped to its own rule. Picking "cards of similar size" or "a fixed
number" gives you that and nothing else — though the depth number is still computed under
every rule, because the guard below and the exported numbers both read it.

### Direct evidence beats a learned baseline

The depth rule also overrides the older, baseline-driven one. That is not a preference, it
is a measured correction. Building a baseline out of the real 272 cards on 24-hour trending
and scoring two cards of almost identical size and ratio:

| card | chats | msg/chat | tokens | peer rule | depth rule | truth |
|---|---|---|---|---|---|---|
| the group of heroines | 1,026 | 14.68 | 6,598 | **2.25×** | 2.2 | genuine |
| Lonely young woman | 1,124 | 14.99 | 1,538 | 2.19× | **9.7** | botted |

The peer rule had them **the wrong way round** — it rated the genuine card as the more
suspicious of the two. A baseline you collect yourself can invert like that, because it is
assembled from whatever you happened to browse. A card's own token count cannot.

So when a card has the character to account for its ratio, the ratio is no longer evidence
against it, whichever rule is selected. The low side is untouched — a chat count can itself
be inflated, and no amount of writing rules that out.

Settings saved by earlier versions pinned the old rule, so an upgrade used to keep judging
on the baseline. They are now migrated once, on load, keeping everything else you set.

### Age is part of the measurement, not a detail

The rule shipped once calibrated only on 24-hour trending, and was a disaster everywhere
else. A card that has been up for two years has had two years for its conversations to run
long. Across 401 live cards spanning four listings:

| age | median msg/chat | median tokens | median depth score |
|---|---|---|---|
| 0–2 days | 8.4 | 2,754 | 3.2 |
| 2–7 days | 15.4 | 2,995 | 4.9 |
| 120–400 days | 41.8 | 3,199 | 14.3 |
| 400+ days | 30.8 | 1,413 | 22.9 |

The ratio nearly quadruples with age on *less* character, so a flat threshold flagged **91%
of the Popular listing**. Dividing the score by `age^0.28` flattens the median across every
bucket to within 1.16× (it was 7.1×):

| listing | flagged before | after |
|---|---|---|
| Trending today | 13% | 10% |
| Trending (weekly) | 16% | 8% |
| Popular | **91%** | 7% |

The exponent is not knife-edge — anywhere from 0.24 to 0.32 gives much the same answer, and
all eight hand-labelled cards keep their verdicts, since they are all about a day old.

### Two other thresholds had the same fault

Reviewing for the same mistake elsewhere turned up two more:

- **Lifetime chats/day** applied from 7 days old. The top card on weekly trending was 7 days
  old and running 14,078 chats/day honestly, and got flagged for it. A lifetime average
  needs a lifetime: it now waits 30 days, past which nothing in the live sample comes near
  the threshold (median 343/day, p99 2,698).
- **The burst rule** compared a *two-hour* delta against that same lifetime number, so a
  genuinely hot card read as a burst. It now also requires the recent rate to be several
  times the card's own lifetime rate — a step change rather than a popularity contest.

### What it can't do

It says nothing about a card that is both deep and botted — someone who writes a real card
and then buys traffic for it is invisible here. It also can't help on cards too small to
have a meaningful ratio, which is what the chat floor is for.

## What it actually measures

`ratio = messages ÷ chats`.

Where the numbers come from: the filter reads JanitorAI's own list API, the same one the
site calls to draw a page. Sampling several thousand cards from it gives the distributions
below.

From a live sample of **2,135 cards**, the typical ratio by card size:

| Chats | Normal msg/chat |
|---|---|
| 10 | 4.6 |
| 50 | 7.9 |
| 200 | 4.3 |
| 1,000 | 9.8 |
| 5,000 | 35.8 |
| 20,000 | 36.3 |
| 100,000 | 23.2 |
| 500,000 | 26.4 |

Note that this is **not monotonic** — it dips, climbs steeply around a few thousand chats,
then falls again. An earlier version of this tool assumed the ratio simply rose with
popularity, based on a sample of 88 cards. It was wrong.

### Age matters as much as size

Size alone isn't enough. Among 86 cards **under 72 hours old** with at least 300 chats, the
median ratio is **4.96** — conversations haven't had time to get long. Established cards of
the same chat count sit near 25. Judging both against one curve of size mixes two different
populations and mis-centres both.

So the fit uses size *and* age — with age as a **hard band**, not a weighted axis:

```
x = log10(chats)   y = ln(messages / chats)
group cards into age bands (within a factor of ~1.8 of each other)
expected y = distance-weighted median of the nearest cards in x, within the band
score      = (y - expected) / robust spread on that side of the fit
```

Age has to be a band rather than an axis, and that is not a detail — it was the
single worst bug this tool has had. See below.

A card is then judged by **how many times the normal ratio it runs at**, which is a figure
you can picture: 2.5 means two and a half times the messages-per-chat that cards of that
size and age get. That is an absolute statement, not a ranking against whatever else is on
screen — so an ordinary page flags nothing.

The curve is built only from cards past the chat floor — the ones the filter would actually
judge. Cards with three chats have ratios anywhere from 1 to 200, and that noise has no
business shaping the baseline.

Three further refinements, each measured rather than assumed:

- **Trimmed refit.** The baseline comes from whatever you browse, inflated cards included,
  and letting them set "normal" pulls the curve toward them. The fit runs twice: once to
  find the obvious outliers, then again with them dropped.
- **Neighbours weighted by distance.** A flat top-K median treats the 25th-nearest card as
  worth exactly as much as the nearest one, so in a sparse part of the distribution a card
  gets judged against neighbours nothing like it. A live 2,562-chat card whose own chat
  band runs at 11.9 msg/chat was being given an expectation of **6.7**, which turned an
  ordinary card into a 2.7× outlier. With Gaussian weighting its expectation rises to 10.2
  and it reads 1.8× — correctly unremarkable. The dense regions are unchanged and the
  overall flag rate fell slightly, from 10.7% to 9.4%.
- **An age cohort running out must not borrow another one's numbers.** Age used to be
  one axis of a 2-D neighbourhood, weighted at half the size axis. That works while both
  cohorts are well covered, and fails silently the moment one isn't.

  Day-old samples come from deeper pages of a listing, and deeper pages are *small* cards.
  So a browser ends up with day-old cards up to roughly 800 chats and nothing above it —
  at which point the fit walks up the age axis and answers with the **established** figure
  instead. One live install was told that normal for a day-old card with 3,259 chats was
  11.1 msg/chat. The day-old population runs at about 5. Every card past that crossover
  scored at **half** its true multiple, and cards at 1,000–1,100 chats sat right on it.

  The symptom was unmistakable once plotted. On that user's page, ratio *fell* with chat
  count (r = −0.42); the fitted curve *rose* (r = +0.94). It had the relationship backwards.

  | day-old card with | fit said normal was | day-old truth |
  |---|---|---|
  | 343 chats | 5.4 | ~5 |
  | 1,077 chats | 9.3 | ~5 |
  | 3,259 chats | 11.1 | ~5 |
  | 6,515 chats | 15.7 | ~5 |

  That right-hand column is flat on purpose: a day-old card's ratio is capped by the clock,
  not by its size. Nobody's had time for a long conversation yet. So each age band is now
  fitted only from cards of comparable age, and where a band has no cards of a given size
  the curve is **held flat** rather than extrapolated into another cohort's numbers.

- **Neighbourhood size.** Leave-one-out on 1,954 live cards: ~81 neighbours beats 151
  (median residual 0.231 vs 0.236).
- **Large cards are no longer exempt.** A flat 2.5× flagged 15.5% of 200–1,000-chat cards
  but **0% of everything above 20,000** — big cards cluster so tightly that nothing ever
  reaches the multiple. A card more than four local deviations out is now flagged even
  below the multiple, which took the 20k–100k band from 0.5% to 2.3% and left every other
  band untouched.

  The reverse — *relaxing* the threshold where cards vary a lot — was tested and rejected:
  it made whole bands unflaggable, and worse, it let contamination raise its own bar.

Two worked examples, both flagged by their creator's own reader as inflated:

| Card | Chats | Messages | Ratio | Normal for it | Times normal |
|---|---|---|---|---|---|
| A | 906 | 16,258 | 17.9 | 5.6 | **3.2×** |
| B | 790 | 11,534 | 14.6 | 5.0 | **2.9×** |

The slider reports what each setting costs, measured rather than assumed, and the panel
always shows the real figure for what it has seen. Note that correcting the age bug moved
every number on a same-day listing up by roughly 2×, because those cards had been scored
against a baseline twice as high as their own cohort's. The defaults moved with them
(balanced is now 3.0× rather than 2.5×); a setting carried over from an older version will
be about twice as aggressive as it was.

### What the ratio cannot do

Four cards were checked against a 299-card same-age population, two believed inflated and
two believed genuine:

| Card | Ratio | Normal for it | Times normal |
|---|---|---|---|
| believed inflated (A) | 18.0 | 5.6 | **3.19×** |
| believed inflated (B) | 14.8 | 6.1 | 2.44× |
| believed genuine (Northern Expedition) | 18.4 | 10.2 | **1.80×** |
| believed genuine ("No One Thinks…") | 15.3 | 5.5 | 2.79× |

Distance weighting sorted one of these out: Northern Expedition dropped from 2.78× to
1.80× once it stopped being compared with cards a third its size, and it is now clearly
the most ordinary of the four. The other three still interleave — the card believed
genuine ("No One Thinks…", 2.79×) sits between the two believed inflated. **No threshold
separates those three.**

Live growth measurement says the same: all four keep producing ~17 messages per newly
opened chat in real time, with new chats arriving at normal rates. That is what sustained
engagement looks like, and a botted card running continuously looks identical.

This is the honest ceiling of the method **for the ratio**. A card that genuinely holds attention and a
partially inflated one are not distinguishable from these counts. That is why **clicking a
badge marks a card as fine** — where the numbers can't decide, your judgement should, and
it sticks.

## The mistake that cost the most: a median has no slope

Inside one age band the ratio **rises smoothly with size**. Measured on a 299-card
same-age population: 5.0 msg/chat at 790 chats, 10.2 at 2,562.

The fit used to be a local weighted median, and a median has no slope. Wherever the sizes
thin out it stops following the trend and regresses toward the dense part of the data — and
a real listing is exactly that shape, because deeper pages supply hundreds of small cards
while page 1 supplies a few dozen big ones. So at the top end the neighbourhood reached
down into the small-card mass and dragged the expectation with it. The curve collapsed
toward one flat number, every large card was handed a far too low bar, and a working filter
started flagging most of the page.

The fix is to fit a **line** through the neighbourhood rather than take its middle —
tricube distance weights, then two bisquare passes so a few inflated cards can't tilt it.
It keeps the slope where the data thins while still following a curve that bends. On a
2,000-card synthetic of the real site-wide shape it recovers the whole non-monotonic curve
across five decades of size:

| chats | 50 | 200 | 1,000 | 5,000 | 20,000 | 100,000 |
|---|---|---|---|---|---|---|
| true | 7.9 | 4.3 | 9.8 | 35.8 | 36.3 | 23.2 |
| fitted | 7.3 | 4.3 | 10.2 | 34.1 | 37.7 | 22.6 |

Age remains a hard band on top of that. Day-old cards and established ones are different
populations and are never fitted together — a card one day old is capped by the clock, not
by how good it is.

### The test that guards it

Eight cards were labelled by hand over the life of this project — four believed botted,
four believed genuine. Every regression this filter has shipped showed up as those two
groups sliding into each other, so the suite now scores all eight against a population
built only from the independently measured curve:

| believed botted | times normal | | believed genuine | times normal |
|---|---|---|---|---|
| Hana (957 chats, 18.8) | 3.19× | | No One Thinks (1,820, 16.6) | 1.58× |
| example B (891, 17.9) | 3.20× | | Northern (3,259, 17.3) | 1.20× |
| Wrong Girl (1,077, 17.1) | 2.65× | | Popular Girls (6,515, 7.1) | 0.39× |
| Lonely (1,020, 14.7) | 2.37× | | first example (8,600, 11.3) | 0.58× |

Clean split, with the default 2.25× inside the gap. Note how little the raw ratios say:
Northern at 17.29 is *higher* than Wrong Girl at 17.12, and reads as ordinary only because
a card its size is expected to.

### The two sides get different thresholds

A high ratio and a low one are different claims. "Chats arriving with nobody talking" is
rarer, and a low ratio has innocent explanations a high one doesn't — a genre people bounce
off after one message, a weak opener. Sharing one number meant every tightening of the high
side quietly started flagging large, perfectly ordinary cards as chat-inflated. Popular
Girls at 0.39× is the worked example. The chat-inflation cutoff is its own setting,
defaulting to 4× below normal.

## Signals the ratio cannot supply

Two cards can sit at 17.1 and 17.3 messages per chat with one botted and one not, and no
threshold will ever separate them — the numbers are the same numbers. Measured on one live
page: a card believed botted at 14.66 and one believed genuine at 14.65, one hundredth
apart. So the filter also watches things a ratio cannot imitate.

**The shape of the growth, not its rate.** A single snapshot gives you a rate. Several give
you a shape, and a shape follows the clock: a card people actually like gets busy in the
evening and goes quiet at 4am. Traffic that has been bought arrives at whatever rate
somebody configured — flat, or in identical bursts. The filter keeps up to a dozen
sightings of each card and compares its busiest stretch with its quietest. Real cards swing
by several times over a day; a card flagged here held steady within 35% for ten hours or
more. This costs no extra requests — it is built from pages you were loading anyway — but
it needs you to have seen the card a few times, which browsing a listing daily gives you
for free, since cards sit on Trending for days.

**A ratio that's all history.** A card inflated once and then left alone keeps its lifetime
average forever. Comparing the messages-per-chat of the chats arriving *now* against the
card's lifetime figure catches that: 15.0 lifetime, 3.5 on everything since you first saw
it.

**The creator's own shelf.** Not follower counts — those punished new and small creators
for being new and small, and are deliberately still left out. This compares a creator only
with themselves. Someone who buys traffic buys it for one card, so that card stands apart
from the rest of their work; a creator who simply writes well has a shelf that rises
together.

### Both growth rules shipped on windows too short to measure

They were written by reasoning rather than measurement, because they need repeat sightings
and there was no live data. Simulating them against traffic that follows a normal day
(4:1 peak to trough) sampled at the irregular intervals real browsing produces:

| window the rule accepted | an ordinary card scores | wrongly flagged |
|---|---|---|
| 10 hours (what shipped) | 1.08 | **87–100%** |
| 14 hours | 1.41 | 50% |
| 18 hours | 2.11 | 0% |
| 24 hours | 1.94 | 0% |

Ten hours sits inside one part of the day, so there is no variation to see and *every* card
looks metered. The minimum is now 18 hours, plus a cap on how coarsely the sightings are
spaced — sampled once a day, the intervals are day-long averages and the clock's variation
is averaged away again. With both guards, ordinary cards are never flagged at any span and
metered traffic is still caught every time.

The stale-ratio rule had a bias of its own. A chat opened minutes before the last sighting
has barely any messages yet, so messages-per-*new*-chat reads low on a perfectly healthy
card — 0.27 over two hours, 0.45 over four, against a threshold of 0.5. It accepted windows
of two hours. Across conversation lengths from 3 to 18 hours it only clears the threshold
with margin past **36 hours**, which is now the minimum. A genuinely coasting card reads
0.17–0.21 there, so the separation is wide.

The same bias applied to "chats arriving with nobody talking", which now needs 12 hours.

None of this means the rules were wrong — the signals are real, and over a proper window
metered traffic is caught every time. They were being asked a question the measurement
could not answer yet.

### Your own judgement is data

Clicking a badge marks a card as fine. **Shift-clicking marks it as botted.** Nothing is
hidden on the strength of that second label — it goes into the export alongside every
signal above, so a run of cards you are sure about can be checked against all of them at
once. That is the only way to find out which signals actually separate them, rather than
guessing. If you label a couple of dozen cards you're confident about and keep the export,
it becomes possible to fit the rule to the evidence instead of to intuition.

That distinction matters. A percentile rule flags a fixed share of cards by construction —
set it to 5% and it removes 5% of every page whether or not anything is wrong with it. The
fitted model flags nothing when nothing is unusual: on the live sample, a typical 34-card
page contains **0.14 cards** past the default threshold.

The slider sets that threshold, and the panel shows the **measured** share of everything
it has seen that would be flagged — a number it counts, not one it assumes.

---

## Every list ranks by messages

Trending, 24-hour trending, popular and latest are all ordered by **message count**, not
chats. Measured on the live trending list: rank correlates with messages at **ρ = 1.000**,
and with chats only 0.75.

That is worth knowing, because it says what inflation is *for*: messages are the currency
that buys a ranking. It is also why the filter watches the messages side so closely.

### One thing deliberately left out

Creator follower counts correlate strongly with card ratio on the trending list
(−0.76), and it is tempting to use that — a creator with 2 followers whose card has
9,124 messages looks damning.

It isn't in the filter, on purpose. Cards are discovered through these lists, not through
follows, so most traffic on any card comes from people who don't follow the creator. The
correlation more likely reflects *what kind of card reaches trending*: established creators
write broad cards that draw lots of casual one-message visits (low ratio), while a small
creator reaching trending usually did it with a niche card that a few people really engage
with (high ratio). That is a selection effect, not evidence of botting.

Using it would have meant systematically hiding new and small creators — which is a worse
failure than missing some botted cards.

## Countering chat-inflation

Spamming messages in a few chats pushes the ratio up. The opposite attack — scripting lots
of *chats* — pushes it down, toward "plenty of chats, nobody talking". The fitted model
watches both ends, so both shapes are caught.

Lifetime chats-per-day, by itself, is close to useless against it. Tested on 1,011
established cards: adding **20,000 fake chats** moves lifetime chats/day by a factor of
**1.27**, and the number of cards crossing the 2,500/day threshold goes from 1 to 1. A
burst gets averaged away across the card's whole life.

So the filter also tracks **growth between your own sightings**. It remembers the counts
from the last time you saw a card, and when you see it again a few hours later it knows
what actually changed. That catches:

- a burst of chats a lifetime average would dilute into nothing
- chats arriving without conversation — the shape chat-inflation makes

This needs no history to be useful on day one; it just gets sharper the longer you use it.
For reference, live chats/day figures: median 98, p95 764, p99 2,172, maximum 14,369.

---
## Please be sceptical of it

A flagged card is "far from normal for its size", not "proven botted". Unusual has innocent
explanations — a card that got linked somewhere, a genre where people bounce after one
message, a creator who writes very long greetings.

The bigger limitation is the baseline: it's built from the cards **you** browse. Browse only
one corner of the site and "normal" means normal for that corner. The numbers in the table
above came mostly from popular and trending listings, which by definition select for cards
people engage with — so the curve probably sits higher than the site as a whole.

Start in **Just mark them**, look at the badges, use **Copy this page's numbers** and check
a few by hand before switching to removing. The export gives each card's ratio, what's
normal at its size, and how many deviations away it is — that last number is the one worth
reading.

---

## Notes

- Only the results grid is touched. **My Chats**, Recently viewed and other carousels are
  left completely alone.
- Replacements are appended, never inserted mid-grid, so the page's ranking stays intact.
  They're checked against the same rules first — a card that would itself be flagged is
  never used as a filler.
- Requests it makes are the same GETs the page already made, deduped, plus one per extra
  page of replacements. It is not a scraper and does not run in the background.
- If JanitorAI changes its API, the filter goes quiet rather than flagging at random.
- Settings and the learned baseline are per-browser and stay on your machine.

## Development

```
engine.js               API capture, the rules, hiding, replacement
panel.js                in-page panel (shadow DOM)
userscript-adapter.js   GM_* storage + the Tampermonkey menu entries
build.sh                concatenates the three into jai-bot-filter.user.js
test/test.js            209 assertions
```

Edit the three sources, never `jai-bot-filter.user.js` — `build.sh` overwrites it.

```sh
npm install jsdom && node test/test.js   # tests
./build.sh                               # rebuild jai-bot-filter.user.js
```

`GH_USER` and `GH_REPO` at the top of `build.sh` set the links baked into the script
header, including the update URL Tampermonkey polls. To ship a change: bump `VERSION` in
`build.sh`, run `./build.sh`, push `jai-bot-filter.user.js` to `main`. Installs pick it up
on their own — Tampermonkey only offers an update when that version number goes up, so
forgetting to bump it means nobody gets the change.

The storage keys still carry the old `jrf-` prefix on purpose. They are a data contract,
not a name: renaming them on the rebrand would have silently dropped everyone's settings,
whitelist and learned baseline on upgrade.

## Licence

MIT — see [LICENSE](LICENSE).

Not affiliated with JanitorAI.
#   j a i - b o t - f i l t e r  
 