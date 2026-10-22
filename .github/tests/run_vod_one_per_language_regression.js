const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const KC_C9 = "115660588583171786";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const empty = { data: { schedule: { events: [], pages: { older: null, newer: null } } } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const vods = FX.eventDetails[KC_C9].data.event.match.games.flatMap((g) => g.vods);
  const spanish = new Set(vods.filter((v) => v.provider === "youtube" && v.locale === "es-MX").map((v) => v.parameter));
  check("Real capture: KC vs C9 has a different Spanish (es-MX) YouTube VOD for each of its 5 games", spanish.size === 5);

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?leagues=worlds", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    const p = new URL(s).searchParams;
    if (s.includes("/getSchedule")) return J(p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id) ? empty : FX.schedule);
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getTournamentsForLeague")) return J(FX.tournaments);
    if (s.includes("/getCompletedEvents")) return J(FX.completedEvents);
    if (s.includes("/getEventDetails")) return J(FX.eventDetails[p.get("id")] || { data: { event: null } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1500);
  await w.renderMatchPage(KC_C9);

  const labels = [...w.document.querySelectorAll('#match-main .locale-btn[data-kind="vod"]')].map((b) => b.textContent.trim());
  check("The match page lists VOD buttons", labels.length > 1);
  check("Each VOD button label appears once", new Set(labels).size === labels.length);
  check("Spanish (es-MX) has a single button", labels.filter((l) => l === "YouTube (es-MX)").length === 1);
  check("English stays first", labels[0] === "YouTube (en-US)");
  const distinct = new Set(vods.filter((v) => v.provider === "youtube" || v.provider === "twitch").map((v) => `${v.provider}:${v.locale}`));
  check("Every language Riot lists still has a button", labels.length === distinct.size);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
