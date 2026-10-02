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

function rawEvent(id, state, startTimeIso, teamA, teamB, leagueImage) {
  return {
    type: "match",
    startTime: startTimeIso,
    state,
    blockName: "",
    league: { id: "lec", name: "LEC", slug: "lec", image: leagueImage || "https://example.com/lec.png" },
    match: { id, strategy: { count: 1 }, teams: [teamA, teamB] },
  };
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const dom = makeDom();
  const { window } = dom;

  // ---- Fixture: recentWinRate is each team's OVERALL record (it doesn't exclude games against any
  // particular opponent), so their 3 head-to-head meetings count toward their overall form too. To
  // build a genuine "overall form tied, but head-to-head is decisive" scenario, T1 gets 3 extra
  // losses (against other opponents) and GEN gets 3 extra wins, so once their 3 head-to-head games
  // (T1 sweeps 3-0) are folded in, both land at exactly 50% overall - forcing the prediction to lean
  // on head-to-head to break the tie, since recent form alone genuinely can't.
  const events = [
    rawEvent("form-t1-l1", "completed", new Date(Date.now() - 13 * 86400000).toISOString(), { id: "1", name: "T1", code: "T1", result: { gameWins: 0, outcome: "loss" } }, { id: "3", name: "Karmine Corp", code: "KC", result: { gameWins: 1, outcome: "win" } }),
    rawEvent("form-t1-l2", "completed", new Date(Date.now() - 12 * 86400000).toISOString(), { id: "1", name: "T1", code: "T1", result: { gameWins: 0, outcome: "loss" } }, { id: "4", name: "Dplus KIA", code: "DK", result: { gameWins: 1, outcome: "win" } }),
    rawEvent("form-t1-l3", "completed", new Date(Date.now() - 11 * 86400000).toISOString(), { id: "1", name: "T1", code: "T1", result: { gameWins: 0, outcome: "loss" } }, { id: "6", name: "JD Gaming", code: "JDG", result: { gameWins: 1, outcome: "win" } }),
    rawEvent("form-gen-w1", "completed", new Date(Date.now() - 10 * 86400000).toISOString(), { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 1, outcome: "win" } }, { id: "5", name: "Bilibili Gaming", code: "BLG", result: { gameWins: 0, outcome: "loss" } }),
    rawEvent("form-gen-w2", "completed", new Date(Date.now() - 9 * 86400000).toISOString(), { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 1, outcome: "win" } }, { id: "9", name: "Hanwha Life Esports", code: "HLE", result: { gameWins: 0, outcome: "loss" } }),
    rawEvent("form-gen-w3", "completed", new Date(Date.now() - 8 * 86400000).toISOString(), { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 1, outcome: "win" } }, { id: "10", name: "Royal Never Give Up", code: "RNG", result: { gameWins: 0, outcome: "loss" } }),
    // T1 vs GEN head-to-head: T1 wins all 3
    rawEvent("h2h-1", "completed", new Date(Date.now() - 6 * 86400000).toISOString(), { id: "1", name: "T1", code: "T1", result: { gameWins: 1, outcome: "win" } }, { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: "loss" } }),
    rawEvent("h2h-2", "completed", new Date(Date.now() - 5 * 86400000).toISOString(), { id: "1", name: "T1", code: "T1", result: { gameWins: 1, outcome: "win" } }, { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: "loss" } }),
    rawEvent("h2h-3", "completed", new Date(Date.now() - 4 * 86400000).toISOString(), { id: "1", name: "T1", code: "T1", result: { gameWins: 1, outcome: "win" } }, { id: "2", name: "Gen.G", code: "GEN", result: { gameWins: 0, outcome: "loss" } }),
  ];

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events, pages: { older: null, newer: null } } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  // ============ AI Prediction: ONE blended percentage combining recent form + head-to-head ============
  const t1 = { code: "T1", name: "T1" };
  const gen = { code: "GEN", name: "Gen.G" };
  check("Overall recent form is confirmed tied (50/50) before checking the head-to-head blend", window.recentWinRate("T1", 20).winRatePct === window.recentWinRate("GEN", 20).winRatePct);
  const pctTied = window.computePredictionPct([t1, gen], null);
  check("computePredictionPct returns a single pctA/pctB pair, not two separate signals", typeof pctTied.pctA === "number" && pctTied.pctA + pctTied.pctB === 100);
  check("With tied recent form (50/50) but a 3-0 head-to-head sweep, T1's blended percentage is pulled well above 50%", pctTied.pctA === 73 && pctTied.pctB === 27);
  const predictionTied = window.predictionHtml([t1, gen], null);
  check("The rendered prediction shows a single percentage bar with both teams' numbers", predictionTied.includes('class="prediction-bar"') && predictionTied.includes("T1 73%") && predictionTied.includes("GEN 27%"));
  check("The prediction text names the favored team with its percentage, plus both underlying bases (form and head-to-head) in one place", predictionTied.includes("T1 favored 73% to win") && predictionTied.includes("Recent form:") && predictionTied.includes("Head-to-head: T1 3-0 GEN"));

  // Pair with a clear recent-form gap and NO head-to-head history at all (KC beat T1 once, 100%; BLG
  // lost to GEN once, 0%; KC and BLG never played each other in this fixture).
  const kc = { code: "KC", name: "Karmine Corp" };
  const blg = { code: "BLG", name: "Bilibili Gaming" };
  const pctFormOnly = window.computePredictionPct([kc, blg], null);
  check("With no head-to-head data at all, the blend falls back to pure (clamped) recent form", pctFormOnly.pctA === 92 && pctFormOnly.pctB === 8);
  const predictionFormBased = window.predictionHtml([kc, blg], null);
  check("The rendered prediction names KC as favored and omits a head-to-head line when there isn't one", predictionFormBased.includes("KC favored 92% to win") && !/head-to-head/i.test(predictionFormBased));

  const predictionNoHistory = window.predictionHtml([{ code: "ZZZ", name: "Unknown A" }, { code: "YYY", name: "Unknown B" }], null);
  check("Two teams with zero history of any kind still get the original no-data message", predictionNoHistory.includes("nothing to base a prediction on"));
  check("computePredictionPct returns null (not a broken 50/50 guess) when there's no data at all", window.computePredictionPct([{ code: "ZZZ" }, { code: "YYY" }], null) === null);

  // currentEventId exclusion still works the same way for the prediction's head-to-head component as
  // it does for the H2H list itself - excluding one of T1's 3 wins over GEN leaves a 2-0 record
  // (weaker signal, weighted less at only 2 meetings), which should pull the percentage down from 73%
  // but still keep T1 favored.
  const pctExcludingCurrent = window.computePredictionPct([t1, gen], "h2h-3");
  check("Excluding the current match from an otherwise-decisive head-to-head record changes the blended percentage", pctExcludingCurrent.pctA === 65 && pctExcludingCurrent.h2hGames.length === 2);

  // ============ Head-to-head rows show the tournament/league logo on the left ============
  const h2hHtml = window.headToHeadHtml([t1, gen], null);
  check("Each head-to-head row includes the league logo image", (h2hHtml.match(/league-logo/g) || []).length >= 3);
  check("The league logo appears before (to the left of) the match-teams block in each row's markup", /league-logo[\s\S]*?<\/svg>|<img[^>]*league-logo[^>]*>[\s\S]*?match-teams/.test(h2hHtml) || h2hHtml.indexOf("league-logo") < h2hHtml.indexOf("match-teams"));
  check("The league logo src points at the league's image", h2hHtml.includes("lec.png"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
