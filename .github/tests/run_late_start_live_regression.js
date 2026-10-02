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

  const lateStart = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  const liveEvent = {
    type: "match",
    id: "ev-geng-dk",
    startTime: lateStart,
    state: "inProgress",
    blockName: "Playoffs",
    league: { id: "L1", name: "LCK", slug: "lck", image: "" },
    match: {
      id: "ev-geng-dk",
      strategy: { count: 3 },
      teams: [
        { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: null } },
        { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: null } },
      ],
    },
  };

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [{ id: "L1", name: "LCK", slug: "lck", image: "" }] } }) };
    }
    if (u.includes("/getLive")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [liveEvent] } } }) };
    }
    if (u.includes("/getSchedule")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [liveEvent], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: "ev-geng-dk",
              state: "inProgress",
              startTime: lateStart,
              streams: [],
              match: { strategy: { count: 3 }, teams: liveEvent.match.teams, games: [{ id: "g1", number: 1, state: "inProgress", teams: [] }] },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  const genuinelyLive = await window.eventIsGenuinelyLive(liveEvent);
  check("A late-starting match with inProgress state but no stream data yet is still counted as genuinely live", genuinelyLive === true);

  await window.loadLiveTab(false);
  const tabContentEl = window.document.getElementById("tab-content");
  check("The Ongoing tab actually shows a match with no stream data yet, as long as it is inProgress", tabContentEl.innerHTML.includes("Gen.G") && tabContentEl.innerHTML.includes("Dplus KIA"));
  check("The Ongoing tab does not show the 'no matches live' idle message", !tabContentEl.innerHTML.includes("No matches are live right now"));

  const finishedTeams = [
    { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 2, outcome: "win" } },
    { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: "loss" } },
  ];
  const notLiveEvent = { ...liveEvent, id: "ev-not-live", match: { ...liveEvent.match, teams: finishedTeams } };
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: "ev-not-live",
              state: "completed",
              startTime: lateStart,
              streams: [],
              match: { strategy: { count: 3 }, teams: notLiveEvent.match.teams, games: [] },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
  const notGenuinelyLive = await window.eventIsGenuinelyLive(notLiveEvent);
  check(
    "A match that has actually finished (with a real recorded score/outcome) is correctly excluded, regardless of stream data",
    notGenuinelyLive === false
  );

  const bogusZeroZeroEvent = { ...liveEvent, id: "ev-bogus-zero-zero" };
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: "ev-bogus-zero-zero",
              state: "completed",
              startTime: lateStart,
              streams: [],
              match: { strategy: { count: 3 }, teams: bogusZeroZeroEvent.match.teams, games: [] },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
  const bogusButRecentlyStarted = await window.eventIsGenuinelyLive(bogusZeroZeroEvent);
  check(
    "A 'completed' event with a 0-0 score and no recorded outcome (Riot's known bogus-completed-events bug) that started recently is treated as live, not trusted as finished",
    bogusButRecentlyStarted === true
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
