const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div><div id="theme-toggle"></div></div>
    <div id="top-clock"><select id="tz-select"></select><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
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
  window.requestAnimationFrame = (cb) => cb();
  window.scrollTo = () => {};

  const lck = { id: "L1", name: "LCK", slug: "lck", image: "" };
  const minor = { id: "L9", name: "Hellenic Legends League", slug: "hll", image: "" };

  const liveMatch = {
    type: "match", id: "ev-live", startTime: "2026-07-19T10:00:00Z", state: "inProgress", blockName: "Playoffs",
    league: lck,
    match: { id: "ev-live", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: null } },
      { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: null } },
    ]},
  };
  const minorLiveMatch = {
    type: "match", id: "ev-minor-live", startTime: "2026-07-19T10:00:00Z", state: "inProgress", blockName: "Week 1",
    league: minor,
    match: { id: "ev-minor-live", strategy: { count: 2 }, teams: [
      { id: "9001", name: "WLGaming", code: "WLG", result: { gameWins: 0, outcome: null } },
      { id: "9002", name: "Team Phantasma", code: "TPH", result: { gameWins: 0, outcome: null } },
    ]},
  };
  const upcomingMatch = {
    type: "match", id: "ev-upcoming", startTime: "2026-07-25T10:00:00Z", state: "unstarted", blockName: "Playoffs",
    league: lck,
    match: { id: "ev-upcoming", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: null } },
      { id: "1003", name: "T1", code: "T1", result: { gameWins: 0, outcome: null } },
    ]},
  };
  const completedMatch = {
    type: "match", id: "ev-completed", startTime: "2026-07-10T10:00:00Z", state: "completed", blockName: "Regular Season",
    league: lck,
    match: { id: "ev-completed", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 2, outcome: "win" } },
      { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: "loss" } },
    ]},
  };

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [lck, minor] } }) };
    }
    if (u.includes("/getLive")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [liveMatch, minorLiveMatch] } } }) };
    }
    if (u.includes("/getSchedule")) {
      const m = u.match(/leagueId=([^&]*)/);
      const requestedId = m ? decodeURIComponent(m[1]) : null;
      if (requestedId === "L1") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [liveMatch, upcomingMatch, completedMatch], pages: { older: null, newer: null } } } }) };
      }
      return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) {
      return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [{ id: "t1", startDate: "2026-07-01T00:00:00Z", endDate: "2026-07-30T00:00:00Z", name: "LCK Summer" }] }] } }) };
    }
    if (u.includes("/getEventDetails")) {
      const m = u.match(/id=([^&]*)/);
      const requestedId = m ? decodeURIComponent(m[1]) : null;
      const src = requestedId === "ev-minor-live" ? minorLiveMatch : requestedId === "ev-upcoming" ? upcomingMatch : requestedId === "ev-completed" ? completedMatch : liveMatch;
      return { ok: true, json: async () => ({ data: { event: { id: src.id, state: src.state, startTime: src.startTime, streams: [], match: { strategy: src.match.strategy, teams: src.match.teams, games: [{ id: "g1", number: 1, state: src.state, teams: [] }] } } } }) };
    }
    if (u.includes("/getTeams")) return { ok: true, json: async () => ({ data: { teams: [] } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  check("No tournament-banner element exists in the DOM anymore", !window.document.getElementById("tournament-banner"));

  await window.loadLiveTab(false);
  const liveHtml = window.document.getElementById("tab-content").innerHTML;
  check("Live tab shows the curated-league live match", liveHtml.includes("Gen.G") && liveHtml.includes("Dplus KIA"));
  check("Live tab excludes the non-curated minor league's live match", !liveHtml.includes("WLGaming"));

  await window.renderMatchPage("ev-live");
  const matchHtml = window.document.getElementById("match-main").innerHTML;
  check("Match page renders for a live curated match", matchHtml.includes("Gen.G") && matchHtml.includes("Dplus KIA"));

  await window.renderTeamPage("GEN");
  const teamHtml = window.document.getElementById("team-main").innerHTML;
  check("Team page renders for a curated-league team", teamHtml.includes("Gen.G"));

  const tzSelect = window.document.getElementById("tz-select");
  check("Timezone select is populated and lives inside the clock element", tzSelect.options.length > 0 && !!tzSelect.closest("#top-clock"));
  check("Timezone select's parent is the top-clock element", tzSelect.parentElement && tzSelect.parentElement.id === "top-clock");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
