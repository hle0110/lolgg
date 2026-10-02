const fs = require("fs");
const { JSDOM } = require("jsdom");

const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const T = (c, gw, o) => ({ id: c, slug: c.toLowerCase(), name: c, code: c, image: "", result: { gameWins: gw, outcome: o } });
const LEAGUE = { id: "L", slug: "lck", name: "LCK" };

function schedEvent(id, a, aw, ao, b, bw, bo, minutesAgo, blockName) {
  return {
    type: "match",
    id,
    startTime: iso(minutesAgo),
    state: "completed",
    blockName,
    league: LEAGUE,
    match: { id, strategy: { count: 5 }, teams: [T(a, aw, ao), T(b, bw, bo)] },
  };
}

async function build(sched, standings) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [{ ...LEAGUE, image: "", priority: 1 }] } });
    if (s.includes("/getSchedule")) return J({ data: { schedule: { events: sched, pages: { older: null, newer: null } } } });
    if (s.includes("/getLive")) return J({ data: { schedule: { events: [] } } });
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 150));
  const lookup = new Map(
    ["BFX", "T1", "KT", "DK"].map((c) => [`id:${c}`, { id: c, code: c, name: c }])
  );
  const evs = await w.getAllTournamentBracketEvents(
    "L",
    { id: "t1", startDate: "2026-01-01", endDate: "2026-12-31" },
    LEAGUE,
    [],
    standings,
    lookup
  );
  const names = {};
  for (const e of evs) names[e.id] = e.blockName;
  return names;
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const sched = [
    schedEvent("p1", "BFX", 2, "loss", "T1", 3, "win", 2000, "Playoffs"),
    schedEvent("p2", "KT", 3, "win", "DK", 0, "loss", 1900, "Playoffs"),
    schedEvent("p3", "KT", 1, "loss", "DK", 3, "win", 1500, "Playoffs"),
  ];
  const section = (name, id, teams) => ({ name, matches: [{ id, state: "completed", teams }], rankings: [] });
  const standings = {
    stages: [
      {
        name: "Playoffs",
        type: "bracket",
        slug: "playoffs",
        sections: [
          section("Upper Bracket Round 1", "p1", [
            { id: "BFX", slug: "bfx", result: { gameWins: 2, outcome: "loss" } },
            { id: "T1", slug: "t1", result: { gameWins: 3, outcome: "win" } },
          ]),
          section("Lower Bracket Round 1", "p2", [
            { id: "KT", slug: "kt", result: { gameWins: 3, outcome: "win" } },
            { id: "DK", slug: "dk", result: { gameWins: 0, outcome: "loss" } },
          ]),
          section("Lower Bracket Final", "p3", [
            { id: "KT", slug: "kt", result: { gameWins: 1, outcome: "loss" } },
            { id: "DK", slug: "dk", result: { gameWins: 3, outcome: "win" } },
          ]),
        ],
      },
    ],
  };

  const names = await build(sched, standings);
  check("Riot's generic 'Playoffs' block is replaced by the real round from standings", names.p1 === "Upper Bracket Round 1");
  check("A second match in the same bracket gets its own round name", names.p2 === "Lower Bracket Round 1");
  check(
    "When the same team pair meets twice, each match still gets its correct round (matched by id, not by team pair)",
    names.p3 === "Lower Bracket Final"
  );
  check("No schedule match is dropped during enrichment", Object.keys(names).length === 3);

  const noStandings = await build(sched, { stages: [] });
  check(
    "With no standings data the schedule block names are left untouched",
    noStandings.p1 === "Playoffs" && noStandings.p2 === "Playoffs" && noStandings.p3 === "Playoffs"
  );

  const genericStandings = {
    stages: [
      {
        name: "Playoffs",
        type: "bracket",
        slug: "playoffs",
        sections: [
          section("Playoffs", "p1", [
            { id: "BFX", slug: "bfx", result: { gameWins: 2, outcome: "loss" } },
            { id: "T1", slug: "t1", result: { gameWins: 3, outcome: "win" } },
          ]),
        ],
      },
    ],
  };
  const generic = await build(sched, genericStandings);
  check(
    "A standings section that is just 'Playoffs' does not overwrite anything (no harm done)",
    generic.p1 === "Playoffs" && Object.keys(generic).length === 3
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
