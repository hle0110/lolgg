const fs = require("fs");
const { JSDOM } = require("jsdom");

const WORLDS = { id: "98767975604431411", slug: "worlds", name: "Worlds", image: "" };
const T2026 = { id: "115660540725177488", slug: "worlds_2026", startDate: "2026-10-15", endDate: "2026-11-14" };
const T2025 = { id: "old", slug: "worlds_2025", startDate: "2025-10-14", endDate: "2025-11-09" };

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  w.eval(app);
  await new Promise((r) => setTimeout(r, 80));

  const entry = w.officialLeagueStreamEntry(WORLDS);
  check("Worlds now has an official stream entry at all", !!entry);
  check(
    "Worlds official streams include the Riot Twitch channel",
    !!entry && entry.links.some((l) => l.url === "https://www.twitch.tv/riotgames")
  );
  check("Worlds official streams still include YouTube", !!entry && entry.links.some((l) => l.label === "YouTube"));
  check(
    "MSI and First Stand also point at the Riot Twitch channel",
    (w.officialLeagueStreamEntry({ name: "MSI" }) || { links: [] }).links.some((l) => l.url === "https://www.twitch.tv/riotgames") &&
      (w.officialLeagueStreamEntry({ name: "First Stand" }) || { links: [] }).links.some((l) => l.url === "https://www.twitch.tv/riotgames")
  );
  check(
    "Existing regional streams are untouched",
    (w.officialLeagueStreamEntry({ name: "LCK" }) || { links: [] }).links.some((l) => l.url.includes("twitch.tv/lck"))
  );

  const q = w.knownQualifiedTeams(WORLDS, T2026);
  check("All 16 currently qualified Worlds teams are available as a fallback", q.length === 16);
  check(
    "The list matches Riot's published qualifiers",
    ["GEN", "T1", "HLE", "DK", "AL", "BLG", "TES", "IG", "G2", "KC", "MKOI", "C9", "TLAW", "CFO", "MVK", "TSW"].every((c) =>
      q.some((t) => t.code === c)
    )
  );
  check("No TBD placeholder is invented in the fallback list", q.every((t) => t.code !== "TBD"));
  check("Fallback teams do NOT leak onto a previous Worlds tournament", w.knownQualifiedTeams(WORLDS, T2025).length === 0);
  check("Fallback teams do NOT apply to other leagues", w.knownQualifiedTeams({ name: "LCK" }, T2026).length === 0);
  check("Fallback teams do not apply when the tournament has no start date", w.knownQualifiedTeams(WORLDS, {}).length === 0);

  const grid = w.teamsGridHtml(q);
  check("The fallback teams render as clickable team cards", (grid.match(/class="team-card/g) || []).length === 16);
  check("Team logos are served over https, never mixed-content http", !/src="http:\/\//.test(grid) && /src="https:\/\/static\.lolesports\.com/.test(grid));
  check("safeImageUrl upgrades a plain http image URL to https", w.safeImageUrl("http://static.lolesports.com/x.png") === "https://static.lolesports.com/x.png");
  check("safeImageUrl still rejects a javascript: URL", w.safeImageUrl("javascript:alert(1)") === "");

  check(
    "Real standings data still wins over the fallback",
    /const teams = standingsTeams\.length \? standingsTeams : fallbackTeams;/.test(app)
  );
  check(
    "The duplicate 'Full tournament page on Liquipedia' link was removed",
    !/Full tournament page on Liquipedia/.test(app)
  );
  check(
    "The Bracket section still offers its Liquipedia and Leaguepedia lookups",
    /Look it up on Liquipedia/.test(app) && /Look it up on Leaguepedia/.test(app)
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
