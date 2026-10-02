const fs = require("fs");
const { JSDOM } = require("jsdom");

const LPL = { id: "98767991314006698", slug: "lpl", name: "LPL", image: "", priority: 2 };
const T = (c, gw, o) => ({ id: c, slug: c.toLowerCase(), name: c, code: c, image: "", result: { gameWins: gw, outcome: o } });
let n = 0;
function mk(block, date, a, aw, b, bw) {
  const done = aw !== null;
  n += 1;
  return {
    type: "match",
    id: "q" + n,
    startTime: new Date("2026-" + date + "T09:00:00Z").toISOString(),
    state: done ? "completed" : "unstarted",
    blockName: block,
    league: LPL,
    match: {
      id: "q" + n,
      strategy: { count: 5 },
      teams: [T(a, aw, done ? (aw > bw ? "win" : "loss") : null), T(b, bw, done ? (bw > aw ? "win" : "loss") : null)],
    },
  };
}

async function bracketBlocks(events, tournament) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [LPL] } });
    if (s.includes("/getSchedule")) return J({ data: { schedule: { events, pages: { older: null, newer: null } } } });
    if (s.includes("/getLive")) return J({ data: { schedule: { events: [] } } });
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 200));
  const evs = await w.getAllTournamentBracketEvents(LPL.id, tournament, LPL, [], { stages: [] }, new Map());
  return evs.map((e) => `${e.blockName}:${e.teams.map((t) => t.code).join("v")}`);
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check("A shared tournament-window helper exists", /function eventInTournamentWindow\(e, range\)/.test(app));
  check("Both the bracket and recent-games paths use it", (app.match(/eventInTournamentWindow\(e, range\)/g) || []).length >= 3);

  const base = [
    mk("Playoffs", "09-12", "IG", 2, "AL", 3),
    mk("Finals", "09-13", "AL", 3, "BLG", 1),
    mk("Regional Qualifier", "09-18", "WE", null, "JDG", null),
  ];
  const endsAtFinals = { id: "t1", startDate: "2026-08-28", endDate: "2026-09-13" };

  const blocks = await bracketBlocks(base, endsAtFinals);
  check(
    "LPL Regional Qualifier appears in the bracket even though it is played after the tournament's end date",
    blocks.includes("Regional Qualifier:WEvJDG")
  );
  check("The playoffs and finals are still there", blocks.includes("Finals:ALvBLG") && blocks.some((b) => b.startsWith("Playoffs:")));

  const farFuture = [...base, mk("Regional Qualifier", "12-20", "AAA", null, "BBB", null)];
  const farBlocks = await bracketBlocks(farFuture, endsAtFinals);
  check(
    "A qualifier far beyond the trailing window is NOT pulled in (cannot leak a later split)",
    !farBlocks.includes("Regional Qualifier:AAAvBBB")
  );

  const nextSplit = [...base, mk("Playoffs", "11-15", "CCC", null, "DDD", null), mk("Week 1", "10-10", "EEE", null, "FFF", null)];
  const nextBlocks = await bracketBlocks(nextSplit, endsAtFinals);
  check(
    "A later split's Playoffs after the end date is NOT pulled in",
    !nextBlocks.some((b) => b.includes("CCCvDDD"))
  );
  check("A later split's regular season week is NOT pulled in", !nextBlocks.some((b) => b.includes("EEEvFFF")));

  const qualifierFinal = [...base, mk("Finals", "09-25", "III", null, "JJJ", null)];
  const qfBlocks = await bracketBlocks(qualifierFinal, endsAtFinals);
  check(
    "A qualifier's own final is kept even though Riot labels it 'Finals' and it falls after the tournament end date",
    qfBlocks.includes("Finals:IIIvJJJ")
  );

  const before = [...base, mk("Regional Qualifier", "07-01", "GGG", null, "HHH", null)];
  const beforeBlocks = await bracketBlocks(before, endsAtFinals);
  check(
    "A qualifier before the tournament even started is NOT pulled in",
    !beforeBlocks.some((b) => b.includes("GGGvHHH"))
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
