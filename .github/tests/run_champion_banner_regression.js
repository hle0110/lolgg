const fs = require("fs");
const { JSDOM } = require("jsdom");

const FINAL = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_final_2026-11-15.json", "utf8"));
const SWISS = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_swiss_2026-10-26.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const empty = { data: { schedule: { events: [], pages: { older: null, newer: null } } } };
const T = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

async function home(fx, nowIso) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?status=completed", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const skew = Date.parse(nowIso) - Date.now();
  w.Date.now = () => Date.now() + skew;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    const p = new URL(s).searchParams;
    if (s.includes("/getSchedule")) return J(p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id) ? empty : fx.schedule);
    if (s.includes("/getLive")) return J(fx.live);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 1500));
  return w.document.getElementById("champion-banner");
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const finals = FINAL.schedule.data.schedule.events.filter((e) => e.blockName === "Finals");
  const f2026 = finals.find((e) => e.startTime.startsWith("2026"));
  check("Real capture: the 2026 Worlds final is completed and BLG won 3-1", f2026 && f2026.state === "completed" && f2026.match.teams.map((t) => `${t.code}${t.result.gameWins}${t.result.outcome}`).join() === "GEN1loss,BLG3win");
  check("Real capture: the schedule also holds the 2025 final (T1 won)", finals.some((e) => e.startTime.startsWith("2025") && e.match.teams.some((t) => t.code === "T1" && t.result.outcome === "win")));

  const day1 = await home(FINAL, "2026-11-15T16:40:00Z");
  check("The day after the final, the home page shows the banner", day1 && !day1.classList.contains("hidden"));
  check("Banner text: Your Worlds 2026 winner is BLG", day1 && T(day1.querySelector("a > span")) === "Your Worlds 2026 winner is BLG");
  check("Banner shows the winner's logo", day1 && day1.querySelector("img") && /^https:\/\//.test(day1.querySelector("img").getAttribute("src")));
  check("Banner links to the Worlds tournament page", day1 && day1.querySelector("a").getAttribute("href") === `#/tournament/${WORLDS.id}`);

  const later = await home(FINAL, "2026-12-20T12:00:00Z");
  check("More than 30 days after the final, the banner is hidden", later && later.classList.contains("hidden") && T(later) === "");

  const midSwiss = await home(SWISS, "2026-10-26T13:40:00Z");
  check("Before the 2026 final, no banner (the 2025 final is too old)", midSwiss && midSwiss.classList.contains("hidden"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
