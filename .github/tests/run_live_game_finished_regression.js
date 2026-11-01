const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_live_2026-10-30.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const TLAW_LOS = "115660540726095077";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const empty = { data: { schedule: { events: [], pages: { older: null, newer: null } } } };
const T = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const event = FX.eventDetails.data.event;
  const frames = FX.statsWindow.frames;
  const last = frames[frames.length - 1];
  check("Real capture: Riot's details still show game 3 in progress", event.match.games.map((g) => g.state).join() === "completed,completed,inProgress");
  check("Real capture: Riot's live list still shows the match in progress", FX.live.data.schedule.events.some((e) => e.match.id === TLAW_LOS && e.state === "inProgress"));
  check("Real capture: the stats feed's last frame says the game finished", last.gameState === "finished");

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: `https://example.com/#/match/${TLAW_LOS}`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const skew = Date.parse("2026-10-30T22:50:06Z") - Date.now();
  w.Date.now = () => Date.now() + skew;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    const p = new URL(s).searchParams;
    if (s.includes("feed.lolesports.com")) return J(s.includes("/window/") ? FX.statsWindow : FX.statsDetails);
    if (s.includes("/getSchedule")) return J(p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id) ? empty : FX.schedule);
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getEventDetails")) return J(p.get("id") === TLAW_LOS ? FX.eventDetails : { data: { event: null } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 2500));
  const main = w.document.getElementById("match-main");
  const stats = T(main.querySelector("#live-stats-slot"));

  check("Header still follows Riot: game 3 live, series 1-1", /Game 3 live · LOS 1-1 TLAW/.test(T(main.querySelector(".modal-state"))));
  check("Strip: games 1 and 2 done, game 3 live", [...main.querySelectorAll(".game-strip-item")].map(T).join("|") === "Game 1 done|Game 2 done|Game 3 live");
  check("Stats say the game has ended and the result is pending", /This game has ended\. Waiting for Riot to post the result\./.test(stats));
  check("The 90 second delay line is not shown for an ended game", !/90 seconds behind/.test(stats));
  check("The final stats are still shown (kills 5 and 17)", new RegExp(`${last.blueTeam.totalKills}\\s*Kills\\s*${last.redTeam.totalKills}`).test(stats));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
