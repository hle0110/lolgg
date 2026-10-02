const fs = require("fs");
const { JSDOM } = require("jsdom");

const D = (s, h) => new Date("2026-" + s + "T" + (h || "09") + ":00:00Z").toISOString();
const tm = (c, gw, o) => ({ id: c, code: c, name: c, image: "", gameWins: gw, outcome: o });
let n = 0;
function mk(lg, block, date, a, aw, b, bw, h) {
  const done = aw !== null;
  n += 1;
  return {
    id: lg + n,
    blockName: block,
    startTime: D(date, h),
    state: done ? "completed" : "unstarted",
    bestOf: 5,
    league: { id: lg, name: lg, slug: lg.toLowerCase() },
    teams: [tm(a, aw, done ? (aw > bw ? "win" : "loss") : null), tm(b, bw, done ? (bw > aw ? "win" : "loss") : null)],
  };
}

function slotsOf(html) {
  return html.split(/<a class="bracket-match/).slice(1).map((p) => ({
    unstarted: /unstarted/.test(p.slice(0, 40)),
    names: [...p.matchAll(/class="bracket-team-name[^"]*">([^<]*)</g)].map((m) => m[1]),
  }));
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 80));

  const LCK = [
    mk("LCK", "Play-Ins", "08-26", "BRO", 2, "KT", 3),
    mk("LCK", "Play-Ins", "08-27", "BFX", 3, "NS", 1),
    mk("LCK", "Play-Ins", "08-28", "BFX", 3, "BRO", 2),
    mk("LCK", "Playoffs", "08-29", "BFX", 2, "T1", 3),
    mk("LCK", "Playoffs", "08-30", "KT", 3, "DK", 0),
    mk("LCK", "Playoffs", "09-01", "GEN", 3, "KT", 0),
    mk("LCK", "Playoffs", "09-02", "T1", 2, "HLE", 3),
    mk("LCK", "Playoffs", "09-03", "BFX", 2, "DK", 3),
    mk("LCK", "Playoffs", "09-04", "KT", 1, "DK", 3),
    mk("LCK", "Playoffs", "09-05", "HLE", 1, "GEN", 3),
    mk("LCK", "Playoffs", "09-06", "DK", 1, "T1", 3),
    mk("LCK", "Playoffs", "09-12", "T1", null, "HLE", null),
    mk("LCK", "Finals", "09-13", "TBD", null, "GEN", null),
  ];
  const lckHtml = w.tournamentBracketByBlockHtml(LCK);
  const lckFinal = slotsOf(lckHtml).slice(-1)[0];
  check(
    "LCK Finals shows TBD against GEN, because the lower bracket final has not been played",
    lckFinal.names[0] === "TBD" && lckFinal.names[1] === "GEN"
  );
  check(
    "T1 is never shown as an LCK finalist before qualifying (they still have to beat HLE)",
    !/bracket-team-name[^"]*">T1</.test(lckHtml.slice(lckHtml.lastIndexOf(">Finals<")))
  );
  check(
    "The unplayed T1 vs HLE match still renders with both real teams",
    slotsOf(lckHtml).some((s) => s.unstarted && s.names[0] === "T1" && s.names[1] === "HLE")
  );

  const LPL = [
    mk("LPL", "Play In Knockouts", "08-28", "EDG", 0, "NIP", 3),
    mk("LPL", "Play In Knockouts", "08-28", "TT", 0, "IG", 3, "11"),
    mk("LPL", "Playoffs", "08-29", "TES", 2, "LGD", 3),
    mk("LPL", "Playoffs", "08-30", "JDG", 1, "WE", 3),
    mk("LPL", "Playoffs", "09-03", "WE", 1, "BLG", 3),
    mk("LPL", "Playoffs", "09-04", "LGD", 1, "AL", 3),
    mk("LPL", "Playoffs", "09-05", "IG", 3, "TES", 2),
    mk("LPL", "Playoffs", "09-05", "NIP", 3, "JDG", 0, "11"),
    mk("LPL", "Playoffs", "09-06", "WE", 1, "IG", 3),
    mk("LPL", "Playoffs", "09-06", "LGD", 3, "NIP", 2, "11"),
    mk("LPL", "Playoffs", "09-07", "BLG", 3, "AL", 0),
    mk("LPL", "Playoffs", "09-08", "LGD", 0, "IG", 3),
    mk("LPL", "Playoffs", "09-08", "IG", null, "AL", null, "11"),
    mk("LPL", "Finals", "09-13", "TBD", null, "BLG", null),
    mk("LPL", "Regional Qualifier", "09-17", "TBD", null, "TBD", null),
  ];
  const lplHtml = w.tournamentBracketByBlockHtml(LPL);
  const lplFinalSeg = lplHtml.slice(lplHtml.lastIndexOf(">Finals<"));
  const lplFinalNames = [...lplFinalSeg.matchAll(/class="bracket-team-name[^"]*">([^<]*)</g)].map((m) => m[1]).slice(0, 2);
  check("LPL Finals shows TBD against BLG", lplFinalNames[0] === "TBD" && lplFinalNames[1] === "BLG");
  check(
    "No eliminated or unqualified LPL team is shown in the final",
    !["IG", "AL", "LGD", "WE", "NIP", "TES", "JDG", "EDG"].some((c) => lplFinalNames.includes(c))
  );

  const properBracket = [
    mk("X", "Quarterfinals", "08-01", "A", 3, "B", 0),
    mk("X", "Quarterfinals", "08-02", "C", 3, "D", 0),
    mk("X", "Quarterfinals", "08-03", "E", 3, "F", 0),
    mk("X", "Quarterfinals", "08-04", "G", 3, "H", 0),
    mk("X", "Semifinals", "08-10", "TBD", null, "TBD", null),
    mk("X", "Semifinals", "08-11", "TBD", null, "TBD", null),
  ];
  const properHtml = w.tournamentBracketByBlockHtml(properBracket);
  check(
    "A real bracket where the previous round has exactly twice the matches still resolves feeders",
    /Winner of|>A<|>C<|>E<|>G</.test(properHtml)
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
