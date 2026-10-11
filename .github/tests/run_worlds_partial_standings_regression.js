const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_standings_2026-10-11.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const T2026 = { id: "115660540725177488", slug: "worlds_2026", startDate: "2026-10-15", endDate: "2026-11-14" };
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });

async function render(standingsData, tournament) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getStandingsV3")) return J(FX.standingsV3);
    if (s.includes("/getStandings")) return J(standingsData);
    if (s.includes("/getSchedule")) return J(FX.schedule);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 80));
  const out = await w.buildTournamentContentHtml(WORLDS.id, tournament, WORLDS);
  const box = new JSDOM(`<body>${out}</body>`).window.document;
  return { out, box, cards: [...box.querySelectorAll(".team-card")] };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const stages = FX.standings.data.standings[0].stages;
  const section = (n) => stages.find((s) => s.name === n).sections[0];
  const codes = (n) => new Set(section(n).matches.flatMap((m) => m.teams.map((t) => t.code)));

  check("Real capture: the Play-Ins stage names exactly four real teams besides TBD", ["C9", "FUR", "KC", "MVK"].every((c) => codes("Play-Ins").has(c)) && [...codes("Play-Ins")].filter((c) => c !== "TBD").length === 4);
  check("Real capture: Swiss and Knockouts hold only TBD", [...codes("Swiss")].join() === "TBD" && [...codes("Knockouts")].join() === "TBD");
  check("Real capture: Play-Ins has 6 matches, Swiss 33, Knockouts 7", section("Play-Ins").matches.length === 6 && section("Swiss").matches.length === 33 && section("Knockouts").matches.length === 7);

  const partial = await render(FX.standings, T2026);
  check("Partly filled standings (4 teams) still show all 19 qualified teams", partial.cards.length === 19);
  check("The note says all 19 teams come from the official list", /All 19 qualified teams, from the official Worlds team list/.test(partial.out));
  check("The four Play-In teams are in the list", ["C9", "FUR", "KC", "MVK"].every((c) => partial.out.includes(`#/team/${c}"`)));
  check("No TBD card is shown", !/#\/team\/TBD"/.test(partial.out));

  const bracket = partial.out.slice(partial.out.indexOf("<h3>Bracket</h3>"));
  const playIns = bracket.slice(0, bracket.indexOf("Swiss"));
  check("The Play-Ins bracket shows the two real matches", /FUR[\s\S]*MVK/.test(playIns) && /C9[\s\S]*KC/.test(playIns));
  check("The Play-Ins bracket shows every match as Bo5", (playIns.match(/Bo5/g) || []).length === 6);
  check("Unplayed Play-Ins slots are named from their feeder matches", /Winner of FUR vs MVK/.test(playIns) && /Loser of FUR vs MVK/.test(playIns) && /Winner of C9 vs KC/.test(playIns));

  const other = await render(FX.standings, { id: "old", slug: "worlds_2025", startDate: "2025-10-14", endDate: "2025-11-09" });
  check("A previous Worlds tournament keeps showing only its own standings teams", other.cards.length === 4 && !/qualified teams, from the official/.test(other.out));

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  check("The partial-standings rule is in place", /standingsTeams\.length < knownTeams\.length \? knownTeams : \[\]/.test(app));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
