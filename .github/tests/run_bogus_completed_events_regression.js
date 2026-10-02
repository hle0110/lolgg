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

function realMatchEvent(id, isoDate, leagueId) {
  return {
    type: "match",
    startTime: isoDate,
    state: "inProgress",
    blockName: "Week 2",
    league: { id: leagueId, name: "LPL", slug: "lpl", image: "" },
    match: {
      id,
      strategy: { count: 3 },
      teams: [{ id: "we", name: "Xi'an Team WE", code: "WE" }, { id: "edg", name: "EDward Gaming", code: "EDG" }],
    },
  };
}

function bogusZeroZeroCompletedEvent(id, isoDate, leagueId) {
  return {
    type: "match",
    startTime: isoDate,
    state: "completed",
    blockName: "Week 2",
    league: { id: leagueId, name: "LPL", slug: "lpl", image: "" },
    match: {
      id,
      strategy: { count: 3 },
      teams: [{ id: "we", name: "Xi'an Team WE", code: "WE" }, { id: "edg", name: "EDward Gaming", code: "EDG" }],
    },
  };
}

function genuinelyDecidedEvent(id, isoDate, leagueId) {
  return {
    type: "match",
    startTime: isoDate,
    state: "completed",
    blockName: "Week 1",
    league: { id: leagueId, name: "LPL", slug: "lpl", image: "" },
    match: {
      id,
      strategy: { count: 3 },
      teams: [
        { id: "jdg", name: "Beijing JDG Esports", code: "JDG", result: { gameWins: 2, outcome: "win" } },
        { id: "ttg", name: "Thunder Talk Gaming", code: "TT", result: { gameWins: 0, outcome: "loss" } },
      ],
    },
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check(
    "getSchedule() now merges supplemental completed-events data BEFORE the live schedule fetch, so fresh schedule state always wins on conflict",
    /for \(const e of freshSupplemental\) byId\.set\(e\.id, e\);\s*\n\s*for \(const e of freshEvents\) byId\.set\(e\.id, e\);/.test(app)
  );
  check(
    "The returned combined schedule also prioritizes the fresh live schedule over stale supplemental data",
    /const combined = new Map\(freshSupplemental\.map\(\(e\) => \[e\.id, e\]\)\);\s*\n\s*for \(const e of freshEvents\) combined\.set\(e\.id, e\);/.test(app)
  );
  check(
    "getCompletedEventsForTournament now discards entries that don't actually have a decided series outcome (the 0-0 'Final' bug)",
    /\.filter\(\(e\) => seriesOutcomeDecided\(e\.teams\)\);/.test(app)
  );

  const dom = makeDom();
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [{ id: "LPL", name: "LPL", slug: "lpl", image: "" }] } }) };
    }
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getTournamentsForLeague")) {
      return {
        ok: true,
        json: async () => ({
          data: { leagues: [{ tournaments: [{ id: "t-active", startDate: "2026-06-01T00:00:00Z", endDate: "2030-01-01T00:00:00Z" }] }] },
        }),
      };
    }
    if (u.includes("/getCompletedEvents")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            schedule: {
              events: [
                bogusZeroZeroCompletedEvent("we-edg-live", "2026-07-30T05:00:00Z", "LPL"),
                genuinelyDecidedEvent("jdg-tt-real-final", "2026-07-23T07:00:00Z", "LPL"),
              ],
            },
          },
        }),
      };
    }
    if (u.includes("/getSchedule")) {
      const params = new URL(u).searchParams;
      const pageToken = params.get("pageToken");
      if (!pageToken) {
        return {
          ok: true,
          json: async () => ({
            data: {
              schedule: {
                events: [realMatchEvent("we-edg-live", "2026-07-30T05:00:00Z", "LPL")],
                pages: { older: null, newer: null },
              },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(app);
  await new Promise((r) => setTimeout(r, 20));

  const scheduleResult = await window.getSchedule(["LPL"]);
  const weEdg = scheduleResult.find((e) => e.id === "we-edg-live");
  check(
    "A match that's genuinely live per the real schedule feed is NOT overridden to completed by the bogus 0-0 completed-events entry for the same match",
    !!weEdg && weEdg.state === "inProgress"
  );

  const completedForTournament = await window.getCompletedEventsForTournament("t-active");
  check(
    "The bogus 0-0 'completed' entry for the still-live match is excluded from the tournament's completed-events list",
    !completedForTournament.some((e) => e.id === "we-edg-live")
  );
  check(
    "A genuinely decided match (real score, real outcome) is still correctly included as completed",
    completedForTournament.some((e) => e.id === "jdg-tt-real-final")
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
