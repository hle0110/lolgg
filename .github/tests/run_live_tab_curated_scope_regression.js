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

  const dom = makeDom();
  const { window } = dom;

  const majorLeague = { id: "L1", name: "LCK", slug: "lck", image: "" };
  const minorLeague = { id: "L9", name: "Hellenic Legends League", slug: "hll", image: "" };

  const majorLiveEvent = {
    type: "match", id: "ev-geng-dk", startTime: "2026-07-18T10:30:00Z", state: "inProgress", blockName: "Playoffs",
    league: majorLeague,
    match: { id: "ev-geng-dk", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: null } },
      { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: null } },
    ]},
  };
  const minorLiveEvent = {
    type: "match", id: "ev-hll", startTime: "2026-07-18T10:00:00Z", state: "inProgress", blockName: "Week 3",
    league: minorLeague,
    match: { id: "ev-hll", strategy: { count: 2 }, teams: [
      { id: "3001", name: "WLGaming", code: "WLG", result: { gameWins: 1, outcome: null } },
      { id: "3002", name: "Team Phantasma", code: "TPH", result: { gameWins: 1, outcome: null } },
    ]},
  };

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [majorLeague, minorLeague] } }) };
    }
    if (u.includes("/getLive")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [majorLiveEvent, minorLiveEvent] } } }) };
    }
    if (u.includes("/getSchedule")) {
      const m = u.match(/leagueId=([^&]*)/);
      const requestedId = m ? decodeURIComponent(m[1]) : null;
      if (requestedId === "L1") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [majorLiveEvent], pages: { older: null, newer: null } } } }) };
      }
      return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getEventDetails")) {
      const m = u.match(/id=([^&]*)/);
      const requestedId = m ? decodeURIComponent(m[1]) : null;
      const src = requestedId === "ev-hll" ? minorLiveEvent : majorLiveEvent;
      return { ok: true, json: async () => ({ data: { event: { id: src.id, state: "inProgress", startTime: src.startTime, streams: [], match: { strategy: src.match.strategy, teams: src.match.teams, games: [{ id: "g1", number: 1, state: "inProgress", teams: [] }] } } } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  await window.loadLiveTab(false);
  const tabContentEl = window.document.getElementById("tab-content");

  check("The default (All Leagues) Ongoing tab shows the curated-league live match (DK vs GenG)", tabContentEl.innerHTML.includes("Gen.G") && tabContentEl.innerHTML.includes("Dplus KIA"));
  check("The default (All Leagues) Ongoing tab does not show a live match from a non-curated minor league", !tabContentEl.innerHTML.includes("WLGaming") && !tabContentEl.innerHTML.includes("Hellenic"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
