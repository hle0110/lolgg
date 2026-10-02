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

  // Fixture: LCK has 2 tournaments - a completed Spring split (already ended) and an upcoming Summer
  // split (hasn't started yet) - the exact "search finds the completed one, upcoming one invisible"
  // bug report. Dates are relative to "now" so this test doesn't rot.
  const now = Date.now();
  const completedTournament = {
    id: "lck-spring-2026",
    startDate: new Date(now - 60 * 86400000).toISOString(),
    endDate: new Date(now - 5 * 86400000).toISOString(),
  };
  const upcomingTournament = {
    id: "lck-summer-2026",
    startDate: new Date(now + 20 * 86400000).toISOString(),
    endDate: new Date(now + 80 * 86400000).toISOString(),
  };

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [{ id: "lck", name: "LCK", slug: "lck" }] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    if (u.includes("/getTournamentsForLeague")) {
      return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [completedTournament, upcomingTournament] }] } }) };
    }
    if (u.includes("/getStandings")) return { ok: true, json: async () => ({ data: { standings: { stages: [] } } }) };
    if (u.includes("/getCompletedEvents")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  // ============ tournamentStatus ============
  const league = { id: "lck", name: "LCK" };
  check("tournamentStatus correctly identifies a past-dated tournament as completed", window.tournamentStatus(completedTournament, league) === "completed");
  check("tournamentStatus correctly identifies a future-dated tournament as upcoming", window.tournamentStatus(upcomingTournament, league) === "upcoming");
  const ongoingTournament = { id: "x", startDate: new Date(now - 5 * 86400000).toISOString(), endDate: new Date(now + 5 * 86400000).toISOString() };
  check("tournamentStatus correctly identifies a tournament spanning today as ongoing", window.tournamentStatus(ongoingTournament, league) === "ongoing");

  // ============ tournamentSwitcherHtml ============
  const switcherSingle = window.tournamentSwitcherHtml("lck", [completedTournament], league, "lck-spring-2026");
  check("No switcher is rendered when a league only has a single tournament (nothing to switch to)", switcherSingle === "");

  const switcherMulti = window.tournamentSwitcherHtml("lck", [completedTournament, upcomingTournament], league, "lck-spring-2026");
  check("The switcher includes a pill for the completed tournament", switcherMulti.includes("lck-spring-2026") && /Completed/.test(switcherMulti));
  check("The switcher includes a pill for the upcoming tournament - this is the actual bug fix: it's now reachable", switcherMulti.includes("lck-summer-2026") && /Upcoming/.test(switcherMulti));
  check("The currently-viewed tournament's pill is marked active", new RegExp(`class="tournament-switcher-pill[^"]*active[^"]*"[^>]*href="#/tournament/lck/lck-spring-2026"`).test(switcherMulti));
  check("The upcoming tournament's pill links to its own tournament id", switcherMulti.includes('href="#/tournament/lck/lck-summer-2026"'));

  // ============ Full renderTournamentPage integration - the exact "search LCK" scenario ============
  // No explicit tournamentId in the URL (exactly what the search bar's siteSearchResultHref produces
  // for a league result) - pickDisplayTournament lands on the completed split, but the switcher on
  // that same page should still surface the upcoming one.
  await window.renderTournamentPage("lck", null);
  await new Promise((r) => setTimeout(r, 20));
  const pageHtml = window.document.getElementById("tournament-main").innerHTML;
  check("Landing on LCK with no explicit tournament (the search-bar scenario) still shows the switcher", pageHtml.includes("tournament-switcher"));
  check("The upcoming LCK split is visible/reachable from this same page, not hidden", pageHtml.includes("lck-summer-2026"));
  check("The page defaulted to the completed split (pickDisplayTournament's existing behavior, unchanged)", pageHtml.includes("lck-spring-2026") && /active/.test(pageHtml));

  // Following the switcher's link to the upcoming split actually renders that tournament instead
  await window.renderTournamentPage("lck", "lck-summer-2026");
  await new Promise((r) => setTimeout(r, 20));
  const upcomingPageHtml = window.document.getElementById("tournament-main").innerHTML;
  check("Explicitly navigating to the upcoming tournament id renders that one, with it now marked active in the switcher", new RegExp(`class="tournament-switcher-pill[^"]*active[^"]*"[^>]*href="#/tournament/lck/lck-summer-2026"`).test(upcomingPageHtml));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
