const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_swiss_2026-10-26.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const T1 = Date.parse("2026-10-26T13:40:00Z");
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const fail = { ok: false, status: 500, json: async () => ({}), text: async () => "" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?status=upcoming&leagues=worlds", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  let now = T1 - 60 * 1000;
  w.Date.now = () => now;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  let up = false;
  const tournaments = { data: { leagues: [{ tournaments: [{ id: "115660540725177488", slug: "worlds_2026", startDate: "2026-10-15", endDate: "2026-11-15" }] }] } };
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    if (!up) return fail;
    const p = new URL(s).searchParams;
    if (s.includes("/getSchedule")) return J(p.get("pageToken") ? { data: { schedule: { events: [], pages: { older: null, newer: null } } } } : FX.schedule);
    if (s.includes("/getStandingsV3")) return J(FX.standingsV3);
    if (s.includes("/getStandings")) return J(FX.standings);
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getTournamentsForLeague")) return J(tournaments);
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(800);
  const home = () => w.document.getElementById("home-freshness").textContent;
  const label = (ms) => `Data as of ${new w.Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, source: Riot esports API`;

  check("While every Riot request fails, the home page shows no freshness line", home() === "");
  await w.renderTournamentPage(WORLDS.id, "115660540725177488");
  check("While every Riot request fails, the tournament page shows no freshness line", (w.document.getElementById("tournament-freshness") || { textContent: "" }).textContent === "");

  up = true;
  now = T1;
  await w.getSchedule([WORLDS.id]);
  w.loadActiveTab(true);
  await wait(300);
  check("After Riot answers, the home page shows the time of that fetch", home() === label(T1));
  await w.renderTournamentPage(WORLDS.id, "115660540725177488");
  const tour = w.document.getElementById("tournament-freshness").textContent;
  check("The tournament page (standings and bracket) shows the time of its fetch", tour === label(T1));

  up = false;
  now = T1 + 10 * 60 * 1000;
  await w.getSchedule([WORLDS.id]).catch(() => {});
  w.loadActiveTab(true);
  await wait(300);
  await w.renderTournamentPage(WORLDS.id, "115660540725177488");
  check("Ten minutes later, with Riot failing, the home line still shows the last good fetch, not the render time", home() === label(T1));
  check("The tournament line also keeps the last good fetch time", w.document.getElementById("tournament-freshness").textContent === label(T1));

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  check("The fetch time is recorded only after a successful response", /if \(!res\.ok\) throw[\s\S]{0,80}const data = await res\.json\(\);\s*lastFetchOkAt\.set\(url, Date\.now\(\)\);/.test(app));
  check("Match and team pages have a freshness line", /id="match-freshness"/.test(app) && /id="team-freshness"/.test(app));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
