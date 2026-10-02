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

  const standingsWithTbdSeed = {
    stages: [
      {
        name: "Group Stage",
        sections: [
          {
            name: "Group A",
            rankings: [
              { ordinal: 1, teams: [{ id: "1", code: "GEN", name: "Gen.G" }] },
              { ordinal: 2, teams: [{ id: "2", code: "T1", name: "T1" }] },
              { ordinal: 3, teams: [{ id: "3", code: "DK", name: "Dplus KIA" }] },
              { ordinal: 4, teams: [{ code: null, name: "TBD" }] },
            ],
            matches: [
              { teams: [{ id: "1" }, { id: "2" }] },
              { teams: [{ slug: null, code: null, name: null }, { id: "3" }] },
            ],
          },
        ],
      },
    ],
  };

  const teams = window.extractTeamsFromStandings(standingsWithTbdSeed, null);
  check("extractTeamsFromStandings resolves the 3 known teams", teams.length === 3);
  check("extractTeamsFromStandings never includes a TBD placeholder team", !teams.some((t) => (t.name || "").toUpperCase() === "TBD" || (!t.code && !t.name)));

  const html = window.standingsHtml(standingsWithTbdSeed, null);
  check("Standings table renders the 3 known teams", (html.match(/standings-team-name/g) || []).length === 3);
  check("Standings table never renders a bare TBD row when the roster is otherwise fully known", !/>TBD</.test(html));

  const gridHtml = window.teamsGridHtml(teams);
  check("Teams grid renders exactly the known teams, no phantom TBD card", (gridHtml.match(/class="team-name"/g) || []).length === 3 && !gridHtml.includes(">TBD<"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
