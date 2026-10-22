const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const GEN_IG = "115660540726095005";
const TLAW_CFO = "115660540726095007";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const empty = { data: { schedule: { events: [], pages: { older: null, newer: null } } } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(status, nowIso) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: `https://example.com/#/?status=${status}&leagues=worlds`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const skew = Date.parse(nowIso) - Date.now();
  w.Date.now = () => Date.now() + skew;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getSchedule")) {
      const p = new URL(s).searchParams;
      if (p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id)) return J(empty);
      return J(FX.schedule);
    }
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getTournamentsForLeague")) return J(FX.tournaments);
    if (s.includes("/getCompletedEvents")) return J(FX.completedEvents);
    if (s.includes("/getEventDetails")) return J(FX.eventDetails[new URL(s).searchParams.get("id")] || { data: { event: null } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1500);
  const tab = w.document.getElementById("tab-content");
  return { rows: [...tab.querySelectorAll(".schedule-row")].map((a) => a.getAttribute("href").split("/").pop()), text: tab.textContent.replace(/\s+/g, " ") };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const ev = (id) => FX.schedule.data.schedule.events.find((e) => e.match.id === id);
  check("Real capture: Riot lists GEN vs IG as unstarted at 17:00 UTC on Oct 23", ev(GEN_IG).state === "unstarted" && ev(GEN_IG).startTime === "2026-10-23T17:00:00Z");
  check("Real capture: Riot's live endpoint lists nothing", FX.live.data.schedule.events.length === 0);
  check("Real capture: GEN vs IG details show its game unstarted", FX.eventDetails[GEN_IG].data.event.match.games.every((g) => g.state === "unstarted"));

  const before = await boot("upcoming", "2026-10-23T16:50:00Z");
  check("Ten minutes before start, GEN vs IG is still in Upcoming", before.rows.includes(GEN_IG));
  const beforeLive = await boot("live", "2026-10-23T16:50:00Z");
  check("Ten minutes before start, the Live tab says nothing is live", /No matches are live right now\./.test(beforeLive.text));
  check("The Live tab offers GEN vs IG as next up, not as live", /Next up/.test(beforeLive.text) && beforeLive.rows.includes(GEN_IG));

  const late = await boot("upcoming", "2026-10-23T18:30:00Z");
  check("Running late: matches Riot still lists as unstarted stay in Upcoming", late.rows.includes(GEN_IG) && late.rows.includes(TLAW_CFO));

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  check("computeEffectiveState no longer guesses live from the clock", /function computeEffectiveState\(rawState, teams\) {/.test(app) && !/elapsedMs/.test(app));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
