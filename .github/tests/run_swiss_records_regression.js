const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_swiss_2026-10-26.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const T2026 = { id: "115660540725177488", slug: "worlds_2026", startDate: "2026-10-15", endDate: "2026-11-15" };
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const stages = FX.standings.data.standings[0].stages;
  const swiss = stages.find((s) => s.name === "Swiss").sections[0];
  check("Real capture: Riot sends no rankings for any Worlds stage", stages.every((s) => s.sections.every((sec) => !(sec.rankings || []).length)));
  check("Real capture: 20 Swiss matches are finished", swiss.matches.filter((m) => m.state === "completed").length === 20);

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getStandingsV3")) return J(FX.standingsV3);
    if (s.includes("/getStandings")) return J(FX.standings);
    if (s.includes("/getSchedule")) return J(FX.schedule);
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getTeams")) return J({ data: { teams: [] } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 80));
  const out = await w.buildTournamentContentHtml(WORLDS.id, T2026, WORLDS);
  const box = new JSDOM(`<body>${out}</body>`).window.document;
  const rows = [...box.querySelectorAll(".standings-table tbody tr")].map((tr) => ({
    rank: tr.querySelector(".standings-rank").textContent.trim(),
    code: decodeURIComponent((tr.querySelector("a.standings-team-link") || { getAttribute: () => "" }).getAttribute("href").split("/").pop()),
    record: tr.querySelector(".standings-record").textContent.trim(),
  }));
  const rec = (code) => (rows.find((r) => r.code === code) || {}).record;

  check("The Standings section no longer says standings aren't available", !/Standings aren't available/.test(out));
  check("One row per Swiss team (16)", rows.length === 16 && new Set(rows.map((r) => r.code)).size === 16);
  check("GEN and DK are 3-0 and share rank 1", rec("GEN") === "3-0" && rec("DK") === "3-0" && rows.filter((r) => r.rank === "1").length === 2);
  check("KC is 1-1 (beat AL, lost to LYON)", rec("KC") === "1-1");
  check("AL, LOS, TLAW and TSW are 0-2 at the bottom", ["AL", "LOS", "TLAW", "TSW"].every((c) => rec(c) === "0-2") && rows.slice(-4).every((r) => r.record === "0-2"));
  const totals = rows.map((r) => r.record.split("-").map(Number)).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
  check("Wins and losses each add up to the 20 finished matches", totals[0] === 20 && totals[1] === 20);
  check("Rows are ordered by record", rows.every((r, i) => i === 0 || Number(rows[i - 1].record.split("-")[0]) >= Number(r.record.split("-")[0])));
  check("Play-In teams eliminated there (MVK, FUR, C9) are not in the Swiss table", !["MVK", "FUR", "C9"].some((c) => rec(c)));
  check("The table says where the records come from", /Records counted from finished Swiss matches\./.test(out));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
