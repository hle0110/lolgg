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

function matchEvent(id, isoDate) {
  return {
    type: "match",
    startTime: isoDate,
    state: "completed",
    blockName: "Week 1",
    league: { id: "L1", name: "Test League", slug: "test-league", image: "" },
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

const DELAY_MS = 60;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getSchedule")) {
      const params = new URL(u).searchParams;
      const pageToken = params.get("pageToken");
      await delay(DELAY_MS); // simulate real network latency on every page fetch
      if (!pageToken) {
        return {
          ok: true,
          json: async () => ({
            data: {
              schedule: {
                events: [matchEvent("base", "2024-01-01T00:00:00Z")],
                pages: { older: "older-1", newer: "newer-1" },
              },
            },
          }),
        };
      }
      if (pageToken === "newer-1") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [matchEvent("newer1", "2024-02-01T00:00:00Z")], pages: { older: null, newer: "newer-2" } } } }) };
      }
      if (pageToken === "newer-2") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [matchEvent("newer2", "2024-03-01T00:00:00Z")], pages: { older: null, newer: null } } } }) };
      }
      if (pageToken === "older-1") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [matchEvent("older1", "2023-11-01T00:00:00Z")], pages: { older: "older-2", newer: null } } } }) };
      }
      if (pageToken === "older-2") {
        return { ok: true, json: async () => ({ data: { schedule: { events: [matchEvent("older2", "2023-10-01T00:00:00Z")], pages: { older: null, newer: null } } } }) };
      }
      return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  // ============ fetchScheduleFreshForLeague: newer/older chains run concurrently ============
  // 5 total page fetches (base, newer-1, newer-2, older-1, older-2) at DELAY_MS each. Run
  // sequentially that's 5*DELAY_MS; run with newer/older concurrent (longest chain: base + 2 newer =
  // 3 sequential steps on that side) it should be roughly 3*DELAY_MS, well under 5*DELAY_MS.
  const t0 = Date.now();
  const events = await window.fetchScheduleFreshForLeague("L1");
  const elapsed = Date.now() - t0;
  const ids = events.map((e) => e.id);
  check("Both the newer-page chain and older-page chain are still fully walked and merged", ["base", "newer1", "newer2", "older1", "older2"].every((id) => ids.includes(id)));
  check(
    `Newer/older pagination runs concurrently, not sequentially (took ${elapsed}ms for a chain that would take ~${5 * DELAY_MS}ms sequentially vs ~${3 * DELAY_MS}ms concurrently)`,
    elapsed < 4.5 * DELAY_MS
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
