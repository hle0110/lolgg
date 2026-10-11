const fs = require("fs");
const { JSDOM } = require("jsdom");

const CUP = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_cup_2026.json", "utf8"));
const LEC = CUP.leagues.find((l) => l.slug === "lec");
const CBLOL = CUP.leagues.find((l) => l.slug === "cblol-brazil");
const J = (d, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => d, text: async () => "" });
const wrap = (events) => ({ data: { schedule: { events, pages: { older: null, newer: null } } } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  let lecFails = false;
  let lecRequests = 0;
  let skew = 0;
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/?status=completed&leagues=lec,cblol-brazil", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const realNow = w.Date.now.bind(w.Date);
  w.Date.now = () => realNow() + skew;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/getSchedule")) {
      const id = new URL(s).searchParams.get("leagueId");
      if (id === LEC.id) {
        lecRequests++;
        if (lecFails) return J({}, 500);
      }
      return J(wrap(CUP.schedule[id] || []));
    }
    if (s.includes("/getLeagues")) return J({ data: { leagues: CUP.leagues } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await wait(1000);

  const tab = () => w.document.getElementById("tab-content").innerHTML;
  const lecMatch = CUP.schedule[LEC.id][CUP.schedule[LEC.id].length - 1].match.id;
  const cblolMatch = CUP.schedule[CBLOL.id][CUP.schedule[CBLOL.id].length - 1].match.id;
  const shows = (id) => tab().includes(`#/match/${id}"`);
  const poll = async () => {
    await w.getSchedule([LEC.id, CBLOL.id]);
    w.loadActiveTab(true);
    await wait(300);
  };

  check("Results tab shows LEC and CBLOL matches at first", shows(lecMatch) && shows(cblolMatch));

  skew = 91 * 1000;
  lecFails = true;
  const before = lecRequests;
  await poll();
  check("LEC schedule request failed on this poll", lecRequests > before);
  check("LEC matches stay visible after its schedule fetch fails", shows(lecMatch));
  check("CBLOL matches are unaffected", shows(cblolMatch));

  skew += 20 * 1000;
  lecFails = false;
  const beforeRetry = lecRequests;
  await poll();
  check("Next poll asks for LEC again instead of serving a cached failure", lecRequests > beforeRetry);
  check("LEC matches are shown after the next poll", shows(lecMatch) && shows(cblolMatch));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
