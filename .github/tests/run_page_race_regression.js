const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const KC_C9 = "115660588583171786";
const GEN_IG = "115660540726095005";
const T2026 = "115660540725177488";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const empty = { data: { schedule: { events: [], pages: { older: null, newer: null } } } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?leagues=worlds", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  const polls = new Set();
  const realSetInterval = w.setInterval.bind(w);
  const realClearInterval = w.clearInterval.bind(w);
  w.setInterval = (fn, ms) => {
    const id = realSetInterval(() => {}, 1e9);
    if (ms === 30000) polls.add(id);
    return id;
  };
  w.clearInterval = (id) => {
    polls.delete(id);
    realClearInterval(id);
  };
  let slow = null;
  w.fetch = async (u) => {
    const s = String(u);
    const p = new URL(s).searchParams;
    if (s.includes("/getSchedule")) {
      if (p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id)) return J(empty);
      return J(FX.schedule);
    }
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getTournamentsForLeague")) return J(FX.tournaments);
    if (s.includes("/getCompletedEvents")) return J(p.get("tournamentId") === T2026 ? FX.completedEvents : empty);
    if (s.includes("/getEventDetails")) {
      if (slow === p.get("id")) await wait(800);
      return J(FX.eventDetails[p.get("id")] || { data: { event: null } });
    }
    if (s.includes("/getStandings")) {
      if (slow === p.get("tournamentId")) await wait(800);
      if (p.get("tournamentId") !== T2026) return J({ data: { standings: [] } });
      return J(s.includes("/getStandingsV3") ? FX.standingsV3 : FX.standings);
    }
    if (s.includes("/getTeams")) return J(FX.getTeamsById[p.get("id")] || { data: { teams: [] } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1500);

  const match = w.document.getElementById("match-main");
  slow = KC_C9;
  const first = w.renderMatchPage(KC_C9);
  await wait(50);
  await w.renderMatchPage(GEN_IG);
  await first;
  await wait(200);
  check("Real capture: KC vs C9 and GEN vs IG are both in the Worlds schedule", [KC_C9, GEN_IG].every((id) => FX.schedule.data.schedule.events.some((e) => e.match.id === id)));
  check("Opening GEN vs IG while KC vs C9 is still loading shows GEN vs IG", /Gen\.G Esports/.test(match.textContent) && !/Karmine Corp/.test(match.textContent));
  check("Only one match page refresh timer runs", polls.size === 1);

  const tournaments = FX.tournaments.data.leagues[0].tournaments;
  const older = tournaments.find((t) => t.id !== T2026 && t.slug === "worlds_2025");
  check("Real capture: Worlds 2025 is in the tournament list", !!older);
  const main = w.document.getElementById("tournament-main");
  slow = T2026;
  const firstT = w.renderTournamentPage(WORLDS.id, T2026);
  await wait(50);
  slow = null;
  await w.renderTournamentPage(WORLDS.id, older.id);
  await firstT;
  await wait(200);
  check("Switching to Worlds 2025 while Worlds 2026 is still loading keeps Worlds 2025", !/MVK Esports/.test(main.textContent) && /2025/.test(main.textContent));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
