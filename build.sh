#!/usr/bin/env bash
# Concatenates the three sources into the single file a userscript manager
# installs. Edit panel.js / engine.js / userscript-adapter.js, never the
# built output — build.sh overwrites it.
set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------------
# Where the script header points for updates. Tampermonkey re-checks the
# raw URL on its own schedule, so pushing a new version to main is all it
# takes for installs to pick it up.
GH_USER="retaded"
GH_REPO="jai-bot-filter"
VERSION="7.1.1"
# ---------------------------------------------------------------------

OUT="dist/jai-bot-filter.user.js"
mkdir -p dist

# Quoted heredoc: nothing in here is expanded by the shell, so backticks
# and $ in the prose stay literal. The placeholders are filled in below.
cat > "$OUT" <<'HEADER'
// ==UserScript==
// @name         J.AI Bot Filter
// @namespace    __HOME__
// @version      __VERSION__
// @description  Hides botted JanitorAI cards - ones producing more conversation than their character definition can account for, and ones whose thousands of chats left almost no comments behind - and fills the gaps with clean cards from further down the list.
// @author       __GH_USER__
// @license      MIT
// @homepageURL  __HOME__
// @supportURL   __HOME__/issues
// @downloadURL  __RAW__
// @updateURL    __RAW__
// @match        https://janitorai.com/*
// @match        https://www.janitorai.com/*
// @match        https://janitorai.org/*
// @match        https://www.janitorai.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* =====================================================================
 * WHAT THIS DOES
 * ---------------------------------------------------------------------
 * A long conversation needs material. A bot's definition — persona,
 * scenario, opening message, example dialogue — is that material, and
 * JanitorAI reports its size as total_tokens on every listing. Divide
 * messages-per-chat by it, correct for the bot's age, and you have how
 * much talk it produces per unit of content. A thin bot cannot hold
 * anyone for fifteen messages, so when it reports that it did, something
 * else produced them.
 *
 * Both numbers arrive in the listing the page already fetched, so by
 * default this makes NO extra requests, learns nothing, stores nothing
 * about you, and never touches your session token.
 *
 * ABOUT THE SESSION TOKEN
 * ---------------------------------------------------------------------
 * Two optional features do need it, because they read page 2 of the API
 * and that returns 401 without a token: gap-filling (pulling clean bots
 * in to replace hidden ones), and the "Similar cards" rule, which learns
 * typical ratios from deeper pages.
 *
 * With either of those on, the token is read in-page from the
 * sb-*-auth-token cookie janitorai.com already set, sent ONLY to
 * janitorai.com exactly as the site does, and never stored, logged, or
 * sent anywhere else. There is no server behind this script — search this
 * file for `authToken` and `apiGet` to check.
 *
 * Leave the default rule selected and turn off "Fill the gaps with clean
 * cards", and the token is never read at all.
 * ===================================================================== */

HEADER

HOME_URL="https://github.com/${GH_USER}/${GH_REPO}"
RAW_URL="https://raw.githubusercontent.com/${GH_USER}/${GH_REPO}/main/jai-bot-filter.user.js"
sed -i "s|__VERSION__|${VERSION}|; s|__GH_USER__|${GH_USER}|; s|__RAW__|${RAW_URL}|g; s|__HOME__|${HOME_URL}|g" "$OUT"

{
  echo "/* ---- panel.js ---- */"
  cat panel.js
  echo ""
  echo "/* ---- engine.js ---- */"
  cat engine.js
  echo ""
  echo "/* ---- userscript-adapter.js ---- */"
  cat userscript-adapter.js
} >> "$OUT"

# Strip the CommonJS tails; they're meaningless in a userscript.
sed -i "/if (typeof module !== 'undefined' && module.exports)/d" "$OUT"

# Keep a copy at the repo root so the raw URL above is short and stable.
cp "$OUT" jai-bot-filter.user.js
echo "built jai-bot-filter.user.js ($(wc -l < "$OUT") lines)"
