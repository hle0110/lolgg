const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div><select id="tz-select"></select></div>
    <div id="top-clock"><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
    <nav id="tabs">
      <div class="seg"><button type="button" class="seg-btn" data-view="matches">Matches</button><button type="button" class="seg-btn" data-view="tournaments">Tournaments</button></div>
      <div class="seg"><button type="button" class="seg-btn" data-status="live">Live</button><button type="button" class="seg-btn" data-status="upcoming">Upcoming</button><button type="button" class="seg-btn" data-status="completed">Results</button></div>
    </nav>
    <div id="home-view"><div id="tournament-banner"></div><div id="league-filter"></div><main id="esports-main"><section id="tab-content"></section></main></div>
    <div id="match-view" class="hidden"><main id="match-main"></main></div>
    <div id="tournament-view" class="hidden"><main id="tournament-main"></main></div>
    <div id="team-view" class="hidden"><main id="team-main"></main></div>
  </body></html>`, { url: "https://example.com/#/", runScripts: "outside-only" });
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  // ============ Reload button no longer overlaps YouTube's top-right controls (CSS check) ============
  const css = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  const reloadBtnRuleMatch = css.match(/\.stream-reload-btn\s*\{[^}]*\}/);
  check(".stream-reload-btn rule exists in esports.css", !!reloadBtnRuleMatch);
  // Matches the actual CSS declaration only (trailing semicolon) - not the explanatory code comment
  // inside the same rule block, which mentions the old "top:8px," value as prose (trailing comma).
  check("The reload button is no longer pinned at top:8px (where it overlapped YouTube's gear icon)", reloadBtnRuleMatch && !/top:\s*8px\s*;/.test(reloadBtnRuleMatch[0]));
  check("The reload button is moved further down (top:48px)", reloadBtnRuleMatch && /top:\s*48px/.test(reloadBtnRuleMatch[0]));

  const dom = makeDom();
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  // ============ Stream priority: 10-minute auto-live window, no "3 minutes" text ============
  const known = { links: [{ url: "https://www.twitch.tv/lck/", label: "Twitch" }, { url: "https://www.youtube.com/@LCKglobal", label: "YouTube" }] };

  const farInFuture = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min out - well outside any window
  const resultFar = await window.resolveKnownLeagueStreamPriority(known, farInFuture);
  check("More than 10 minutes before a match, Twitch is assumed primary with no status text", resultFar.primary === "twitch" && resultFar.status === "");
  check("The removed '3 minutes' hint text does not appear anywhere", !/3 minutes/.test(resultFar.status));

  const withinTenMinutes = new Date(Date.now() + 7 * 60 * 1000).toISOString(); // 7 min out - inside the new 10-min window, outside the old 3-min one
  const resultWithinTen = await window.resolveKnownLeagueStreamPriority(known, withinTenMinutes);
  check(
    "7 minutes before a match (inside the new 10-minute window, which the old 3-minute window would have missed), Twitch is still assumed primary with no status text - this is the actual widened-window fix",
    resultWithinTen.primary === "twitch" && resultWithinTen.status === ""
  );

  // Old behavior check: this same 7-minutes-out scenario, under the OLD 3-minute cutoff, would have
  // fallen through to an actual decapi live-check instead of assuming Twitch - confirm the function
  // no longer does that by verifying no network call was made for this case (window.fetch call count
  // only reflects the earlier init() calls, not a new decapi hit).
  let decapiCalled = false;
  const originalFetch = window.fetch;
  window.fetch = async (url) => {
    if (String(url).includes("decapi.me")) decapiCalled = true;
    return originalFetch(url);
  };
  await window.resolveKnownLeagueStreamPriority(known, withinTenMinutes);
  check("No decapi live-check network call happens while still inside the assumed-live window", !decapiCalled);
  window.fetch = originalFetch;

  // ============ Silent background refresh: no loading flash, dedup unchanged content ============
  const tabContentEl = window.document.getElementById("tab-content");

  // setTabContent dedup: identical HTML is a no-op (returns false), different HTML writes (true)
  const wrote1 = window.setTabContent("<p>same</p>");
  check("setTabContent writes new content and reports a change", wrote1 === true && tabContentEl.innerHTML.includes("same"));
  const wrote2 = window.setTabContent("<p>same</p>");
  check("setTabContent skips the DOM write and reports no change when content is identical to what's already rendered", wrote2 === false);
  const wrote3 = window.setTabContent("<p>different</p>");
  check("setTabContent writes again once the content actually differs", wrote3 === true && tabContentEl.innerHTML.includes("different"));

  // Silent load never shows the loading placeholder - checked synchronously right after calling
  // (before awaiting), since the placeholder write (guarded by `if (!silent)`) happens synchronously
  // at the very top of the function, before its first await.
  window.setTabContent("<p>SENTINEL-BEFORE-SILENT</p>");
  const silentPromise = window.loadLiveTab(true);
  check("A silent (background poll) refresh does not show the 'Checking for live matches…' loading placeholder", tabContentEl.innerHTML.includes("SENTINEL-BEFORE-SILENT"));
  await silentPromise;

  window.setTabContent("<p>SENTINEL-BEFORE-NONSILENT</p>");
  const nonSilentPromise = window.loadLiveTab(false);
  check("A normal (non-silent) tab load DOES show the loading placeholder immediately", tabContentEl.innerHTML.includes("Checking for live matches"));
  await nonSilentPromise;

  // Silent failure leaves last good content on screen; non-silent failure shows an error message
  const brokenFetch = window.fetch;
  window.fetch = async (url) => {
    if (String(url).includes("/getLive")) throw new Error("network down");
    return brokenFetch(url);
  };
  window.setTabContent("<p>LAST-GOOD-CONTENT</p>");
  await window.loadLiveTab(true);
  check("A silent refresh that fails leaves the last good content on screen instead of showing an error", tabContentEl.innerHTML.includes("LAST-GOOD-CONTENT"));
  await window.loadLiveTab(false);
  check("A non-silent load that fails still shows the error message (unchanged behavior for real tab switches)", tabContentEl.innerHTML.includes("Couldn't load live matches"));
  window.fetch = brokenFetch;

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
