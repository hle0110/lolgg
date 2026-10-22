const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const MVK_ID = "107251245690956393";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const fail = { ok: false, status: 500, json: async () => ({}), text: async () => "" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  let down = true;
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getTournamentsForLeague")) return down ? fail : J(FX.tournaments);
    if (s.includes("/getTeams")) return down ? fail : J(FX.getTeamsById[new URL(s).searchParams.get("id")] || { data: { teams: [] } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("/getSchedule")) return J({ data: { schedule: { events: [], pages: { older: null, newer: null } } } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(500);

  const firstTournaments = await w.getTournamentsForLeague(WORLDS.id);
  const firstTeam = await w.getTeamByQuery(MVK_ID);
  check("While Riot answers 500, the tournament list comes back empty", firstTournaments.length === 0);
  check("While Riot answers 500, the team lookup comes back empty", firstTeam === null);

  down = false;
  const tournaments = await w.getTournamentsForLeague(WORLDS.id);
  const team = await w.getTeamByQuery(MVK_ID);
  check("Once Riot answers again, the next call gets the real tournament list (Worlds 2026)", tournaments.some((t) => t.id === "115660540725177488"));
  check("Once Riot answers again, the next call gets the real team (MVK)", team && team.code === "MVK" && team.homeLeague && team.homeLeague.name === "LCP");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
