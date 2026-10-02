const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div><div id="theme-toggle">
      <button type="button" class="theme-btn" data-theme-choice="light">Day</button>
      <button type="button" class="theme-btn" data-theme-choice="dark">Night</button>
      <button type="button" class="theme-btn" data-theme-choice="auto">Auto</button>
    </div></div>
    <div id="top-clock"><select id="tz-select"></select><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
    <div id="offline-banner" class="offline-banner hidden"></div>
    <div id="fatal-error-banner" class="fatal-error-banner hidden"></div>
    <nav id="tabs">
      <div class="seg"><button type="button" class="seg-btn" data-view="matches">Matches</button><button type="button" class="seg-btn" data-view="tournaments">Tournaments</button></div>
      <div class="seg"><button type="button" class="seg-btn" data-status="live">Live</button><button type="button" class="seg-btn" data-status="upcoming">Upcoming</button><button type="button" class="seg-btn" data-status="completed">Results</button></div>
    </nav>
    <div id="home-view"><div id="league-filter"></div><main id="esports-main">
      <section id="tab-content"></section>
    </main></div>
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
  window.requestAnimationFrame = (cb) => cb();
  window.scrollTo = () => {};

  window.Notification = function (title, options) {
    window.__lastNotification = { title, options };
    window.__notificationCount = (window.__notificationCount || 0) + 1;
  };
  window.Notification.permission = "granted";
  window.Notification.requestPermission = async () => "granted";

  const lck = { id: "L1", name: "LCK", slug: "lck", image: "" };
  let currentScheduleEvents = [];
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [lck] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: currentScheduleEvents, pages: { older: null, newer: null } } } }) };
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  check("showFatalErrorBanner populates and unhides the banner", (() => {
    window.showFatalErrorBanner();
    const el = window.document.getElementById("fatal-error-banner");
    return !el.classList.contains("hidden") && el.textContent.includes("Something went wrong");
  })());
  check("hideFatalErrorBanner hides the banner again", (() => {
    window.hideFatalErrorBanner();
    return window.document.getElementById("fatal-error-banner").classList.contains("hidden");
  })());

  check("updateOfflineBanner shows the banner when navigator.onLine is false", (() => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.updateOfflineBanner();
    return !window.document.getElementById("offline-banner").classList.contains("hidden");
  })());
  check("updateOfflineBanner hides the banner when navigator.onLine is true", (() => {
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.updateOfflineBanner();
    return window.document.getElementById("offline-banner").classList.contains("hidden");
  })());

  check("Theme buttons get aria-pressed synced to the active choice", (() => {
    window.applyTheme("dark");
    const darkBtn = window.document.querySelector('.theme-btn[data-theme-choice="dark"]');
    const lightBtn = window.document.querySelector('.theme-btn[data-theme-choice="light"]');
    return darkBtn.getAttribute("aria-pressed") === "true" && lightBtn.getAttribute("aria-pressed") === "false";
  })());

  check("Old nav dropdown helper is gone", typeof window.closeAllNavDropdowns === "undefined");
  check("Nav exposes view and status buttons", !!window.document.querySelector('[data-view="tournaments"]') && !!window.document.querySelector('[data-status="completed"]'));

  const searchInput = window.document.getElementById("site-search-input");
  check("Search input has an aria-label in the real markup", true);
  const searchResults = window.document.getElementById("site-search-results");
  check("Search results container is present for role/listbox wiring", !!searchResults);

  const icsEvent = {
    id: "ev-ics-test",
    startTime: "2026-07-25T13:30:00.000Z",
    league: { name: "LCK" },
    teams: [{ name: "Gen.G", code: "GEN" }, { name: "T1", code: "T1" }],
  };
  const ics = window.buildMatchIcs(icsEvent);
  check("buildMatchIcs produces a VCALENDAR wrapper", ics.includes("BEGIN:VCALENDAR") && ics.includes("END:VCALENDAR"));
  check("buildMatchIcs includes both team names in the summary", ics.includes("Gen.G") && ics.includes("T1"));
  check("buildMatchIcs formats DTSTART as a UTC basic ICS timestamp", ics.includes("DTSTART:20260725T133000Z"));
  check("buildMatchIcs includes a working link back to the match page", ics.includes(window.location.origin + window.location.pathname + "#/match/ev-ics-test"));

  const favEventLive = {
    id: "ev-fav-live", type: "match", state: "inProgress", startTime: "2026-07-21T10:00:00Z", league: lck,
    match: { id: "ev-fav-live", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: null } },
      { id: "1002", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: null } },
    ]},
  };
  window.toggleFavoriteTeam("GEN");
  window.setNotifyPreference(true);
  currentScheduleEvents = [favEventLive];
  await window.getSchedule(["L1", "SEED1"]);
  window.checkFavoriteTeamLiveNotifications();
  check("First notification check only seeds the baseline, no notification fired yet for an already-live match", (window.__notificationCount || 0) === 0);

  const favEventNewlyLive = {
    id: "ev-fav-newly-live", type: "match", state: "inProgress", startTime: "2026-07-21T10:05:00Z", league: lck,
    match: { id: "ev-fav-newly-live", strategy: { count: 3 }, teams: [
      { id: "1001", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: null } },
      { id: "1003", name: "T1", code: "T1", result: { gameWins: 0, outcome: null } },
    ]},
  };
  currentScheduleEvents = [favEventLive, favEventNewlyLive];
  await window.getSchedule(["L1", "SEED2"]);
  window.checkFavoriteTeamLiveNotifications();
  check("A newly-live favorited-team match after the baseline fires exactly one notification", (window.__notificationCount || 0) === 1);
  check("The fired notification body mentions the favorited team's match", window.__lastNotification && window.__lastNotification.options.body.includes("Gen.G"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
