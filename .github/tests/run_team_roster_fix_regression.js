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

  const getTeamsCalls = [];
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getSchedule")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            schedule: {
              events: [
                {
                  type: "match",
                  id: "ev-1",
                  startTime: "2026-06-01T00:00:00Z",
                  state: "completed",
                  blockName: "Week 1",
                  league: { id: "L1", name: "LCK", slug: "lck", image: "" },
                  match: {
                    id: "ev-1",
                    strategy: { count: 1 },
                    teams: [
                      // The real numeric Riot team id (1001) lives right here on the match's team object,
                      // separate from the short display code (T1) the team page is routed by.
                      { id: "1001", name: "T1", code: "T1", result: { gameWins: 1, outcome: "win" } },
                      { id: "1002", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: "loss" } },
                    ],
                  },
                },
              ],
              pages: { older: null, newer: null },
            },
          },
        }),
      };
    }
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getTeams")) {
      const idParam = new URL(u).searchParams.get("id");
      getTeamsCalls.push(idParam);
      // This is the crux of the real bug: Riot's /getTeams only ever resolves a real numeric id.
      // Querying with the short display code ("T1") - what the old, broken code did - comes back empty,
      // exactly like the real API does (confirmed against the live site, per the comment in app.js).
      // The Team Roster section itself has since been removed entirely, but the underlying id-
      // resolution fix is still what powers the team page's home-league line, so it's still covered.
      if (idParam === "1001") {
        return {
          ok: true,
          json: async () => ({
            data: {
              teams: [
                {
                  id: "1001",
                  name: "T1",
                  code: "T1",
                  image: "https://example.com/t1.png",
                  homeLeague: { name: "LCK", region: "KOREA" },
                },
              ],
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ data: { teams: [] } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  check("The old getTeamDetails(shortCode) function has been removed (dead/broken code, not just unused)", window.getTeamDetails === undefined);
  check("The Team Roster section (teamRosterHtml) has been removed entirely", window.teamRosterHtml === undefined);

  await window.renderTeamPage("T1");
  const teamMainEl = window.document.getElementById("team-main");

  check(
    "/getTeams is looked up with the real numeric team id (1001), not the short display code (T1) the page is routed by",
    getTeamsCalls.includes("1001")
  );
  check(
    "/getTeams is never queried with the short code directly - that's the exact call shape that always came back empty on the real API",
    !getTeamsCalls.includes("T1")
  );
  check(
    "The resolved home league (LCK · KOREA) shows on the team page, proving getTeamByQuery's result is actually being used",
    teamMainEl.innerHTML.includes("LCK") && teamMainEl.innerHTML.includes("KOREA")
  );
  check(
    "There is no Roster heading or roster grid on the team page anymore",
    !teamMainEl.innerHTML.includes(">Roster<") && !teamMainEl.innerHTML.includes("roster-grid")
  );

  // ============ Graceful fallback: a team with no id anywhere in scheduleCache still renders cleanly ============
  await window.renderTeamPage("UNKNOWNCODE");
  check("A team code that never appears in any loaded match still renders without throwing", teamMainEl.innerHTML.includes("UNKNOWNCODE"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
