const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only" });
const { window } = dom;
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const day = 86400000;
const ev = (id, daysAgo, league, a, aOut, b, bOut) => ({
  type: "match", id, startTime: new Date(Date.now() - daysAgo * day).toISOString(), state: "completed", blockName: "", league,
  match: { id, strategy: { count: 1 }, teams: [
    { id: a, name: a, code: a, result: { gameWins: aOut === "win" ? 1 : 0, outcome: aOut } },
    { id: b, name: b, code: b, result: { gameWins: bOut === "win" ? 1 : 0, outcome: bOut } },
  ] },
});
const LCK = { id: "lck", name: "LCK", slug: "lck", image: "" };
const LCS = { id: "lcs", name: "LCS", slug: "lcs", image: "" };
const events = [
  ev("a1", 5, LCK, "GEN", "win", "T1", "loss"),
  ev("a2", 4, LCK, "T1", "win", "GEN", "loss"),
  ev("b1", 5, LCS, "C9", "win", "TL", "loss"),
  ev("b2", 4, LCS, "C9", "win", "FLY", "loss"),
];
window.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [LCK, LCS] } }) };
  if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events, pages: {} } } }) };
  return { ok: true, json: async () => ({ data: {} }) };
};
window.Notification = undefined;

(async () => {
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 200));

  check("shortTeamLabel escapes a hostile team code", window.shortTeamLabel({ code: "<b>" }) === "&lt;b&gt;");
  check("shortTeamLabel still returns plain codes untouched", window.shortTeamLabel({ code: "GEN" }) === "GEN");
  const bracketHtml = window.tournamentBracketByBlockHtml([
    { id: "x1", blockName: "Semifinals", startTime: "2026-01-01T00:00:00Z", state: "completed", teams: [{ code: "<i>", name: "x", outcome: "win", gameWins: 3 }, { code: "B", name: "B", outcome: "loss", gameWins: 0 }] },
    { id: "x2", blockName: "Finals", startTime: "2026-01-02T00:00:00Z", state: "unstarted", teams: [{ code: "TBD", name: "TBD" }, { code: "TBD", name: "TBD" }] },
  ]);
  check("Bracket never renders a raw tag from a team code", !bracketHtml.includes("<i>") && bracketHtml.includes("&lt;i&gt;"));
  const pred = window.predictionHtml([{ code: "<s>", name: "x" }, { code: "GEN", name: "Gen.G" }], null);
  check("Prediction escapes team codes", !pred.includes("<s>"));

  check("Same-league teams still get a percentage", window.computePredictionPct([{ code: "GEN" }, { code: "T1" }], null) !== null);
  check("Cross-league teams still get an estimate from their records (international events are all cross-league)", window.computePredictionPct([{ code: "C9" }, { code: "GEN" }], null) !== null);
  const cross = window.predictionHtml([{ code: "C9" }, { code: "GEN" }], null);
  check("Cross-league estimate shows both records and says it is a rough guide", cross.includes("different leagues") && cross.includes("rough guide") && cross.includes("C9 2W-0L") && cross.includes("GEN 1W-1L"));
  check("Same-league estimate carries no cross-league note", !window.predictionHtml([{ code: "GEN" }, { code: "T1" }], null).includes("different leagues"));
  check("No history for either team still gives no made-up percentage", window.computePredictionPct([{ code: "AAA" }, { code: "BBB" }], null) === null);
  check("Prediction is no longer labelled AI", !/AI Prediction/.test(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8")) && pred.includes("Form estimate"));

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  check("No en or em dashes in site copy", !/&ndash;|&mdash;|\u2013|\u2014/.test(app));
  check("Dead #local-clock branch removed", !app.includes("local-clock"));
  check("Brand name is consistent", !fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").includes("lol.gg") && !fs.readFileSync("/tmp/jsdomtest/manifest.json", "utf8").includes("lol.gg"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
