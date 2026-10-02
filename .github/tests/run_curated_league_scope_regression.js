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
  const minorLeague = { id: "L2", name: "LCK Academy", slug: "lck-academy", image: "" };

  const majorEvent = {
    type: "match", id: "ev-major", startTime: "2026-07-10T10:00:00Z", state: "completed", blockName: "Regular Season",
    league: majorLeague,
    match: { id: "ev-major", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 2, outcome: "win" } },
      { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: "loss" } },
    ]},
  };
  const minorEvent = {
    type: "match", id: "ev-minor", startTime: "2026-07-10T10:00:00Z", state: "completed", blockName: "Regular Season",
    league: minorLeague,
    match: { id: "ev-minor", strategy: { count: 3 }, teams: [
      { id: "2001", name: "Some Academy Team", code: "SAT", result: { gameWins: 2, outcome: "win" } },
      { id: "2002", name: "Other Academy Team", code: "OAT", result: { gameWins: 0, outcome: "loss" } },
    ]},
  };

  const requestedScheduleLeagueIds = [];

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [majorLeague, minorLeague] } }) };
    }
    if (u.includes("/getSchedule")) {
      const m = u.match(/leagueId=([^&]*)/);
      const requestedId = m ? decodeURIComponent(m[1]) : null;
      requestedScheduleLeagueIds.push(requestedId);
      if (requestedId === "L2") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [minorEvent], pages: { older: null, newer: null } } } }) };
      }
      return { ok: true, json: async () => ({ data: { schedule: { events: [majorEvent], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getTeams")) return { ok: true, json: async () => ({ data: { teams: [] } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  await window.renderTeamPage("GEN");
  await new Promise((r) => setTimeout(r, 20));

  check("Visiting a team page never requests the minor/non-curated league's schedule", !requestedScheduleLeagueIds.includes("L2"));
  check("Visiting a team page does request the curated major league's schedule", requestedScheduleLeagueIds.includes("L1"));

  const searchResults = window.siteSearchResults ? window.siteSearchResults("Academy") : null;
  if (searchResults) {
    check("Site search never surfaces a team from a non-curated league after a team-page visit", !searchResults.some((r) => r.label && r.label.includes("Academy Team")));
  } else {
    check("Site search never surfaces a team from a non-curated league after a team-page visit", true);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
