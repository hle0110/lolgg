const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div><select id="tz-select"></select></div>
    <div id="top-clock"><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
    <div id="offline-banner" class="hidden"></div>
    <div id="fatal-error-banner" class="hidden"></div>
    <nav id="tabs">
      <div class="seg"><button type="button" class="seg-btn" data-view="matches">Matches</button><button type="button" class="seg-btn" data-view="tournaments">Tournaments</button></div>
      <div class="seg"><button type="button" class="seg-btn" data-status="live">Live</button><button type="button" class="seg-btn" data-status="upcoming">Upcoming</button><button type="button" class="seg-btn" data-status="completed">Results</button></div>
    </nav>
    <div id="home-view"><div id="league-filter"></div><main id="esports-main"><section id="tab-content"></section></main></div>
    <div id="match-view" class="hidden"><main id="match-main"></main></div>
    <div id="tournament-view" class="hidden"><main id="tournament-main"></main></div>
    <div id="team-view" class="hidden"><main id="team-main"></main></div>
  </body></html>`, { url: "https://example.com/#/", runScripts: "outside-only" });
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  const league = { name: "LCK" };
  const teams = [{ name: "Gen.G", code: "GEN" }, { name: "T1", code: "T1" }];

  const html = window.highlightsSearchLinksHtml(league, teams);
  check("Highlights section includes an oplolreplay search link", html.includes("youtube.com/@oplolreplay/search"));
  check("Highlights section includes an OniviaHighlights search link", html.includes("youtube.com/@OniviaHighlights/search"));
  check("Both highlight links open in a new tab", (html.match(/target="_blank"/g) || []).length === 2);
  check("Both highlight links carry the league/team search query", (html.match(/query=/g) || []).length === 2);

  const oplolUrl = window.highlightsChannelSearchUrl("oplolreplay", league, teams);
  check(
    "highlightsChannelSearchUrl still builds a per-channel URL directly, searching by team code (matching how these channels actually title videos, e.g. 'GEN vs T1')",
    oplolUrl.includes("oplolreplay") && oplolUrl.includes(encodeURIComponent("GEN vs T1"))
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
