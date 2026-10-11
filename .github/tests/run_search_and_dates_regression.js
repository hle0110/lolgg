const fs = require("fs");
const { JSDOM } = require("jsdom");

const CUP = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_cup_2026.json", "utf8"));
const J = (d, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => d, text: async () => "" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?status=completed", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getLeagues")) return J({ data: { leagues: CUP.leagues } });
    if (s.includes("/getSchedule")) {
      const id = new URL(s).searchParams.get("leagueId");
      return J({ data: { schedule: { events: CUP.schedule[id] || [], pages: { older: null, newer: null } } } });
    }
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1000);

  const cblol = CUP.leagues.find((l) => l.slug === "cblol-brazil");
  check("Real capture: CBLOL is not a curated league", !w.isMajorLeague(cblol));
  const found = w.siteSearchResults("cblol");
  check("Search finds a league outside the curated list (CBLOL)", found.some((r) => r.type === "league" && r.id === cblol.id));
  check("That result opens the CBLOL tournament page", found.length && w.siteSearchResultHref(found[0]) === `#/tournament/${cblol.id}`);

  const input = w.document.getElementById("site-search-input");
  const box = w.document.getElementById("site-search-results");
  input.value = "zzzz";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  check("A search with no results says so", box.classList.contains("open") && box.textContent.includes("No teams or leagues match."));
  input.value = "";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  check("Clearing the search closes the results", !box.classList.contains("open") && box.textContent === "");

  const clock = w.document.getElementById("top-clock-date").textContent;
  check("Header clock shows the full year", /\b20\d{2}\b/.test(clock));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
