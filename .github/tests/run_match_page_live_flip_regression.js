const fs = require("fs");
const { JSDOM } = require("jsdom");

const LIVE = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_live_2026-10-03.json", "utf8"));
const CUP = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_cup_2026.json", "utf8"));
const LEAGUE = LIVE.earlyStart.live.data.schedule.events[0].league;
const MATCH_ID = LIVE.earlyStart.live.data.schedule.events[0].match.id;
const STAND_IN_DETAIL_ID = "117133805552196841";
const J = (d, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => d, text: async () => "" });
const wrap = (events) => ({ data: { schedule: { events, pages: { older: null, newer: null } } } });

const NOTE =
  "No real capture exists of getEventDetails for BRO vs JDG during 12:18 to 12:20 UTC on 2026-10-03, when Riot had the event inProgress and game 1 unstarted. " +
  "Stand-in: the real pre-match getEventDetails of RED vs NAVI (same tournament, Bo1, game 1 unstarted, captured 2026-10-03T00:20Z), served unchanged.";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const opened = CUP.schedule[LEAGUE.id].find((e) => e.match.id === MATCH_ID);
  const later = LIVE.earlyStart.schedule.data.schedule.events.find((e) => e.match.id === MATCH_ID);
  const standIn = CUP.eventDetails[STAND_IN_DETAIL_ID];
  check("Real capture at 00:20Z: BRO vs JDG is unstarted in the schedule", opened && opened.state === "unstarted");
  check("Real capture at 12:22Z: BRO vs JDG is inProgress in the schedule", later && later.state === "inProgress");
  check("Stand-in detail: no state, no startTime, game 1 unstarted, 0-0", !("state" in standIn) && !("startTime" in standIn) && standIn.match.games.every((g) => g.state === "unstarted") && standIn.match.teams.every((t) => t.result.gameWins === 0));

  let phase = wrap(CUP.schedule[LEAGUE.id]);
  let skew = 0;
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: `https://example.com/#/match/${MATCH_ID}`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const realNow = w.Date.now.bind(w.Date);
  w.Date.now = () => realNow() + skew;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getSchedule")) return J(phase);
    if (s.includes("/getEventDetails")) return J({ data: { event: standIn } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [LEAGUE] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1000);

  const main = w.document.getElementById("match-main");
  const capturedAtOpen = (await w.getSchedule([LEAGUE.id])).find((e) => e.id === MATCH_ID);
  check("Page opened while the match was unstarted shows the countdown", capturedAtOpen && capturedAtOpen.state === "unstarted" && main.querySelector("#match-countdown-slot"));

  phase = LIVE.earlyStart.schedule;
  skew = 91 * 1000;
  await w.getSchedule([LEAGUE.id]);
  await w.refreshMatchPage(MATCH_ID, capturedAtOpen);
  await wait(300);

  check("After the schedule turns inProgress, the countdown is gone", !main.querySelector("#match-countdown-slot"));
  check("After the schedule turns inProgress, the live stream block shows", main.textContent.includes("Live Stream") && main.querySelectorAll(".locale-btn").length === 2);

  const failed = results.filter((r) => !r.pass);
  console.log(`\nNote: ${NOTE}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
