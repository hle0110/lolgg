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

function matchEvent(id, isoDate, leagueId = "L1") {
  return {
    type: "match",
    startTime: isoDate,
    state: "completed",
    blockName: "Week 1",
    league: { id: leagueId, name: "Test League", slug: "test-league", image: "" },
    match: {
      id,
      strategy: { count: 1 },
      teams: [
        { id: "t1", name: "Team A", code: "TA", result: { gameWins: 1, outcome: "win" } },
        { id: "t2", name: "Team B", code: "TB", result: { gameWins: 0, outcome: "loss" } },
      ],
    },
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;

  let scheduleCallCount = 0;
  let olderPageTokensRequested = [];
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return {
        ok: true,
        json: async () => ({ data: { leagues: [{ id: "L1", name: "LCK", slug: "lck", image: "" }] } }),
      };
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
                  { id: "t-old-2019", startDate: "2019-06-01T00:00:00Z", endDate: "2019-08-01T00:00:00Z" },
                  { id: "t-old-2022", startDate: "2022-11-01T00:00:00Z", endDate: "2022-12-15T00:00:00Z" },
                  { id: "t-new-2023", startDate: "2023-01-15T00:00:00Z", endDate: "2023-03-01T00:00:00Z" },
                  // endDate deliberately spans "now" (whenever this test runs) so findActiveTournament
                  // picks this one as the currently-active tournament and getSupplementalCompletedEvents
                  // actually fetches /getCompletedEvents for it below.
                  { id: "t-new-2024", startDate: "2024-06-01T00:00:00Z", endDate: "2030-01-01T00:00:00Z" },
                ],
              },
            ],
          },
        }),
      };
    }
    if (u.includes("/getCompletedEvents")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            schedule: {
              events: [matchEvent("comp-old", "2022-05-01T00:00:00Z"), matchEvent("comp-new", "2023-05-01T00:00:00Z")],
            },
          },
        }),
      };
    }
    if (u.includes("/getSchedule")) {
      scheduleCallCount++;
      const params = new URL(u).searchParams;
      const pageToken = params.get("pageToken");
      if (!pageToken) {
        // base page: mix of pre-cutoff and post-cutoff events, with an older token available
        return {
          ok: true,
          json: async () => ({
            data: {
              schedule: {
                events: [matchEvent("base-old", "2022-01-01T00:00:00Z"), matchEvent("base-new", "2023-06-01T00:00:00Z")],
                pages: { older: "older-page-1", newer: null },
              },
            },
          }),
        };
      }
      olderPageTokensRequested.push(pageToken);
      if (pageToken === "older-page-1") {
        // still straddles the cutoff - some events after, some before - should NOT stop pagination
        return {
          ok: true,
          json: async () => ({
            data: {
              schedule: {
                events: [matchEvent("older1-a", "2022-06-01T00:00:00Z"), matchEvent("older1-b", "2023-02-01T00:00:00Z")],
                pages: { older: "older-page-2", newer: null },
              },
            },
          }),
        };
      }
      if (pageToken === "older-page-2") {
        // entirely before cutoff - pagination should stop here and never request older-page-3
        return {
          ok: true,
          json: async () => ({
            data: {
              schedule: {
                events: [matchEvent("older2-a", "2020-01-01T00:00:00Z"), matchEvent("older2-b", "2019-01-01T00:00:00Z")],
                pages: { older: "older-page-3", newer: null },
              },
            },
          }),
        };
      }
      if (pageToken === "older-page-3") {
        // should never be reached
        return {
          ok: true,
          json: async () => ({
            data: { schedule: { events: [matchEvent("older3-a", "2018-01-01T00:00:00Z")], pages: { older: null, newer: null } } },
          }),
        };
      }
      return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getEventDetails")) {
      const idParam = new URL(u).searchParams.get("id");
      if (idParam === "direct-old-match") {
        return {
          ok: true,
          json: async () => ({
            data: {
              event: {
                id: "direct-old-match",
                state: "completed",
                startTime: "2021-08-15T00:00:00Z",
                streams: [],
                match: { strategy: { count: 1 }, teams: [] },
              },
            },
          }),
        };
      }
      if (idParam === "direct-new-unresolved-match") {
        return {
          ok: true,
          json: async () => ({
            data: {
              event: {
                id: "direct-new-unresolved-match",
                state: "inProgress",
                startTime: "2024-03-01T00:00:00Z",
                streams: [],
                match: { strategy: { count: 1 }, teams: [] },
              },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ data: { event: null } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  // ============ isOnOrAfterCutoff direct checks ============
  check("2022-12-31 is before the cutoff", window.isOnOrAfterCutoff("2022-12-31T23:59:59Z") === false);
  check("2023-01-01T00:00:00Z is exactly on the cutoff (kept)", window.isOnOrAfterCutoff("2023-01-01T00:00:00Z") === true);
  check("2023-06-01 is after the cutoff (kept)", window.isOnOrAfterCutoff("2023-06-01T00:00:00Z") === true);
  check("2019-01-01 is well before the cutoff", window.isOnOrAfterCutoff("2019-01-01T00:00:00Z") === false);
  check("A missing/undefined date is kept rather than dropped", window.isOnOrAfterCutoff(undefined) === true);

  // ============ getSchedule filters both scheduleCache and the returned events ============
  const returned = await window.getSchedule(["L1"]);
  const returnedIds = returned.map((e) => e.id);
  check("getSchedule's return value excludes the pre-cutoff base-page event", !returnedIds.includes("base-old"));
  check("getSchedule's return value includes the post-cutoff base-page event", returnedIds.includes("base-new"));
  check("getSchedule's return value excludes pre-cutoff older-page events", !returnedIds.includes("older1-a") && !returnedIds.includes("older2-a") && !returnedIds.includes("older2-b"));
  check("getSchedule's return value includes the post-cutoff older-page event", returnedIds.includes("older1-b"));
  // Supplemental completed events (from /getCompletedEvents) are also cutoff-filtered
  check("getSchedule's return value excludes the pre-cutoff supplemental completed event", !returnedIds.includes("comp-old"));
  check("getSchedule's return value includes the post-cutoff supplemental completed event", returnedIds.includes("comp-new"));

  // ============ Pagination stops once a whole older-page is before the cutoff ============
  check("older-page-1 (straddles the cutoff) was requested", olderPageTokensRequested.includes("older-page-1"));
  check("older-page-2 (entirely before the cutoff) was requested", olderPageTokensRequested.includes("older-page-2"));
  check("older-page-3 was never requested - pagination stopped once older-page-2 came back entirely pre-cutoff", !olderPageTokensRequested.includes("older-page-3"));

  // ============ getTournamentsForLeague filters tournaments by startDate ============
  const tournaments = await window.getTournamentsForLeague("L1");
  const tIds = tournaments.map((t) => t.id);
  check("Tournaments starting before 2023 are excluded (2019)", !tIds.includes("t-old-2019"));
  check("Tournaments starting before 2023 are excluded (2022)", !tIds.includes("t-old-2022"));
  check("Tournaments starting in/after 2023 are included (2023)", tIds.includes("t-new-2023"));
  check("Tournaments starting in/after 2023 are included (2024)", tIds.includes("t-new-2024"));
  check("Exactly the two post-cutoff tournaments survive, nothing extra", tournaments.length === 2);

  // ============ Direct-link match page: a pre-cutoff match id is rejected, not half-rendered ============
  // getEventDetails now carries startTime through, so renderMatchPage can peek at it for an id that
  // scheduleCache/getLive/getSchedule (all cutoff-filtered) couldn't resolve.
  const eventDetailsWithStartTime = await window.getEventDetails("direct-old-match");
  check("getEventDetails now includes startTime on its returned object", eventDetailsWithStartTime.startTime === "2021-08-15T00:00:00Z");

  await window.renderMatchPage("direct-old-match");
  const matchMainEl = window.document.getElementById("match-main");
  check(
    "Direct-linking to a pre-2023 match id shows a clear 'not available' message instead of a broken/blank match page",
    /before 2023/.test(matchMainEl.innerHTML) && /isn't available/.test(matchMainEl.innerHTML)
  );
  check(
    "The rejected old-match page does not attempt to render match-page sections (no prediction/h2h slots)",
    !matchMainEl.innerHTML.includes("prediction-slot") && !matchMainEl.innerHTML.includes("h2h-slot")
  );

  await window.renderMatchPage("direct-new-unresolved-match");
  check(
    "A post-2023 match id not yet in scheduleCache (e.g. a brand-new/unresolved match) is NOT rejected - it still renders normally",
    !/before 2023/.test(matchMainEl.innerHTML)
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
