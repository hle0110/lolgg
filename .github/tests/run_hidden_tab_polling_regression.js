const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_live_2026-10-29.json", "utf8"));
const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const BLG_TES = "115660540726095069";
const J = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => "" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ notify }) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?status=live&leagues=worlds", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  let skew = 0;
  const realNow = w.Date.now.bind(w.Date);
  w.Date.now = () => realNow() + skew;
  let hidden = false;
  Object.defineProperty(w.document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(w.document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  if (notify) {
    w.Notification = function () {};
    w.Notification.permission = "granted";
    w.localStorage.setItem("lolgg_notify_favorites", "1");
  }
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  const ticks = {};
  const realSetInterval = w.setInterval.bind(w);
  w.setInterval = (fn, ms) => {
    (ticks[ms] = ticks[ms] || []).push(fn);
    return realSetInterval(() => {}, 1e9);
  };
  const calls = { schedule: 0, stats: 0 };
  w.fetch = async (u) => {
    const s = String(u);
    const p = new URL(s).searchParams;
    if (s.includes("feed.lolesports.com")) {
      calls.stats++;
      return J(s.includes("/window/") ? FX.statsWindow : FX.statsDetails);
    }
    if (s.includes("/getSchedule")) {
      calls.schedule++;
      return J(p.get("pageToken") || (p.get("leagueId") && p.get("leagueId") !== WORLDS.id) ? { data: { schedule: { events: [], pages: { older: null, newer: null } } } } : FX.schedule);
    }
    if (s.includes("/getLive")) return J(FX.live);
    if (s.includes("/getEventDetails")) return J(p.get("id") === BLG_TES ? FX.eventDetails : { data: { event: null } });
    if (s.includes("/getLeagues")) return J({ data: { leagues: [WORLDS] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1200);
  return {
    w,
    calls,
    ticks,
    setHidden: (v) => {
      hidden = v;
      w.document.dispatchEvent(new w.Event("visibilitychange"));
    },
    later: () => {
      skew += 100 * 1000;
    },
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const liveEvent = FX.live.data.schedule.events.find((e) => e.match.id === BLG_TES);
  check("Real capture: Riot lists BLG vs TES as live", liveEvent && liveEvent.state === "inProgress");
  check("Real capture: the live stats window has frames", FX.statuses.statsWindow === 200 && FX.statsWindow.frames.length > 0);

  const a = await boot({ notify: false });
  const bg = a.ticks[20000][0];
  a.later();
  let before = a.calls.schedule;
  await bg();
  await wait(100);
  check("Visible tab: the 20 s poll fetches the schedule", a.calls.schedule > before);
  a.setHidden(true);
  a.later();
  before = a.calls.schedule;
  bg();
  await wait(300);
  check("Hidden tab: the 20 s poll fetches nothing", a.calls.schedule === before);
  a.later();
  before = a.calls.schedule;
  a.setHidden(false);
  await wait(300);
  check("Showing the tab again refreshes right away", a.calls.schedule > before);

  a.w.location.hash = `#/match/${BLG_TES}`;
  await wait(1500);
  const statsTick = (a.ticks[8000] || [])[0];
  check("The live BLG vs TES page starts the 8 s stats poll", !!statsTick);
  a.setHidden(true);
  a.later();
  before = a.calls.stats;
  await statsTick();
  await wait(100);
  check("Hidden tab: the 8 s stats poll fetches nothing", a.calls.stats === before);
  a.setHidden(false);
  before = a.calls.stats;
  await statsTick();
  await wait(100);
  check("Visible tab: the 8 s stats poll fetches live stats", a.calls.stats > before);
  check("Live stats show the captured gold after the visible poll", a.w.document.getElementById("live-stats-slot").textContent.includes(FX.statsWindow.frames[FX.statsWindow.frames.length - 1].blueTeam.totalGold.toLocaleString()));

  const b = await boot({ notify: true });
  b.setHidden(true);
  b.later();
  before = b.calls.schedule;
  b.ticks[20000][0]();
  await wait(300);
  check("Hidden tab with live alerts on: the 20 s poll keeps fetching so alerts still fire", b.calls.schedule > before);

  const sw = fs.readFileSync("/tmp/jsdomtest/sw.js", "utf8");
  const index = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8");
  const v = (index.match(/app\.js\?v=([0-9a-z]+)/) || [])[1];
  check("sw.js precaches the same app.js version index.html loads", !!v && sw.includes(`"./app.js?v=${v}"`) && !sw.includes('"./app.js",'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
