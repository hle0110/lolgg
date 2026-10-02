const fs = require("fs");
const { JSDOM } = require("jsdom");

const LCK = { id: "98767991310872058", slug: "lck", name: "LCK", image: "", priority: 1 };
const tm = (c) => ({ id: c, slug: c.toLowerCase(), name: c, code: c, image: "", result: { gameWins: 0, outcome: null } });

async function ongoingTabShows({ minutesUntilStart, liveEndpointHasIt, detailHasStartTime }) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  const start = new Date(Date.now() + minutesUntilStart * 60000).toISOString();
  const ev = {
    type: "match",
    id: "m-t1-hle",
    startTime: start,
    state: "unstarted",
    blockName: "Playoffs",
    league: LCK,
    match: { id: "m-t1-hle", strategy: { count: 5 }, teams: [tm("T1"), tm("HLE")] },
  };
  const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [LCK] } });
    if (s.includes("/getLive")) return J({ data: { schedule: { events: liveEndpointHasIt ? [ev] : [] } } });
    if (s.includes("/getSchedule")) return J({ data: { schedule: { events: [ev], pages: { older: null, newer: null } } } });
    if (s.includes("/getEventDetails"))
      return J({
        data: {
          event: {
            id: "m-t1-hle",
            state: "unstarted",
            ...(detailHasStartTime ? { startTime: start } : {}),
            streams: [],
            match: { strategy: { count: 5 }, teams: ev.match.teams, games: [] },
          },
        },
      });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 500));
  const tc = w.document.getElementById("tab-content").innerHTML;
  return /live-grid/.test(tc) && /T1/.test(tc) && !/No matches are live right now/.test(tc);
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check(
    "eventIsGenuinelyLive falls back to the schedule's startTime, since Riot's getEventDetails does not return one",
    /const knownStart = detail\.startTime \|\| \(event && event\.startTime\) \|\| null;/.test(app)
  );

  check(
    "A match 9 minutes from kickoff appears in Ongoing even though getEventDetails omits startTime (the real Riot behaviour)",
    await ongoingTabShows({ minutesUntilStart: 9, liveEndpointHasIt: false, detailHasStartTime: false })
  );
  check(
    "Same match still appears when getEventDetails does include startTime",
    await ongoingTabShows({ minutesUntilStart: 9, liveEndpointHasIt: false, detailHasStartTime: true })
  );
  check(
    "A match Riot's own live endpoint reports is live still appears",
    await ongoingTabShows({ minutesUntilStart: 9, liveEndpointHasIt: true, detailHasStartTime: false })
  );
  check(
    "A match 30 minutes out is NOT shown as live (the 15 minute window is not over-eager)",
    (await ongoingTabShows({ minutesUntilStart: 30, liveEndpointHasIt: false, detailHasStartTime: false })) === false
  );
  check(
    "A match that started 5 minutes ago is shown as live",
    await ongoingTabShows({ minutesUntilStart: -5, liveEndpointHasIt: false, detailHasStartTime: false })
  );
  check(
    "A match that started 6 hours ago is no longer shown as live",
    (await ongoingTabShows({ minutesUntilStart: -360, liveEndpointHasIt: false, detailHasStartTime: false })) === false
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
