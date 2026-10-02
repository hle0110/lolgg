const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker">
      <div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div>
      <button id="notify-toggle"></button>
      <select id="tz-select"></select>
    </div>
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

  const rawStarOrderEvent = {
    type: "match",
    startTime: new Date().toISOString(),
    state: "completed",
    blockName: "",
    league: { id: "lec", name: "LEC", slug: "lec" },
    match: {
      id: "star-order-match",
      strategy: { count: 1 },
      teams: [
        { id: "1", name: "Team Vitality", code: "VIT", result: { gameWins: 1, outcome: "win" } },
        { id: "2", name: "Los Ratones", code: "LR", result: { gameWins: 0, outcome: "loss" } },
      ],
    },
  };
  const dom = makeDom();
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [rawStarOrderEvent], pages: { older: null, newer: null } } } }) };
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: "star-order-match",
              state: "completed",
              startTime: rawStarOrderEvent.startTime,
              streams: [],
              match: { strategy: { count: 1 }, teams: rawStarOrderEvent.match.teams, games: [] },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  // init()'s own startup getSchedule() call picks up the fixture event above and populates the real
  // scheduleCache, which renderMatchPage reads from directly - same reasoning as the scheduleCache
  // note in run_ux_additions_regression.js (assigning window.scheduleCache directly doesn't work).
  await new Promise((r) => setTimeout(r, 30));

  // ============ Favorite-star placement on the match page ============
  await window.renderMatchPage("star-order-match");
  await new Promise((r) => setTimeout(r, 20));
  const teamsBlockHtml = window.document.querySelector(".match-teams.modal-teams").innerHTML;
  const leftLink = window.document.querySelectorAll(".team-link")[0];
  const rightLink = window.document.querySelectorAll(".team-link")[1];
  check("Match page renders exactly 2 team-link blocks", window.document.querySelectorAll(".team-link").length === 2);
  check(
    "Left team (Team Vitality): the star is the FIRST child, in front of the team info",
    leftLink.children[0].classList.contains("favorite-star") && leftLink.children[1].classList.contains("esports-team")
  );
  check(
    "Right team (Los Ratones): the star is the LAST child, after the team info",
    rightLink.children[0].classList.contains("esports-team") && rightLink.children[1].classList.contains("favorite-star")
  );
  check("The star is a direct sibling of .esports-team, not nested inside it (so it can't wrap onto its own line)", !leftLink.querySelector(".esports-team .favorite-star") && !rightLink.querySelector(".esports-team .favorite-star"));
  check("Both team names still render correctly alongside their stars", teamsBlockHtml.includes("Team Vitality") && teamsBlockHtml.includes("Los Ratones"));

  // ============ Year in date labels ============
  const sampleIso = "2026-07-17T19:00:00Z";
  const localLabel = window.localTimeLabel(sampleIso);
  check("localTimeLabel (match rows, team history, match page) includes the year", /2026/.test(localLabel));
  const bracketLabel = window.bracketTimeLabel(sampleIso);
  check("bracketTimeLabel (narrow bracket columns) includes a year", /26/.test(bracketLabel));
  check("bracketTimeLabel uses the compact 2-digit year, not the full 4-digit one, to avoid overflow in narrow columns", !/2026/.test(bracketLabel) && /'?26\b/.test(bracketLabel.replace(/,/g, "")) || /26/.test(bracketLabel));
  const rangeLabel = window.tournamentDateRangeLabel({ startDate: "2026-07-01T00:00:00Z", endDate: "2026-07-30T00:00:00Z" });
  check("tournamentDateRangeLabel drops the redundant year on the start date when both ends share a year (more compact)", (rangeLabel.match(/2026/g) || []).length === 1);
  const crossYearLabel = window.tournamentDateRangeLabel({ startDate: "2025-12-15T00:00:00Z", endDate: "2026-01-20T00:00:00Z" });
  check("tournamentDateRangeLabel still shows the year on both ends when the range crosses a year boundary", (crossYearLabel.match(/20(25|26)/g) || []).length === 2);
  window.scheduleCache = [];
  const grouped = window.groupByDay([{ startTime: sampleIso }]);
  const [dayHeading] = [...grouped.keys()];
  check("groupByDay's day heading includes the year", /2026/.test(dayHeading));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
