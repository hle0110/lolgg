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

function matchEvent(id, isoDate, state, teamA, teamB) {
  return {
    type: "match",
    id,
    startTime: isoDate,
    state,
    blockName: "Playoffs",
    league: { id: "L1", name: "LCK", slug: "lck", image: "https://example.com/lck.png" },
    match: {
      id,
      strategy: { count: 3 },
      teams: [
        { name: teamA, code: teamA, result: state === "completed" ? { gameWins: 2, outcome: "win" } : { gameWins: 0, outcome: null } },
        { name: teamB, code: teamB, result: state === "completed" ? { gameWins: 1, outcome: "loss" } : { gameWins: 0, outcome: null } },
      ],
    },
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;
  window.requestAnimationFrame = (cb) => cb();

  const futureStart = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 5 * 3600 * 1000).toISOString();

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [{ id: "L1", name: "LCK", slug: "lck", image: "" }] } }) };
    }
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getTournamentsForLeague")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            leagues: [
              {
                tournaments: [
                  { id: "T1", startDate: "2026-06-01T00:00:00Z", endDate: "2030-01-01T00:00:00Z" },
                ],
              },
            ],
          },
        }),
      };
    }
    if (u.includes("/getCompletedEvents")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getStandings")) return { ok: true, json: async () => ({ data: { standings: [] } }) };
    if (u.includes("/getSchedule")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            schedule: {
              events: [
                matchEvent("ev-upcoming", futureStart, "unstarted", "T1", "GEN"),
                matchEvent("ev-completed", pastStart, "completed", "T1", "DK"),
              ],
              pages: { older: null, newer: null },
            },
          },
        }),
      };
    }
    if (u.includes("/getEventDetails")) {
      const idParam = new URL(u).searchParams.get("id");
      const isCompleted = idParam === "ev-completed";
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: idParam,
              state: isCompleted ? "completed" : "unstarted",
              startTime: isCompleted ? pastStart : futureStart,
              streams: [],
              match: { strategy: { count: 3 }, teams: [{ id: "1001", name: "T1", code: "T1" }, { id: "1002", name: isCompleted ? "DK" : "GEN", code: isCompleted ? "DK" : "GEN" }], games: [] },
            },
          },
        }),
      };
    }
    if (u.includes("/getTeams")) {
      const idParam = new URL(u).searchParams.get("id");
      if (idParam === "1001") {
        return { ok: true, json: async () => ({ data: { teams: [{ id: "1001", name: "T1", code: "T1", image: "", homeLeague: { name: "LCK", region: "KOREA" } }] } }) };
      }
      return { ok: true, json: async () => ({ data: { teams: [] } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  // ============ 1. Home page boots without throwing ============
  check("App initializes without throwing (window.init exists and ran)", typeof window.init === "function");
  check("League filter pills got populated", window.document.getElementById("league-filter").innerHTML.includes("LCK"));

  // ============ 2. Upcoming tab shows the upcoming match with a countdown ============
  await window.loadScheduleTab("unstarted");
  const tabContentEl = window.document.getElementById("tab-content");
  check("Upcoming tab lists the upcoming T1 vs GEN match", tabContentEl.innerHTML.includes("T1") && tabContentEl.innerHTML.includes("GEN"));

  // ============ 3. Completed tab shows the finished match ============
  await window.loadScheduleTab("completed");
  check("Completed tab lists the finished T1 vs DK match", tabContentEl.innerHTML.includes("T1") && tabContentEl.innerHTML.includes("DK"));

  // ============ 4. Match page renders for the upcoming match, with a live countdown ============
  await window.renderMatchPage("ev-upcoming");
  const matchMainEl = window.document.getElementById("match-main");
  check("Match page renders the upcoming match without throwing", matchMainEl.innerHTML.length > 0);
  check("Match page shows a countdown slot for the upcoming match", matchMainEl.querySelector("#match-countdown-slot") !== null);
  check("Match page's official-stream section resolves for LCK (Twitch/YouTube links)", matchMainEl.innerHTML.includes("watch-link"));

  // ============ 5. Tournament page renders ============
  await window.renderTournamentPage("L1", "T1");
  const tournamentMainEl = window.document.getElementById("tournament-main");
  check("Tournament page renders without throwing", tournamentMainEl.innerHTML.length > 0);

  // ============ 6. Team page renders with the fixed real-id roster lookup path ============
  await window.renderTeamPage("T1");
  const teamMainEl = window.document.getElementById("team-main");
  check("Team page renders without throwing", teamMainEl.innerHTML.length > 0);
  check("Team page shows the resolved home league (proves getTeamByQuery(realId) still works post-strip)", teamMainEl.innerHTML.includes("LCK") && teamMainEl.innerHTML.includes("KOREA"));
  check("Team page has no leftover Roster section (removed feature stays removed)", !teamMainEl.innerHTML.includes(">Roster<"));

  // ============ 7. Navigating home and back cleans up timers without throwing ============
  window.renderHome();
  check("Navigating back home does not throw", window.document.getElementById("home-view").classList.contains("hidden") === false);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
