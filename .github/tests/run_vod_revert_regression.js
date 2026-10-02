const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom(matchId) {
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
  </body></html>`, { url: `https://example.com/#/match/${matchId}`, runScripts: "outside-only" });
}

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check("The per-game VOD grouping (gamesWithVods) has been fully removed", !/gamesWithVods/.test(app));
  check("The offset-based timestamp seeking helpers have been fully removed", !/vodSeekSeconds|twitchTimeParam/.test(app));
  check("normalizeVod no longer carries an offset field", !/offset: typeof v\.offset/.test(app));
  check("embedUrlForVod is back to its plain pre-timestamp form (no start=/time= params)", !/embedUrlForVod[\s\S]{0,400}?(start=|time=)/.test(app));

  const dom = makeDom("bo3-reverted");
  const { window } = dom;
  const startTime = new Date(Date.now() - 3 * 3600000).toISOString();

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: "bo3-reverted",
              state: "completed",
              startTime,
              streams: [],
              match: {
                strategy: { count: 3 },
                teams: [
                  { id: "t1", name: "T1", code: "T1", result: { gameWins: 2, outcome: "win" } },
                  { id: "t2", name: "Gen.G", code: "GEN", result: { gameWins: 1, outcome: "loss" } },
                ],
                games: [
                  { id: "g1", number: 1, state: "completed", teams: [], vods: [{ provider: "youtube", parameter: "revertedvo1", offset: 0, locale: "en-US" }] },
                  { id: "g2", number: 2, state: "completed", teams: [], vods: [{ provider: "youtube", parameter: "revertedvo2", offset: 1830000, locale: "en-US" }] },
                ],
              },
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(app);
  await new Promise((r) => setTimeout(r, 20));

  const event = {
    id: "bo3-reverted",
    startTime,
    state: "completed",
    blockName: "Playoffs",
    bestOf: 3,
    league: { id: "L1", name: "LCK", slug: "lck" },
    teams: [{ id: "t1", name: "T1", code: "T1" }, { id: "t2", name: "Gen.G", code: "GEN" }],
  };
  await window.paintMatchPage("bo3-reverted", event);
  await new Promise((r) => setTimeout(r, 20));
  const matchMainEl = window.document.getElementById("match-main");

  check("No 'Game N' per-game labels appear anymore", !/>Game \d</.test(matchMainEl.innerHTML));
  check("Both games' VODs are merged into a single locale-switch list, as before", matchMainEl.innerHTML.includes("locale-switch"));
  check("Exactly one poster is shown up front (single merged section, not one per game)", matchMainEl.querySelectorAll(".stream-poster").length === 1);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
