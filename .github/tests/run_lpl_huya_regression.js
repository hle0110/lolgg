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

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) return { ok: true, json: async () => ({ data: { leagues: [] } }) };
    if (u.includes("decapi.me/twitch/uptime")) return { ok: true, text: async () => "OFFLINE" };
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  const lplLeague = { id: "lpl-id", name: "LPL", slug: "lpl", image: "" };
  const html = await window.officialStreamLinksHtml(lplLeague, null);

  check("LPL's official stream links include a Huya link", html.includes("https://www.huya.com/lpl"));
  check("The Huya link is labeled clearly", html.includes("Huya"));
  check("Twitch is still present alongside Huya", html.includes("https://www.twitch.tv/lplenglish"));
  check("YouTube is still present alongside Huya", html.includes("https://www.youtube.com/@LPL_English"));
  check("Huya opens in a new tab like the other official links", /href="https:\/\/www\.huya\.com\/lpl"[^>]*target="_blank"/.test(html));

  // Other leagues (e.g. LCK) are unaffected - Huya is LPL-only
  const lckLeague = { id: "lck-id", name: "LCK", slug: "lck", image: "" };
  const lckHtml = await window.officialStreamLinksHtml(lckLeague, null);
  check("Huya is not added to other leagues (LCK)", !lckHtml.includes("huya"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  if (failed.length) process.exit(1);
})();
