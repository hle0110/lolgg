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

async function checkLeagueFallback({ app, leagueSlug, leagueName, expectedTwitchLogin }) {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const matchId = `${leagueSlug}-no-embed-1`;
  const dom = makeDom(matchId);
  const { window } = dom;

  const leagueRaw = { id: `${leagueSlug}-id`, name: leagueName, slug: leagueSlug, image: "" };
  const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rawEvent = {
    type: "match",
    id: matchId,
    startTime,
    state: "inProgress",
    blockName: "Week 2",
    league: leagueRaw,
    match: {
      id: matchId,
      strategy: { count: 3 },
      teams: [
        { id: "a", name: "Team A", code: "TA", result: { gameWins: 0, outcome: null } },
        { id: "b", name: "Team B", code: "TB", result: { gameWins: 0, outcome: null } },
      ],
    },
  };

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [leagueRaw] } }) };
    if (u.includes("decapi.me/twitch/uptime")) return { ok: true, text: async () => "OFFLINE" };
    if (u.includes("/getLive")) return { ok: true, json: async () => ({ data: { schedule: { events: [rawEvent] } } }) };
    if (u.includes("/getSchedule")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [rawEvent], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [] }] } }) };
    if (u.includes("/getEventDetails")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            event: {
              id: matchId,
              state: "inProgress",
              startTime,
              streams: [{ provider: "unsupported-regional-provider", parameter: "some-channel-id", locale: "regional" }],
              match: {
                strategy: { count: 3 },
                teams: rawEvent.match.teams,
                games: [{ id: "g1", number: 1, state: "inProgress", teams: [] }],
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

  await window.renderMatchPage(matchId);
  await new Promise((r) => setTimeout(r, 20));
  const matchMainEl = window.document.getElementById("match-main");

  check(
    `${leagueName}: poster prompts to play on Twitch instead of showing a dead-end for the unsupported provider`,
    matchMainEl.innerHTML.includes("Click to play on Twitch")
  );
  check(
    `${leagueName}: fallback hint explains this is the official league channel`,
    matchMainEl.innerHTML.includes(`official ${leagueName} Twitch channel`)
  );

  const posterBtn = matchMainEl.querySelector(".stream-poster");
  if (posterBtn) posterBtn.click();
  await new Promise((r) => setTimeout(r, 20));

  check(
    `${leagueName}: clicking play embeds the correct official Twitch channel (${expectedTwitchLogin})`,
    matchMainEl.innerHTML.includes(`player.twitch.tv/?channel=${expectedTwitchLogin}`)
  );
  check(
    `${leagueName}: the unsupported-embed message does not appear once the official-channel fallback kicks in`,
    !matchMainEl.innerHTML.includes("isn't supported for embedding")
  );

  return results;
}

(async () => {
  const allResults = [];
  const check = (name, cond) => allResults.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check("isLplLeague/LPL_OFFICIAL_TWITCH_CHANNEL were removed in favor of a league-agnostic fallback", !/function isLplLeague\(league\)/.test(app) && !/LPL_OFFICIAL_TWITCH_CHANNEL/.test(app));
  check(
    "paintMatchPage's stream fallback now applies to any curated league with a known official Twitch channel, not just LPL",
    /else if \(!liveStreamItems\.length && state === "inProgress"\) {/.test(app) &&
      /const knownLeagueTwitch = officialLeagueStreamEntry\(league\);/.test(app)
  );

  for (const cfg of [
    { leagueSlug: "lpl", leagueName: "LPL", expectedTwitchLogin: "lplenglish" },
    { leagueSlug: "lck", leagueName: "LCK", expectedTwitchLogin: "lck" },
    { leagueSlug: "lec", leagueName: "LEC", expectedTwitchLogin: "lec" },
    { leagueSlug: "lcs", leagueName: "LCS", expectedTwitchLogin: "lcs" },
  ]) {
    const results = await checkLeagueFallback({ app, ...cfg });
    allResults.push(...results);
  }

  const failed = allResults.filter((r) => !r.pass);
  console.log(`\n${allResults.length - failed.length}/${allResults.length} checks passed`);
  for (const r of allResults) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
