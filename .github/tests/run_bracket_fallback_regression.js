const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><select id="tz-select"></select></div>
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
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    // Empty schedule/standings/completed-events - the exact "no bracket data yet" case for an
    // upcoming tournament Riot hasn't populated bracket data for.
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    if (u.includes("/getCompletedEvents")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    if (u.includes("/getStandings")) return { ok: true, json: async () => ({ data: { standings: [] } }) };
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [] } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  // --- Direct unit check of the fallback helper itself ---
  const fallback = window.externalBracketFallbackHtml({ id: "ewc", name: "Esports World Cup" });
  check("Fallback includes a Liquipedia search link", fallback.includes("liquipedia.net/leagueoflegends/Special:Search"));
  check("Fallback includes a Leaguepedia (lol.fandom.com) search link", fallback.includes("lol.fandom.com/wiki/Special:Search"));
  check("Fallback URL-encodes the league name", fallback.includes(encodeURIComponent("Esports World Cup")));
  check("Fallback explains bracket isn't available yet", fallback.includes("isn't available") && /class="idle"/.test(fallback));

  // Handles a missing league gracefully (no throw, still produces valid search URLs with empty query)
  let noLeagueOk = true;
  let noLeagueHtml = "";
  try {
    noLeagueHtml = window.externalBracketFallbackHtml(null);
  } catch {
    noLeagueOk = false;
  }
  check("Fallback helper doesn't throw when league is null/undefined", noLeagueOk);
  check("Fallback still includes both search links when league is null", noLeagueHtml.includes("liquipedia.net") && noLeagueHtml.includes("lol.fandom.com"));

  // --- Full buildTournamentContentHtml integration: no bracket data available ---
  // Deliberately NOT EWC here - EWC has hardcoded playoff-bracket overrides (EWC_PLAYOFFS_QF_OVERRIDE)
  // that inject bracket data regardless of what the mocked API returns, which would defeat this
  // "genuinely no data yet" scenario. A generic league has no such override.
  const league = { id: "lck", name: "LCK", slug: "lck" };
  const tournament = { id: "t1", startDate: "2026-07-01T00:00:00Z", endDate: "2026-07-30T00:00:00Z" };
  const html = await window.buildTournamentContentHtml("lck", tournament, league);
  check("Bracket heading is always shown, even with no bracket data", /<h3>Bracket<\/h3>/.test(html));
  check("Bracket section falls back to the Liquipedia/Leaguepedia links when empty", html.includes("liquipedia.net/leagueoflegends/Special:Search") && html.includes("lol.fandom.com/wiki/Special:Search"));
  check("Fallback query is scoped to this tournament's league name", html.includes(encodeURIComponent("LCK")));

  // --- Regression: when real bracket data IS available, the real bracket renders, not the fallback ---
  const originalBracketFn = window.tournamentBracketByBlockHtml;
  window.tournamentBracketByBlockHtml = () => `<div class="bracket-column-title">Quarterfinals</div>`;
  const htmlWithBracket = await window.buildTournamentContentHtml("lck", tournament, league);
  check("Real bracket data renders normally (no fallback links) when available", htmlWithBracket.includes("Quarterfinals") && !htmlWithBracket.includes("lol.fandom.com"));
  check("Bracket heading still present when real data renders", /<h3>Bracket<\/h3>/.test(htmlWithBracket));
  window.tournamentBracketByBlockHtml = originalBracketFn;

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
