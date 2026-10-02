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

  const lck = { id: "L1", name: "LCK", slug: "lck", image: "" };
  const startsInHalfHour = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const startsInThreeHours = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const earlyCandidate = {
    id: "ev-early-1",
    startTime: startsInHalfHour,
    state: "unstarted",
    league: lck,
    match: { id: "ev-early-1", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Movistar KOI", code: "KOI", result: { gameWins: 0, outcome: null } },
      { id: "1002", name: "Team Liquid", code: "TL", result: { gameWins: 0, outcome: null } },
    ]},
  };
  const notYetCandidate = {
    id: "ev-far-1",
    startTime: startsInThreeHours,
    state: "unstarted",
    league: lck,
    match: { id: "ev-far-1", strategy: { count: 3 }, teams: [
      { id: "1003", name: "Cloud9", code: "C9", result: { gameWins: 0, outcome: null } },
      { id: "1004", name: "100 Thieves", code: "100T", result: { gameWins: 0, outcome: null } },
    ]},
  };

  let eventDetailsCalls = [];
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [lck] } }) };
    if (u.includes("/getSchedule")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [earlyCandidate, notYetCandidate], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getEventDetails")) {
      const parsed = new URL(u);
      const id = parsed.searchParams.get("id");
      eventDetailsCalls.push(id);
      if (id === "ev-early-1") {
        return {
          ok: true,
          json: async () => ({
            data: {
              event: {
                id: "ev-early-1",
                state: "unstarted",
                startTime: startsInHalfHour,
                streams: [],
                match: {
                  id: "ev-early-1",
                  strategy: { count: 3 },
                  teams: earlyCandidate.match.teams,
                  games: [{ id: "g1", number: 1, state: "inProgress", teams: [] }],
                },
              },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: { event: { id, state: "unstarted", startTime: startsInThreeHours, streams: [], match: { id, strategy: { count: 3 }, teams: [], games: [] } } },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  await window.getSchedule(["L1", "SEEDEARLY"]);
  await window.checkEarlyLiveMatches();

  check("A match starting within the next hour gets probed via getEventDetails", eventDetailsCalls.includes("ev-early-1"));
  check("A match starting more than an hour out is not probed", !eventDetailsCalls.includes("ev-far-1"));
  check(
    "An 'unstarted' match whose per-game feed already shows inProgress is flipped to live before its scheduled time arrives",
    window.scheduleCacheEventState("ev-early-1") === "inProgress"
  );
  check("A match not yet within the early-check window stays unstarted", window.scheduleCacheEventState("ev-far-1") === "unstarted");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
