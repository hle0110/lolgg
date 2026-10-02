const fs = require("fs");
const { JSDOM } = require("jsdom");

const APP = "/tmp/jsdomtest/app.js";
const PAYLOAD = '<b>X</b>';

function makeDom(indexHtml) {
  return new JSDOM(indexHtml.replace(/<script src="app\.js[^"]*"><\/script>/, ""), {
    url: "https://example.com/#/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync(APP, "utf8");
  const indexHtml = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8");

  check("An escapeHtml helper exists", /function escapeHtml\(value\) {/.test(app));
  check("escapeHtml covers &, <, >, \" and '", /&amp;/.test(app) && /&lt;/.test(app) && /&gt;/.test(app) && /&quot;/.test(app) && /&#39;/.test(app));
  check("A safeImageUrl helper rejects non-http(s) URLs", /function safeImageUrl\(url\)/.test(app) && /\^https\?:\\\/\\\//.test(app));

  const dom = makeDom(indexHtml);
  const { window } = dom;
  window.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  window.eval(app);
  await new Promise((r) => setTimeout(r, 60));

  const escaped = (html) => html.includes("&lt;b&gt;") && !html.includes("<b>X</b>");
  const team = (code, name) => ({ id: code, code, name, image: "", gameWins: 1, outcome: "win" });

  check(
    "Match card escapes the league name and block name (shown on every card)",
    escaped(
      window.matchCardHtml({
        id: "e1",
        state: "completed",
        startTime: new Date().toISOString(),
        league: { id: "L", name: PAYLOAD, image: "" },
        blockName: PAYLOAD,
        bestOf: 5,
        teams: [team("A", PAYLOAD), team("B", "B")],
      })
    )
  );
  check("teamHtml escapes the team name", escaped(window.teamHtml(team("A", PAYLOAD), false)));
  check(
    "Standings rows escape the team name",
    escaped(window.standingsTableRowHtml(1, { code: "A", name: PAYLOAD, image: "", record: { wins: 1, losses: 0 } }))
  );
  check(
    "Bracket round titles escape the round name",
    escaped(
      window.tournamentBracketByBlockHtml([
        {
          id: "b1",
          blockName: "Upper Bracket " + PAYLOAD,
          startTime: new Date(Date.now() - 60000).toISOString(),
          state: "completed",
          bestOf: 5,
          league: { id: "L", name: "LCK" },
          teams: [team("A", "A"), { id: "B", code: "B", name: "B", image: "", gameWins: 0, outcome: "loss" }],
        },
        {
          id: "b2",
          blockName: "Lower Bracket Round 1",
          startTime: new Date(Date.now() - 30000).toISOString(),
          state: "completed",
          bestOf: 5,
          league: { id: "L", name: "LCK" },
          teams: [team("C", "C"), { id: "D", code: "D", name: "D", image: "", gameWins: 0, outcome: "loss" }],
        },
      ])
    )
  );

  const logo = window.teamLogoHtml({ code: "A", name: "A", image: "javascript:alert(1)" });
  check("A javascript: logo URL is never emitted as an img src", !/src="javascript:/i.test(logo));
  const logo2 = window.teamLogoHtml({ code: "A", name: "A", image: "https://cdn.example.com/a.png" });
  check("A normal https logo URL still renders", logo2.includes("https://cdn.example.com/a.png"));

  const dom2 = makeDom(indexHtml);
  const w2 = dom2.window;
  w2.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w2.fetch = async (u) => {
    const s = String(u);
    const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
    if (s.includes("/getLeagues"))
      return J({ data: { leagues: [{ id: "98767991310872058", slug: "lck", name: "LCK " + PAYLOAD, image: "", priority: 1 }] } });
    if (s.includes("/getSchedule")) return J({ data: { schedule: { events: [], pages: { older: null, newer: null } } } });
    if (s.includes("/getLive")) return J({ data: { schedule: { events: [] } } });
    return J({ data: {} });
  };
  w2.eval(app);
  await new Promise((r) => setTimeout(r, 400));
  const pillHtml = w2.document.getElementById("league-filter").innerHTML;
  check("League filter pills render", pillHtml.includes("league-pill"));
  check("League filter pills escape the league name", escaped(pillHtml));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
