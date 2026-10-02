const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker">
      <div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div>
      <select id="tz-select"></select>
    </div>
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

// Raw /getSchedule-shaped fixture events, in the exact shape normalizeEvent/fetchScheduleRaw expect
// (confirmed against normalizeEvent/normalizeTeam/isMatchEvent in app.js) - used to populate the
// real scheduleCache via an actual getSchedule() call rather than assigning `window.scheduleCache`
// directly. That direct-assignment approach doesn't work: scheduleCache is declared with `let` at
// the top of app.js, and top-level `let`/`const` bindings evaluated via `window.eval` live in a
// separate global lexical environment, NOT as properties on `window` - so `window.scheduleCache = x`
// creates an unrelated property that the app's own closures never see. Only calling exported
// functions (which top-level `function` declarations DO become properties for) can actually change
// internal state.
function rawEvent(id, state, startTimeIso, teamA, teamB) {
  return {
    type: "match",
    startTime: startTimeIso,
    state,
    blockName: "",
    league: { id: "lck", name: "LCK", slug: "lck" },
    match: {
      id,
      strategy: { count: 3 },
      teams: [teamA, teamB],
    },
  };
}
const FIXTURE_EVENTS = [
  rawEvent(
    "h2h-1",
    "completed",
    new Date(Date.now() - 86400000).toISOString(),
    { id: "1", name: "T1", code: "T1", result: { gameWins: 2, outcome: "win" } },
    { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: "loss" } }
  ),
  rawEvent(
    "h2h-2",
    "completed",
    new Date(Date.now() - 2 * 86400000).toISOString(),
    { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 2, outcome: "win" } },
    { id: "1", name: "T1", code: "T1", result: { gameWins: 0, outcome: "loss" } }
  ),
  rawEvent(
    "h2h-unrelated",
    "completed",
    new Date().toISOString(),
    { id: "1", name: "T1", code: "T1", result: { gameWins: 2, outcome: "win" } },
    { id: "3", name: "Dplus KIA", code: "DK", result: { gameWins: 0, outcome: "loss" } }
  ),
  rawEvent(
    "search-seed",
    "unstarted",
    new Date(Date.now() + 3600000).toISOString(),
    { id: "4", name: "Karmine Corp", code: "KC", result: null },
    { id: "5", name: "AG.AL", code: "AGAL", result: null }
  ),
];

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [{ id: "lck", name: "LCK", slug: "lck" }, { id: "lec", name: "LEC", slug: "lec" }] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: FIXTURE_EVENTS, pages: { older: null, newer: null } } } }) };
    if (u.includes("/getCompletedEvents")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  // init() (called unconditionally at the bottom of app.js) fetches leagues + the initial schedule
  // on its own - this just needs to wait long enough for those already-mocked, already-resolved
  // fetches to settle, which populates the real scheduleCache/curatedLeagues via the app's own code.
  await new Promise((r) => setTimeout(r, 30));

  // ============ Favorites ============
  check("A team starts out not favorited", window.isFavoriteTeam("T1") === false);
  const nowFav = window.toggleFavoriteTeam("T1");
  check("toggleFavoriteTeam returns true when adding", nowFav === true);
  check("isFavoriteTeam reflects the add", window.isFavoriteTeam("T1") === true);
  const nowUnfav = window.toggleFavoriteTeam("T1");
  check("toggleFavoriteTeam returns false when removing", nowUnfav === false);
  check("isFavoriteTeam reflects the remove", window.isFavoriteTeam("T1") === false);
  window.toggleFavoriteTeam("T1");
  window.toggleFavoriteTeam("GEN");
  check("getFavoriteTeams contains both favorited codes", window.getFavoriteTeams().includes("T1") && window.getFavoriteTeams().includes("GEN"));

  const starHtml = window.favoriteStarHtml("T1");
  check("favoriteStarHtml renders an active star for a favorited team", starHtml.includes("active") && starHtml.includes("★"));
  const starHtmlInactive = window.favoriteStarHtml("KC");
  check("favoriteStarHtml renders an inactive star for a non-favorited team", !starHtmlInactive.includes("active") && starHtmlInactive.includes("☆"));

  // Delegated click handling - render a star into the live DOM and click it
  window.document.body.innerHTML += `<div id="star-test-slot">${window.favoriteStarHtml("KC")}</div>`;
  const starBtn = window.document.querySelector("#star-test-slot .favorite-star");
  starBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  check("Clicking a favorite-star button toggles the underlying favorite via delegation", window.isFavoriteTeam("KC") === true);
  check("Clicking updates the button's own visual state", starBtn.classList.contains("active") && starBtn.textContent === "★");

  // eventInvolvesFavoriteTeam / My Teams filter
  const evWithFav = { id: "e1", teams: [{ code: "T1" }, { code: "DK" }] };
  const evWithoutFav = { id: "e2", teams: [{ code: "DK" }, { code: "BLG" }] };
  check("eventInvolvesFavoriteTeam is true when a favorited team is in the match", window.eventInvolvesFavoriteTeam(evWithFav));
  check("eventInvolvesFavoriteTeam is false when neither team is favorited", !window.eventInvolvesFavoriteTeam(evWithoutFav));

  // ============ Notifications feature removed entirely (per explicit request) ============
  check("The notify-toggle button no longer exists anywhere in the DOM", !window.document.getElementById("notify-toggle"));
  check("checkFavoriteNotifications no longer exists", typeof window.checkFavoriteNotifications === "undefined");
  check("initNotificationsToggle no longer exists", typeof window.initNotificationsToggle === "undefined");
  check("getNotifyEnabled no longer exists", typeof window.getNotifyEnabled === "undefined");
  check("sendLolggNotification no longer exists", typeof window.sendLolggNotification === "undefined");

  // ============ Head-to-head (scheduleCache populated for real via init()'s own getSchedule call) ============
  check("scheduleCache picked up the fixture events via the real getSchedule() flow", window.recentGamesForTeam("T1", 10).length >= 3);
  const h2hGames = window.headToHeadGames("T1", "GEN", "current-event-id", 10);
  check("headToHeadGames finds exactly the 2 matches between these two teams", h2hGames.length === 2);
  check("headToHeadGames excludes matches against a third team", !h2hGames.some((e) => e.id === "h2h-unrelated"));
  const h2hHtml = window.headToHeadHtml([{ code: "T1", name: "T1" }, { code: "GEN", name: "Gen.G" }], "current-event-id");
  check("headToHeadHtml renders the win-loss tally", h2hHtml.includes("T1 1 - 1 GEN"));
  check("headToHeadHtml lists both historical matches", (h2hHtml.match(/recent-match-row/g) || []).length === 2);
  const h2hEmptyHtml = window.headToHeadHtml([{ code: "T1", name: "T1" }, { code: "BLG", name: "Bilibili Gaming" }], "current-event-id");
  check("headToHeadHtml shows a no-history message for a pair with no prior meetings", h2hEmptyHtml.includes("No previous meetings"));
  const h2hExcludingSelf = window.headToHeadGames("T1", "DK", "h2h-unrelated", 10);
  check("headToHeadGames excludes the current match itself from its own history", h2hExcludingSelf.length === 0);

  // ============ Roster feature removed ============
  // The Team Roster section was pulled entirely (its underlying data source, /getTeams, never
  // reliably resolved for every team the way the rest of the site does) - confirm the function is
  // actually gone rather than just unused, so it can't silently come back half-wired.
  check("teamRosterHtml has been removed along with the Roster section", window.teamRosterHtml === undefined);

  // ============ Search ============
  const leagueSearch = window.siteSearchResults("lck");
  check("Searching a league name returns that league", leagueSearch.some((r) => r.type === "league" && r.id === "lck"));
  const teamSearchByName = window.siteSearchResults("karmine");
  check("Searching a team's display name finds it", teamSearchByName.some((r) => r.type === "team" && r.id === "KC"));
  const teamSearchByCode = window.siteSearchResults("agal");
  check("Searching a team's code finds it (case-insensitive)", teamSearchByCode.some((r) => r.type === "team" && r.id === "AGAL"));
  check("Empty query returns no results", window.siteSearchResults("").length === 0);
  check("siteSearchResultHref points a league result at the tournament page", window.siteSearchResultHref({ type: "league", id: "lck" }) === "#/tournament/lck");
  check("siteSearchResultHref points a team result at the team page", window.siteSearchResultHref({ type: "team", id: "KC" }) === "#/team/KC");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
