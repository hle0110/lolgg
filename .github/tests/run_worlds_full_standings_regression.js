const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const T2026 = FX.tournaments.data.leagues[0].tournaments.find((t) => t.id === "115660540725177488");
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });

async function render(teamsFail) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getStandingsV3")) return J(FX.standingsV3);
    if (s.includes("/getStandings")) return J(FX.standings);
    if (s.includes("/getSchedule")) return J(FX.schedule);
    if (s.includes("/getCompletedEvents")) return J(FX.completedEvents);
    if (s.includes("/getTeams")) {
      if (teamsFail) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
      return J(FX.getTeamsById[new URL(s).searchParams.get("id")] || { data: { teams: [] } });
    }
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 80));
  const out = await w.buildTournamentContentHtml(WORLDS.id, T2026, WORLDS);
  const box = new JSDOM(`<body>${out}</body>`).window.document;
  const cards = [...box.querySelectorAll(".team-card")];
  return { out, cards, hrefs: cards.map((c) => c.getAttribute("href")) };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const stages = FX.standings.data.standings[0].stages;
  const codes = new Set(stages.flatMap((s) => s.sections.flatMap((sec) => sec.matches.flatMap((m) => m.teams.map((t) => t.code)))));
  codes.delete("TBD");
  check("Real capture: standings name all 19 Worlds teams", codes.size === 19);
  const final = stages.find((s) => s.name === "Play-Ins").sections[0].matches.find((m) => m.id === "116299649498303884");
  check("Real capture: the Play-Ins final is KC 3-0 MVK", final.teams.map((t) => `${t.code}${t.result.gameWins}`).join() === "KC3,MVK0");

  for (const [label, teamsFail] of [["", false], [" when getTeams fails", true]]) {
    const r = await render(teamsFail);
    check(`19 team cards${label}`, r.cards.length === 19);
    check(`Every card links to its team page${label}`, r.hrefs.every((h) => /^#\/team\/[A-Z0-9]+$/.test(h || "")));
    check(`No duplicate cards${label}`, new Set(r.hrefs).size === r.hrefs.length);
    check(`FUR, C9, KC and MVK are listed once each${label}`, ["FUR", "C9", "KC", "MVK"].every((c) => r.hrefs.filter((h) => h === `#/team/${c}`).length === 1));
    check(`Cards use Riot's team names${label}`, r.out.includes("MVK Esports") && !r.out.includes("Saigon Buffalo Esports"));
    check(`Every card has a logo${label}`, r.cards.every((c) => c.querySelector("img")));
    check(`The fallback note is not shown${label}`, !/qualified teams, from the official Worlds team list/.test(r.out));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
