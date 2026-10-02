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

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    if (u.includes("/getEventDetails")) {
      return { ok: true, json: async () => ({ data: { event: { id: "any", state: "unstarted", streams: [], match: { strategy: { count: 3 }, teams: [] } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) {
      const params = new URL(u).searchParams;
      const leagueId = params.get("leagueId");
      if (leagueId === "L1") {
        return {
          ok: true,
          json: async () => ({
            data: {
              leagues: [
                {
                  tournaments: [
                    { id: "T1", startDate: "2026-07-01T00:00:00Z", endDate: "2026-08-01T00:00:00Z" },
                    { id: "T0", startDate: "2026-01-01T00:00:00Z", endDate: "2026-02-01T00:00:00Z" },
                  ],
                },
              ],
            },
          }),
        };
      }
      // L2 (and anything else): league exists but has no tournaments on record
      return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  const matchMainEl = window.document.getElementById("match-main");

  // ============ A: event resolves to a specific tournament -> header links to that exact tournament ============
  const eventWithResolvedTournament = {
    id: "ev-a",
    startTime: "2026-07-17T10:00:00Z", // falls inside T1's date range
    state: "unstarted",
    blockName: "Playoffs",
    bestOf: 3,
    league: { id: "L1", name: "LCK", slug: "lck", image: "" },
    teams: [],
  };
  await window.paintMatchPage("ev-a", eventWithResolvedTournament);
  check(
    "Header wraps the logo/name in a link to the SPECIFIC resolved tournament (league L1, tournament T1)",
    matchMainEl.querySelector('a.modal-header-link[href="#/tournament/L1/T1"]') !== null
  );
  check(
    "The header link contains the league logo/name block, not just bare text",
    !!matchMainEl.querySelector('a.modal-header-link .modal-league')
  );
  check(
    "The bottom 'Full bracket' link uses the same specific-tournament href, not the generic league or Liquipedia fallback",
    matchMainEl.innerHTML.includes('href="#/tournament/L1/T1">Full bracket ↗')
  );

  // ============ B: league known but no matching tournament -> header falls back to league-only link ============
  const eventLeagueOnlyFallback = {
    id: "ev-b",
    startTime: "2026-07-17T10:00:00Z",
    state: "unstarted",
    blockName: "",
    bestOf: 1,
    league: { id: "L2", name: "Some League", slug: "some-league", image: "" },
    teams: [],
  };
  await window.paintMatchPage("ev-b", eventLeagueOnlyFallback);
  check(
    "When no specific tournament resolves, the header still links, but to the league-only tournament page",
    matchMainEl.querySelector('a.modal-header-link[href="#/tournament/L2"]') !== null
  );

  // ============ C: no league at all -> header is NOT a link, bottom link falls back to Liquipedia search ============
  const eventNoLeague = {
    id: "ev-c",
    startTime: "2026-07-17T10:00:00Z",
    state: "unstarted",
    blockName: "",
    bestOf: 1,
    league: null,
    teams: [{ code: "T1", name: "Team One" }, { code: "T2", name: "Team Two" }],
  };
  await window.paintMatchPage("ev-c", eventNoLeague);
  check(
    "With no league at all, the header is plain (no modal-header-link wrapper) rather than a dead/broken link",
    matchMainEl.querySelector('a.modal-header-link') === null
  );
  check(
    "The bottom bracket link falls back to a Liquipedia search when there's no tournament to link to",
    matchMainEl.innerHTML.includes("Full bracket on Liquipedia") && matchMainEl.innerHTML.includes("liquipedia.net")
  );

  // ============ D: undefined event entirely (couldn't be resolved at all) -> no header link, no crash ============
  await window.paintMatchPage("ev-d", undefined);
  check(
    "An entirely unresolved event (undefined) still renders without a header link and without throwing",
    matchMainEl.querySelector('a.modal-header-link') === null && matchMainEl.innerHTML.includes("modal-header")
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
