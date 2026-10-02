const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  return new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
}

let n = 0;
function ev(blockName, a, aw, b, bw, minutesAgo) {
  n += 1;
  const decided = aw !== null;
  return {
    id: `rb${n}`,
    blockName,
    startTime: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    state: decided ? "completed" : "unstarted",
    bestOf: 5,
    league: { id: "L1", name: "LCK", slug: "lck" },
    teams: [
      { id: a, code: a, name: a, image: "", gameWins: aw, outcome: decided ? (aw > bw ? "win" : "loss") : null },
      { id: b, code: b, name: b, image: "", gameWins: bw, outcome: decided ? (bw > aw ? "win" : "loss") : null },
    ],
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  const dom = makeDom();
  const { window } = dom;
  window.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  window.eval(app);
  await new Promise((r) => setTimeout(r, 60));

  const lane = window.bracketLane;

  check("Riot's real LCK block name 'Play-Ins' maps to the play-in lane", lane("Play-Ins") === "playin");
  check("Riot's real LPL block name 'Play In Knockouts' maps to the play-in lane", lane("Play In Knockouts") === "playin");
  check("Riot's real block name 'Playoffs' stays unclassified", lane("Playoffs") === "main");
  check("Riot's real block name 'Finals' maps to the finals lane", lane("Finals") === "final");
  check("MSI's real block name 'Knockouts' stays unclassified", lane("Knockouts") === "main");
  check(
    "LPL's 'Regional Qualifier' is NOT treated as a play-in (it is played after the final)",
    lane("Regional Qualifier") === "qualifier"
  );
  const orderSrc = (app.match(/const BRACKET_LANE_ORDER = \[([^\]]+)\]/) || [])[1] || "";
  check(
    "The qualifier lane is ordered after the finals, matching when it is actually played",
    orderSrc.indexOf("qualifier") > orderSrc.indexOf("final")
  );

  check("isUsefulRoundName rejects the generic 'Playoffs' bucket", window.isUsefulRoundName("Playoffs") === false);
  check("isUsefulRoundName rejects the generic 'Bracket' fallback", window.isUsefulRoundName("Bracket") === false);
  check("isUsefulRoundName rejects regular season week names", window.isUsefulRoundName("Week 5") === false);
  check("isUsefulRoundName accepts a real round name", window.isUsefulRoundName("Upper Bracket Round 1") === true);
  check("isUsefulRoundName accepts 'Losers' Bracket'", window.isUsefulRoundName("Losers' Bracket") === true);

  const lckShape = [
    ev("Play-Ins", "BRO", 2, "KT", 3, 2400),
    ev("Play-Ins", "BFX", 3, "NS", 1, 2300),
    ev("Playoffs", "BFX", 2, "T1", 3, 2000),
    ev("Playoffs", "KT", 3, "DK", 0, 1900),
    ev("Playoffs", "GEN", 3, "KT", 0, 1800),
    ev("Playoffs", "T1", 2, "HLE", 3, 1700),
    ev("Finals", "TBD", null, "GEN", null, 100),
  ];
  const flat = window.tournamentBracketByBlockHtml(lckShape);
  check(
    "With only Riot's generic names, no fake Upper/Lower lanes are invented",
    !flat.includes("bracket-lane-upper") && !flat.includes("bracket-lane-lower")
  );
  check("The generic-name bracket still renders its columns", flat.includes("bracket-columns") && flat.includes("Play-Ins"));

  const enriched = [
    ev("Play-Ins", "BRO", 2, "KT", 3, 2400),
    ev("Upper Bracket Round 1", "BFX", 2, "T1", 3, 2000),
    ev("Upper Bracket Final", "GEN", 3, "HLE", 1, 1700),
    ev("Losers' Bracket Round 1", "KT", 3, "DK", 0, 1900),
    ev("Losers' Bracket Final", "T1", null, "HLE", null, 200),
    ev("Finals", "TBD", null, "GEN", null, 100),
  ];
  const laneHtml = window.tournamentBracketByBlockHtml(enriched);
  check("Once real round names arrive, the Upper Bracket lane renders", laneHtml.includes("bracket-lane-upper"));
  check("Once real round names arrive, the Lower Bracket lane renders", laneHtml.includes("bracket-lane-lower"));
  check("Play-In lane still renders alongside them", laneHtml.includes("bracket-lane-playin"));

  const impliedUpper = [
    ev("Round 1", "A", 3, "B", 1, 900),
    ev("Round 2", "C", 3, "D", 1, 800),
    ev("Losers' Bracket", "E", 3, "F", 1, 700),
    ev("Finals", "G", null, "H", null, 100),
  ];
  const impliedHtml = window.tournamentBracketByBlockHtml(impliedUpper);
  check(
    "Leaguepedia-style 'Round 1/Round 2 + Losers Bracket' labels the unclassified rounds as Upper Bracket",
    impliedHtml.includes("bracket-lane-upper") && impliedHtml.includes(">Upper Bracket<")
  );
  check("No leftover generic 'Bracket' lane title when upper is implied", !impliedHtml.includes(">Bracket<"));

  const withQualifier = [
    ev("Upper Bracket Round 1", "A", 3, "B", 1, 900),
    ev("Lower Bracket Round 1", "C", 3, "D", 1, 800),
    ev("Finals", "E", 3, "F", 1, 300),
    ev("Regional Qualifier", "G", null, "H", null, 100),
  ];
  const qHtml = window.tournamentBracketByBlockHtml(withQualifier);
  check("Regional Qualifier gets its own lane", qHtml.includes("bracket-lane-qualifier"));
  check(
    "Regional Qualifier is rendered after the Finals lane",
    qHtml.indexOf("bracket-lane-qualifier") > qHtml.indexOf("bracket-lane-final")
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
