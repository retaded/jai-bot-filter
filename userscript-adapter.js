/* J.AI Bot Filter — userscript adapter (Tampermonkey / Violentmonkey) */
(function () {
  'use strict';
  // These keep the old prefix on purpose. They are a data contract, not
  // a name: renaming them on the rebrand would have silently dropped
  // everyone's settings, whitelist and learned baseline on upgrade.
  const CFG_KEY = 'jrf-settings';
  const DATA_KEY = 'jrf-baseline';
  const hasGM = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');

  function read(key) {
    try {
      const raw = hasGM ? GM_getValue(key, null) : localStorage.getItem(key);
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return null; }
  }
  function write(key, value) {
    try {
      const raw = JSON.stringify(value);
      if (hasGM) GM_setValue(key, raw);
      else localStorage.setItem(key, raw);
    } catch (e) { /* quota or blocked storage — settings stay session-only */ }
  }

  JBF.setStorage({
    async get() { return read(CFG_KEY) || {}; },
    async set(v) { write(CFG_KEY, v); },
    async getData() { return read(DATA_KEY); },
    async setData(v) { write(DATA_KEY, v); }
  });

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('J.AI Bot Filter — settings', () => JBF.openPanel());
    GM_registerMenuCommand('J.AI Bot Filter — rescan page', () => JBF.scan());
    GM_registerMenuCommand('J.AI Bot Filter — reset baseline', () => JBF.clearBaseline());
  }

  JBF.start();
})();
