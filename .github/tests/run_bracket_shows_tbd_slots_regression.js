const fs = require("fs");
const { JSDOM } = require("jsdom");

const D = (d) => new Date("2026-" + d + "T20:00:00Z").toISOString();
const tm = (c, gw, o) => ({ id: c, code: c, name: c, image: "", gameWins: gw, outcome: o });
let n = 0;
function mk(block, date, a, aw, b, bw) {
  const done = aw !== null;
  n += 1;
  return {
    id: "m" + n,
    blockName: block,
    startTime: D(date),
    state: done ? "completed" : "unstarted",
    bestOf: 5,
    league: { id: "LCS", name: "LCS", slug: "lcs" },
    teams: [tm(a, aw, done ? (aw > bw ? "win" : "loss") : null), tm(b, bw, done ? (bw > aw ? "win" : "loss") : null)],
  };
}
const cardCount = (html) => html.split(/<a class="bracket-match/).length - 1;

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

  // Real LCS state (Sep 21): 5 played, plus TBD placeholders for future rounds
  const LCS = [
    mk("Playoffs", "09-12", "SR", 0, "C9", 3),
    mk("Playoffs", "09-13", "FLY", 3, "SEN", 0),
    mk("Playoffs", "09-18", "SR", 3, "SEN", 2),
    mk("Playoffs", "09-19", "LYON", 1, "C9", 3),
    mk("Playoffs", "09-20", "TLAW", 3, "FLY", 0),
    mk("Playoffs", "09-25", "TBD", null, "SR", null),
    mk("Playoffs", "09-26", "TBD", null, "TBD", null),
    mk("Playoffs", "09-27", "TLAW", null, "C9", null),
    mk("Playoffs", "10-03", "TBD", null, "TBD", null),
    mk("Finals", "10-04", "TBD", null, "TBD", null),
  ];
  const out = w.tournamentBracketByBlockHtml(LCS);

  check("Every scheduled match is rendered, including the all-TBD placeholder rounds", cardCount(out) === LCS.length);
  check("The played results are still correct", /SR/.test(out) && /TLAW/.test(out) && /C9/.test(out));
  check("A half-known match still shows its known team", /TLAW/.test(out) && /C9/.test(out));
  check("Empty slots render with the pending style, not as a team called TBD", /bracket-team-name bracket-team-name-pending">TBD</.test(out));

  const known = new Set(LCS.flatMap((e) => e.teams.map((t) => t.code)).filter((c) => c !== "TBD"));
  const rendered = [...out.matchAll(/class="bracket-team-name[^"]*">([^<]*)</g)]
    .map((m) => m[1])
    .filter((x) => x && x !== "TBD" && !/^Winner of|^Loser of/.test(x));
  check("No invented team names appear now that placeholders are shown", rendered.every((x) => known.has(x)));

  // A real bracket where the previous round feeds the next must still resolve winners
  let q = 0;
  const qmk = (block, date, a, aw, b, bw) => {
    q += 1;
    const done = aw !== null;
    return {
      id: "q" + q,
      blockName: block,
      startTime: D(date),
      state: done ? "completed" : "unstarted",
      bestOf: 5,
      league: { id: "Y", name: "Y", slug: "y" },
      teams: [tm(a, aw, done ? (aw > bw ? "win" : "loss") : null), tm(b, bw, done ? (bw > aw ? "win" : "loss") : null)],
    };
  };
  const proper = [
    qmk("Quarterfinals", "08-01", "A", 3, "B", 0),
    qmk("Quarterfinals", "08-02", "C", 3, "D", 0),
    qmk("Quarterfinals", "08-03", "E", 3, "F", 0),
    qmk("Quarterfinals", "08-04", "G", 3, "H", 0),
    qmk("Semifinals", "08-10", "TBD", null, "TBD", null),
    qmk("Semifinals", "08-11", "TBD", null, "TBD", null),
  ];
  const properOut = w.tournamentBracketByBlockHtml(proper);
  check("A proper bracket still renders every round", cardCount(properOut) === proper.length);
  check(
    "Semifinal slots still resolve to the actual quarterfinal winners",
    /">A</.test(properOut) && /">C</.test(properOut) && !/">B</.test(properOut.slice(properOut.indexOf("Semifinals")))
  );

  const singleRound = [mk("Finals", "11-01", "TBD", null, "TBD", null)];
  check(
    "A single unpublished round still yields no bracket, so the Liquipedia fallback shows instead of an empty column",
    w.tournamentBracketByBlockHtml(singleRound) === ""
  );

  const multiRoundBlank = [
    mk("Semifinals", "11-01", "TBD", null, "TBD", null),
    mk("Semifinals", "11-02", "TBD", null, "TBD", null),
    mk("Finals", "11-03", "TBD", null, "TBD", null),
  ];
  check(
    "A multi-round bracket that is still all placeholders now renders its shape",
    cardCount(w.tournamentBracketByBlockHtml(multiRoundBlank)) === 3
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
