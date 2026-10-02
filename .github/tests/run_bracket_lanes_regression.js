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

let n = 0;
function ev(blockName, aCode, aWins, bCode, bWins, minutesAgo) {
  n += 1;
  const decided = aWins !== null;
  return {
    id: `bev${n}`,
    blockName,
    startTime: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    state: decided ? "completed" : "unstarted",
    bestOf: 5,
    league: { id: "L1", name: "LCK", slug: "lck" },
    teams: [
      { id: aCode, code: aCode, name: aCode, image: "", gameWins: aWins, outcome: decided ? (aWins > bWins ? "win" : "loss") : null },
      { id: bCode, code: bCode, name: bCode, image: "", gameWins: bWins, outcome: decided ? (bWins > aWins ? "win" : "loss") : null },
    ],
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  const dom = makeDom();
  const { window } = dom;
  window.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (s.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    if (s.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(app);
  await new Promise((r) => setTimeout(r, 20));

  const lane = window.bracketLane;
  check("bracketLane classifies 'Upper Bracket Round 1' as upper", lane("Upper Bracket Round 1") === "upper");
  check("bracketLane classifies 'Upper Bracket Final' as upper, not final", lane("Upper Bracket Final") === "upper");
  check("bracketLane classifies 'Lower Bracket Final' as lower, not final", lane("Lower Bracket Final") === "lower");
  check("bracketLane handles LEC-style \"Losers' Bracket\" naming", lane("Losers' Bracket Round 2") === "lower");
  check("bracketLane handles \"Winners' Bracket\" naming", lane("Winners' Bracket Round 1") === "upper");
  check("bracketLane classifies 'Play-In' as playin", lane("Play-In Round 1") === "playin");
  check("bracketLane classifies 'Grand Final' as final", lane("Grand Final") === "final");
  check("bracketLane leaves single-elim rounds unclassified", lane("Quarterfinals") === "main" && lane("Semifinals") === "main");

  const lckEvents = [
    ev("Play-In Round 1", "KT", 3, "BRO", 2, 900),
    ev("Play-In Round 2", "NS", 1, "FOX", 3, 880),
    ev("Upper Bracket Round 1", "DK", 0, "KT", 3, 800),
    ev("Upper Bracket Round 1", "T1", 3, "FOX", 2, 790),
    ev("Upper Bracket Round 2", "GEN", 3, "KT", 0, 700),
    ev("Upper Bracket Round 2", "HLE", 3, "T1", 2, 690),
    ev("Upper Bracket Final", "GEN", null, "HLE", null, 600),
    ev("Lower Bracket Round 1", "DK", 3, "FOX", 2, 650),
    ev("Lower Bracket Round 2", "KT", 1, "DK", 3, 640),
    ev("Lower Bracket Final", "T1", null, "DK", null, 500),
    ev("Grand Final", "TBD", null, "TBD", null, 400),
  ];
  const html = window.tournamentBracketByBlockHtml(lckEvents);

  check("Renders the lane-based board for a double-elim bracket", html.includes("bracket-board"));
  check("Shows a Play-In lane section", html.includes("bracket-lane-playin") && html.includes(">Play-In<"));
  check("Shows an Upper Bracket lane section", html.includes("bracket-lane-upper") && html.includes(">Upper Bracket<"));
  check("Shows a Lower Bracket lane section", html.includes("bracket-lane-lower") && html.includes(">Lower Bracket<"));
  check("Shows a Finals lane section", html.includes("bracket-lane-final") && html.includes(">Finals<"));
  check("Explains the double-elimination rule so the bracket is understandable", html.includes("losing twice"));
  check("Explains what the Lower Bracket means", /one more loss/i.test(html));
  check("Upper Bracket Final is grouped under Upper, not Finals", html.indexOf("Upper Bracket Final") > html.indexOf("bracket-lane-upper"));
  check("Each round column keeps its own title", html.includes("Upper Bracket Round 1") && html.includes("Lower Bracket Round 2"));
  check("Round columns show how many matches they hold", html.includes("bracket-column-count"));
  check("Winners are marked so you can read the progression", html.includes("bracket-match-team won"));

  check(
    "Grand Final is fed by the Upper Bracket Final winner, not left as a bare TBD",
    html.includes("Winner of GEN vs HLE")
  );
  check(
    "Grand Final is fed by the Lower Bracket Final winner too",
    html.includes("Winner of T1 vs DK")
  );
  check("Grand Final no longer shows an unresolved TBD slot", !/bracket-team-name">TBD</.test(html));

  const laneOrder = ["bracket-lane-playin", "bracket-lane-upper", "bracket-lane-lower", "bracket-lane-final"];
  const positions = laneOrder.map((c) => html.indexOf(c));
  check("Lanes are ordered Play-In, Upper, Lower, Finals", positions.every((p, i) => i === 0 || p > positions[i - 1]));

  const singleElim = [
    ev("Quarterfinals", "GEN", 3, "KT", 1, 300),
    ev("Semifinals", "GEN", 3, "T1", 2, 200),
    ev("Finals", "GEN", null, "HLE", null, 100),
  ];
  const seHtml = window.tournamentBracketByBlockHtml(singleElim);
  check("A single-elimination bracket keeps the original flat layout (no invented lanes)", !seHtml.includes("bracket-board") && seHtml.includes("bracket-columns"));
  check("Single-elim still renders all its rounds", seHtml.includes("Quarterfinals") && seHtml.includes("Semifinals") && seHtml.includes("Finals"));

  check("Round names are HTML-escaped", window.tournamentBracketByBlockHtml([
    ev("Upper Bracket <script>", "A", 3, "B", 1, 50),
    ev("Lower Bracket Round 1", "C", 3, "D", 1, 40),
  ]).includes("&lt;script&gt;"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
