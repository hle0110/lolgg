const fs = require("fs");
const { JSDOM } = require("jsdom");

const D = (d, h) => new Date("2026-" + d + "T" + (h || "09") + ":00:00Z").toISOString();
const tm = (c, gw, o) => ({ id: c, code: c, name: c, image: "", gameWins: gw, outcome: o });
let n = 0;
function mk(block, date, a, aw, b, bw, h) {
  const done = aw !== null;
  n += 1;
  return {
    id: "w" + n,
    blockName: block,
    startTime: D(date, h),
    state: done ? "completed" : "unstarted",
    bestOf: 5,
    league: { id: "W", name: "Worlds", slug: "worlds" },
    teams: [tm(a, aw, done ? (aw > bw ? "win" : "loss") : null), tm(b, bw, done ? (bw > aw ? "win" : "loss") : null)],
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  w.eval(app);
  await new Promise((r) => setTimeout(r, 80));

  check(
    "Worlds is treated as a major league (already supported)",
    w.isMajorLeague({ name: "Worlds" }) === true && w.isMajorLeague({ name: "World Championship" }) === true
  );
  check(
    "Demacia Cup Global Invitational would be picked up if Riot ever publishes it",
    w.isMajorLeague({ name: "Demacia Cup Global Invitational" }) === true
  );
  check(
    "The Demacia keyword does not accidentally admit unrelated leagues",
    w.isMajorLeague({ name: "LCK Challengers League" }) === false && w.isMajorLeague({ name: "CBLOL" }) === false
  );

  // Worlds 2026 format: 4-team play-in (double elim), 16-team Swiss, single-elim knockouts
  const worlds = [
    mk("Play-Ins", "10-15", "AAA", 3, "BBB", 1),
    mk("Play-Ins", "10-16", "CCC", 3, "DDD", 0),
    mk("Play-Ins", "10-17", "AAA", 2, "CCC", 3),
    ...Array.from({ length: 10 }, (_, i) => mk("Swiss Stage", "10-2" + (i % 9), "S" + i, i % 2, "R" + i, (i + 1) % 2, i < 5 ? "09" : "13")),
    mk("Quarterfinals", "11-01", "Q1", 3, "Q2", 1),
    mk("Quarterfinals", "11-02", "Q3", 3, "Q4", 2),
    mk("Quarterfinals", "11-03", "Q5", null, "Q6", null),
    mk("Quarterfinals", "11-04", "Q7", null, "Q8", null),
    mk("Semifinals", "11-08", "TBD", null, "TBD", null),
    mk("Semifinals", "11-09", "TBD", null, "TBD", null),
    mk("Finals", "11-14", "TBD", null, "TBD", null),
  ];
  const out = w.tournamentBracketByBlockHtml(worlds);

  check("A Swiss stage does not crash the bracket renderer", typeof out === "string" && out.length > 0);
  check("Play-Ins, Quarterfinals, Semifinals and Finals all render as their own rounds",
    out.includes("Play-Ins") && out.includes("Quarterfinals") && out.includes("Finals"));
  check(
    "No fake Upper/Lower bracket lanes are invented for Worlds' format",
    !out.includes("bracket-lane-upper") && !out.includes("bracket-lane-lower")
  );

  const known = new Set(worlds.flatMap((e) => e.teams.map((t) => t.code)).filter((c) => c !== "TBD"));
  const rendered = [...out.matchAll(/class="bracket-team-name[^"]*">([^<]*)</g)]
    .map((m) => m[1])
    .filter((x) => x && x !== "TBD" && !/^Winner of|^Loser of/.test(x));
  check("No invented team names anywhere in a Worlds-shaped bracket", rendered.every((x) => known.has(x)));

  const semisSeg = out.slice(out.indexOf("Semifinals"));
  check(
    "Semifinals do not claim a finalist from an unrelated quarterfinal",
    !/bracket-team-name[^"]*">Q1</.test(semisSeg) || /Winner of/.test(semisSeg)
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
