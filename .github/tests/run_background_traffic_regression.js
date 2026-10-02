const fs = require("fs");
const { JSDOM } = require("jsdom");

const LG = ["lck", "lpl", "lec", "lcs", "lcp", "msi", "worlds"].map((s, i) => ({
  id: "L" + i,
  slug: s,
  name: s.toUpperCase(),
  image: "",
  priority: i + 1,
}));
const T = (c) => ({ id: c, slug: c, name: c, code: c, image: "", result: { gameWins: 0, outcome: null } });

function boot() {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  const t0 = Date.now();
  const log = [];
  const J = async (d, tag) => {
    log.push({ t: Date.now() - t0, tag });
    return { ok: true, status: 200, json: async () => d, text: async () => "" };
  };
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return J({ data: { leagues: LG } }, "getLeagues");
    if (s.includes("/getLive")) return J({ data: { schedule: { events: [] } } }, "getLive");
    if (s.includes("/getSchedule"))
      return J(
        {
          data: {
            schedule: {
              events: [
                {
                  type: "match",
                  id: "m1",
                  startTime: new Date("2026-09-25T09:00:00Z").toISOString(),
                  state: "unstarted",
                  blockName: "Finals",
                  league: LG[0],
                  match: { id: "m1", strategy: { count: 5 }, teams: [T("AA"), T("BB")] },
                },
              ],
              pages: { older: null, newer: null },
            },
          },
        },
        "getSchedule"
      );
    if (s.includes("/getTournamentsForLeague"))
      return J({ data: { leagues: [{ tournaments: [{ id: "t1", slug: "s", startDate: "2026-07-01", endDate: "2026-10-01" }] }] } }, "getTournaments");
    if (s.includes("/getCompletedEvents")) return J({ data: { schedule: { events: [] } } }, "getCompleted");
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} }, "other");
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  return { w, log };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check("The schedule cache TTL is a named constant, not inline", /const SCHEDULE_CACHE_MS = /.test(app));
  const ttl = (app.match(/const SCHEDULE_CACHE_MS = (\d+) \* 1000/) || [])[1];
  check("Schedule cache TTL is longer than the 20s background poll, so the poll can reuse it", Number(ttl) > 20);
  check("getSchedule uses the named TTL", /cached\(key, SCHEDULE_CACHE_MS,/.test(app));
  check("The live endpoint keeps its short 15s cache (live scores stay fresh)", /cached\("live", 15 \* 1000/.test(app));
  check("Match details keep their short 15s cache", /cached\(`event:\$\{id\}`, 15 \* 1000/.test(app));

  const { log } = boot();
  await new Promise((r) => setTimeout(r, 46000));

  const after = log.filter((e) => e.t > 12000);
  const scheduleAfter = after.filter((e) => e.tag === "getSchedule").length;
  const liveAfter = after.filter((e) => e.tag === "getLive").length;

  check(
    `The full schedule is NOT refetched on every 20s poll (saw ${scheduleAfter} schedule calls in ~34s of steady state)`,
    scheduleAfter === 0
  );
  check(`Live data is still polled regularly (saw ${liveAfter} getLive calls)`, liveAfter >= 1);
  check(
    "Total steady-state requests stay low",
    after.length <= 8
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
