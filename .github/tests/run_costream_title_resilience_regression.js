const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div><div id="theme-toggle"></div></div>
    <div id="top-clock"><select id="tz-select"></select><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
    <div id="offline-banner" class="hidden"></div>
    <div id="fatal-error-banner" class="hidden"></div>
    <nav id="tabs">
      <div class="seg"><button type="button" class="seg-btn" data-view="matches">Matches</button><button type="button" class="seg-btn" data-view="tournaments">Tournaments</button></div>
      <div class="seg"><button type="button" class="seg-btn" data-status="live">Live</button><button type="button" class="seg-btn" data-status="upcoming">Upcoming</button><button type="button" class="seg-btn" data-status="completed">Results</button></div>
    </nav>
    <div id="home-view"><div id="league-filter"></div><main id="esports-main"><section id="tab-content"></section></main></div>
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

  let titleFetchMode = "success";
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("/getSchedule")) return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    if (u.includes("decapi.me/twitch/title/")) {
      if (titleFetchMode === "success") {
        return { ok: true, text: async () => "LEC G2 VS KOI" };
      }
      if (titleFetchMode === "servererror") {
        return { ok: false, text: async () => "" };
      }
      throw new Error("network down");
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 30));

  const firstTitle = await window.decapiTwitchTitle("caedrel");
  check("A successful title fetch returns the real title", firstTitle === "LEC G2 VS KOI");

  titleFetchMode = "networkerror";
  const duringOutage = await window.decapiTwitchTitle("caedrel");
  check("A transient network failure right after a known-good title falls back to the last good title instead of going blank", duringOutage === "LEC G2 VS KOI");

  titleFetchMode = "servererror";
  const duringServerError = await window.decapiTwitchTitle("caedrel");
  check("A non-ok response also falls back to the last known-good title instead of going blank", duringServerError === "LEC G2 VS KOI");

  const freshLogin = await window.decapiTwitchTitle("brandnewchannel");
  check("A channel with no prior successful fetch and a current failure safely returns an empty string (no false match)", freshLogin === "");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
