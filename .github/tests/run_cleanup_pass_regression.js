const fs = require("fs");
const { JSDOM } = require("jsdom");

function makeDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="tz-picker"><div id="site-search"><input id="site-search-input" /><div id="site-search-results"></div></div></div>
    <div id="top-clock"><select id="tz-select"></select><span id="top-clock-date"></span><span id="top-clock-time"></span></div>
    <div id="event-toast-container"></div>
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

  const majorLeague = { id: "L1", name: "LCK", slug: "lck", image: "" };

  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/getLeagues")) {
      return { ok: true, json: async () => ({ data: { leagues: [majorLeague] } }) };
    }
    if (u.includes("/getSchedule")) {
      return { ok: true, json: async () => ({ data: { schedule: { events: [], pages: { older: null, newer: null } } } }) };
    }
    if (u.includes("/getTournamentsForLeague")) {
      return { ok: true, json: async () => ({ data: { leagues: [{ tournaments: [{ id: "t1", startDate: "2026-07-01T00:00:00Z", endDate: "2026-07-30T00:00:00Z" }] }] } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };

  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 20));

  check("The tournament-ongoing banner function no longer exists", typeof window.loadTournamentBanner === "undefined");

  const tzSelect = window.document.getElementById("tz-select");
  check("The timezone select still gets populated with options inside the clock pill", tzSelect.options.length > 0);
  const tzValues = [...tzSelect.options].map((o) => o.value);
  check("Timezone list covers global users (Brazil, Vietnam, Japan, Australia)", ["America/Sao_Paulo", "Asia/Ho_Chi_Minh", "Asia/Tokyo", "Australia/Sydney"].every((z) => tzValues.includes(z)));
  check("The Auto option label is short (no longer 'Auto (this device)')", tzSelect.options[0].textContent === "Auto");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
