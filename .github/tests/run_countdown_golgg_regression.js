const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div><select id="tz-select"></select></div>
    <div id="top-clock"><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
    <nav id="tabs">
      <div class="seg"><button type="button" class="seg-btn" data-view="matches">Matches</button><button type="button" class="seg-btn" data-view="tournaments">Tournaments</button></div>
      <div class="seg"><button type="button" class="seg-btn" data-status="live">Live</button><button type="button" class="seg-btn" data-status="upcoming">Upcoming</button><button type="button" class="seg-btn" data-status="completed">Results</button></div>
    </nav>
    <div id="home-view"><div id="tournament-banner"></div><div id="league-filter"></div><main id="esports-main"><section id="tab-content"></section></main></div>
    <div id="match-view" class="hidden"><main id="match-main"></main></div>
    <div id="tournament-view" class="hidden"><main id="tournament-main"></main></div>
    <div id="team-view" class="hidden"><main id="team-main"></main></div>
  </body></html>`, { url: "https://example.com/#/", runScripts: "outside-only" });
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;
  // jsdom has no rendering loop, so requestAnimationFrame doesn't exist by default - paintMatchPage's
  // "match just went live" toast uses it, which this test triggers by transitioning the same page
  // through unstarted -> inProgress -> completed across separate paintMatchPage calls below.
  window.requestAnimationFrame = (cb) => cb();

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getEventDetails")) {
      return { ok: true, json: async () => ({ data: { event: { id: "any", state: "unstarted", streams: [], match: { strategy: { count: 3 }, teams: [] } } } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  // ============ countdownPartsFromNow / countdownDigitsHtml (pure logic) ============
  const in2Days3h4m5s = Date.now() + ((2 * 24 * 3600 + 3 * 3600 + 4 * 60 + 5) * 1000) + 500;
  const parts = window.countdownPartsFromNow(in2Days3h4m5s);
  check("countdownPartsFromNow computes days correctly", parts.days === 2);
  check("countdownPartsFromNow computes hours correctly", parts.hours === 3);
  check("countdownPartsFromNow computes minutes correctly", parts.minutes === 4);
  check("countdownPartsFromNow returns null for a time already in the past", window.countdownPartsFromNow(Date.now() - 5000) === null);

  const digitsWithDays = window.countdownDigitsHtml({ days: 2, hours: 3, minutes: 4, seconds: 5 });
  check("countdownDigitsHtml includes a day segment when days > 0", digitsWithDays.includes("2d"));
  check("countdownDigitsHtml zero-pads hours/minutes/seconds", digitsWithDays.includes("03h") && digitsWithDays.includes("04m") && digitsWithDays.includes("05s"));

  const digitsNoDays = window.countdownDigitsHtml({ days: 0, hours: 13, minutes: 43, seconds: 19 });
  check("countdownDigitsHtml omits the day segment when days is 0", !digitsNoDays.includes("0d") && digitsNoDays.includes("13h"));

  // ============ Wired into the match page for an upcoming match ============
  const teams = [{ code: "T1", name: "T1" }, { code: "GEN", name: "Gen.G" }];
  const futureStart = new Date(Date.now() + 13 * 3600 * 1000 + 43 * 60 * 1000).toISOString();
  const upcomingEvent = { id: "ev-upcoming", startTime: futureStart, state: "unstarted", blockName: "", bestOf: 1, league: { id: "L1", name: "LCK" }, teams };
  await window.paintMatchPage("ev-upcoming", upcomingEvent);
  const matchMainEl = window.document.getElementById("match-main");
  check("An upcoming match's page renders a countdown slot", matchMainEl.querySelector("#match-countdown-slot") !== null);
  check("The countdown slot actually shows ticking digits, not empty", matchMainEl.querySelector("#match-countdown-slot").innerHTML.includes("countdown-segment"));

  // A completed/live match should NOT show a countdown slot
  const liveEvent = { id: "ev-live", startTime: new Date(Date.now() - 60000).toISOString(), state: "inProgress", blockName: "", bestOf: 1, league: { id: "L1", name: "LCK" }, teams };
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getEventDetails")) {
      const liveEventDetail = {
        id: "ev-live",
        state: "inProgress",
        streams: [{ provider: "twitch", parameter: "lck", locale: "en-US" }],
        match: {
          strategy: { count: 1 },
          games: [{ id: "g1", number: 1, state: "inProgress", teams: [] }],
          teams: [],
        },
      };
      return { ok: true, json: async () => ({ data: { event: liveEventDetail } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
  await window.paintMatchPage("ev-live", liveEvent);
  check("A live (inProgress) match's page does not show a countdown slot", matchMainEl.querySelector("#match-countdown-slot") === null);

  // ============ gol.gg link removed per explicit request - confirm it's actually gone ============
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: "ev-done",
              state: "completed",
              streams: [],
              match: { strategy: { count: 1 }, games: [{ id: "g1", number: 1, state: "completed", teams: [], vods: [] }], teams: [] },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
  const completedEvent = { id: "ev-done", startTime: new Date(Date.now() - 3600000).toISOString(), state: "completed", blockName: "", bestOf: 1, league: { id: "L1", name: "LCK" }, teams };
  await window.paintMatchPage("ev-done", completedEvent);
  check("A completed match's page no longer links out to gol.gg (removed per explicit request)", !matchMainEl.innerHTML.includes("gol.gg"));

  // ============ "watch on Twitch/YouTube directly" hint text is back to its original wording ============
  const appJsSource = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  check(
    "The stream player's watch-link hint text does not have 'or' inserted before 'directly' (reverted per explicit request)",
    !appJsSource.includes("or directly ↗")
  );
  check(
    "The stream player's watch-link hint text is back to its original wording",
    (appJsSource.match(/doesn't load, watch on .*? directly ↗/g) || []).length >= 2
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
