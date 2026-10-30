const fs = require("fs");
const { JSDOM } = require("jsdom");

const LIVE = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_live_2026-10-29.json", "utf8"));
const DONE = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const BLG_TES = "115660540726095069";
const KC_C9 = "115660588583171786";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const empty = { data: { schedule: { events: [], pages: { older: null, newer: null } } } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

async function openMatch(fx, matchId, nowIso) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: `https://example.com/#/match/${matchId}`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const skew = Date.parse(nowIso) - Date.now();
  w.Date.now = () => Date.now() + skew;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    const p = new URL(s).searchParams;
    if (s.includes("feed.lolesports.com")) return J(s.includes("/window/") ? fx.statsWindow : fx.statsDetails);
    if (s.includes("/getSchedule")) return J(p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id) ? empty : fx.schedule);
    if (s.includes("/getLive")) return J(fx.live);
    if (s.includes("/getEventDetails")) {
      const d = fx.eventDetails && fx.eventDetails.data ? (p.get("id") === matchId ? fx.eventDetails : null) : (fx.eventDetails || {})[p.get("id")];
      return J(d || { data: { event: null } });
    }
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(2500);
  return { w, main: w.document.getElementById("match-main") };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const games = LIVE.eventDetails.data.event.match.games;
  check("Real capture: BLG vs TES games are completed, inProgress, unstarted", games.map((g) => g.state).join() === "completed,inProgress,unstarted");
  check("Real capture: series score BLG 1, TES 0", LIVE.eventDetails.data.event.match.teams.map((t) => `${t.code}${t.result.gameWins}`).join() === "BLG1,TES0");

  const { w, main } = await openMatch(LIVE, BLG_TES, "2026-10-29T23:48:43Z");
  check("Header says which game is live and the series score", /Game 2 live · BLG 1-0 TES/.test(T(main.querySelector(".modal-state"))));
  const strip = [...main.querySelectorAll("#game-strip-slot .game-strip-item")].map(T);
  check("Game strip: Game 1 done, Game 2 live, Game 3 not started", strip.join("|") === "Game 1 done|Game 2 live|Game 3 not started");
  check("The strip does not name game winners", !/won|win/i.test(T(main.querySelector("#game-strip-slot"))));

  const sw = main.querySelector(".locale-switch");
  const visible = () => [...sw.querySelectorAll(".locale-btn")].filter((b) => !b.closest(".hidden")).map(T);
  const toggle = sw.querySelector(".locale-more-btn");
  check("Only English stream buttons show at first", visible().join("|") === "Twitch (en-US)|YouTube (en-US)");
  const more = sw.querySelector(".locale-more");
  const hiddenCount = more ? more.children.length : 0;
  check("A 'More languages' control counts the hidden languages", toggle && hiddenCount > 0 && T(toggle) === `More languages (${hiddenCount})` && hiddenCount + 2 === sw.querySelectorAll(".locale-btn").length);
  check("The control is a real button, so it works with touch", toggle && toggle.tagName === "BUTTON" && toggle.getAttribute("type") === "button" && toggle.getAttribute("aria-expanded") === "false");
  if (toggle) toggle.click();
  check("Tapping it shows every language", toggle && visible().length === sw.querySelectorAll(".locale-btn").length && toggle.getAttribute("aria-expanded") === "true");
  const kr = [...sw.querySelectorAll(".locale-btn")].find((b) => T(b) === "YouTube (ko-KR)");
  kr.click();
  check("A revealed language can be picked", kr.classList.contains("active"));

  const statsSlot = main.querySelector("#live-stats-slot");
  check("While a game runs, the stats say they run about 90 seconds behind", /Stats run about 90 seconds behind the broadcast\./.test(T(statsSlot)));
  check("Without stats yet, there is no delay line", !/90 seconds/.test(w.liveStatsHtml(null)));

  const done = await openMatch(DONE, KC_C9, "2026-10-19T04:24:03Z");
  check("A finished match has no game strip and no delay line", !done.main.querySelector("#game-strip-slot") && !/90 seconds behind/.test(T(done.main)));
  check("A finished match keeps its 'Final' header", /Final/.test(T(done.main.querySelector(".modal-state"))));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
