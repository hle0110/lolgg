const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const hour = 3600000;
const now = Date.now();
const ev = (id, start, state, a, b) => ({
  type: "match", id, startTime: new Date(start).toISOString(), state, blockName: "Playoffs", league: { name: "LCK", slug: "lck" },
  match: { id, strategy: { count: 5 }, teams: [{ id: a, name: a, code: a, result: { gameWins: 0, outcome: null } }, { id: b, name: b, code: b, result: { gameWins: 0, outcome: null } }] },
});
const midday = new Date();
midday.setHours(12, 0, 0, 0);
const events = [
  ev("TODAY1", midday.getTime() - 2 * hour, "completed", "GEN", "T1"),
  ev("TODAY2", midday.getTime() + 2 * hour, "unstarted", "HLE", "DK"),
  ev("TMRW", midday.getTime() + 26 * hour, "unstarted", "KT", "NS"),
];
const dom = new JSDOM(html, { url: "https://example.com/lolgg/#/?status=today", runScripts: "outside-only" });
const w = dom.window;
w.fetch = async (url) => {
  const u = String(url);
  const ok = (data) => ({ ok: true, json: async () => ({ data }) });
  if (u.includes("/getLeagues")) return ok({ leagues: [{ id: "L1", name: "LCK", slug: "lck", image: "" }] });
  if (u.includes("/getLive")) return ok({ schedule: { events: [] } });
  if (u.includes("/getSchedule")) return ok({ schedule: { events, pages: {} } });
  return ok({ leagues: [{ tournaments: [] }], standings: [] });
};
w.Notification = undefined;
w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
w.HTMLElement.prototype.scrollTo = () => {};

(async () => {
  w.eval(app);
  await tick(300);
  const d = w.document;
  const tab = d.getElementById("tab-content").textContent;
  check("Today button exists between Live and Upcoming", [...d.querySelectorAll("#tabs [data-status]")].map((b) => b.dataset.status).join(",") === "live,today,upcoming,completed");
  check("status=today in the URL opens the Today tab", d.querySelector('[data-status="today"]').classList.contains("active"));
  check("Today lists today's finished and upcoming matches", tab.includes("GEN") && tab.includes("HLE"));
  check("Today leaves out tomorrow", !tab.includes("KT"));
  check("Nav marks the active view without colliding with button selectors", d.getElementById("tabs").dataset.activeView === "matches" && d.querySelectorAll("[data-view]").length === 2);
  const css = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  check("Today is hidden in the Tournaments view", /\.site-nav\[data-active-view="tournaments"\] \[data-status="today"\]\s*{\s*display: none/.test(css));
  check("Home page title is plain lolgg", d.title === "lolgg");

  check("Time zone picker has an accessible name", d.getElementById("tz-select").getAttribute("aria-label") === "Time zone");

  const t = (start, end) => ({ id: start, startDate: start, endDate: end });
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const past = t(iso(now - 300 * 24 * hour), iso(now - 270 * 24 * hour));
  const soon = t(iso(now + 10 * 24 * hour), iso(now + 40 * 24 * hour));
  const far = t(iso(now + 30 * 24 * hour), iso(now + 60 * 24 * hour));
  check("An event starting within 14 days opens by default (Worlds 2026 case)", w.pickDisplayTournament([past, soon]) === soon);
  check("An event more than 14 days away does not replace the last finished one", w.pickDisplayTournament([past, far]) === past);

  let shared = null;
  Object.defineProperty(w.navigator, "share", { value: async (data) => (shared = data), configurable: true });
  const btn = d.createElement("button");
  btn.className = "share-btn";
  d.body.appendChild(btn);
  btn.click();
  await tick(20);
  check("Share uses the phone share sheet with the page URL", shared && shared.url === w.location.href);
  Object.defineProperty(w.navigator, "share", { value: undefined, configurable: true });
  let copied = null;
  Object.defineProperty(w.navigator, "clipboard", { value: { writeText: async (x) => (copied = x) }, configurable: true });
  btn.click();
  await tick(20);
  check("Without a share sheet, Share copies the link", copied === w.location.href && d.getElementById("event-toast-container").textContent.includes("Link copied"));

  check("Calendar links use the current site address, not a hard-coded one", w.buildMatchIcs({ id: "x", startTime: new Date().toISOString(), teams: [] }).includes("https://example.com/lolgg/#/match/x"));
  check("Reconnecting reloads data", /addEventListener\("online", \(\) => \{\s*updateOfflineBanner\(\);\s*route\(\);/.test(app));

  const terms = fs.readFileSync("/tmp/jsdomtest/terms.html", "utf8");
  const privacy = fs.readFileSync("/tmp/jsdomtest/privacy.html", "utf8");
  const credits = fs.readFileSync("/tmp/jsdomtest/credits.html", "utf8");
  check("Legal pages no longer mention AI Prediction", !/AI Prediction/.test(terms + privacy + credits));
  check("Privacy lists every setting kept on the device", ["time zone", "theme", "Hide scores", "Notify Me", "offline copy"].every((x) => privacy.includes(x)));
  check("No page claims to pull brackets from Liquipedia", !/pulls a fallback bracket|fallback brackets before/.test(credits + privacy + terms));
  const style = fs.readFileSync("/tmp/jsdomtest/style.css", "utf8");
  check("Light theme gold buttons use white text on a dark enough gold (WCAG AA)", (style.match(/--gold-alt: #8a6d24;\s*--gold-contrast: #ffffff;/g) || []).length === 2);
  const esports = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  check("Text on team-colored bars uses a per-theme readable color", (style.match(/--team-bar-text:/g) || []).length === 3 && (esports.match(/color: var\(--team-bar-text\)/g) || []).length === 3);
  check("Match lists switch to a stacked layout up to tablet width (no squeezed team names)", /@media \(max-width: 900px\) \{\s*\.schedule-row \{\s*display: grid;/.test(esports));
  check("Top bars stop floating over the logo below 900px", /@media \(max-width: 900px\) \{\s*\.top-clock \{\s*position: static;/.test(esports));
  check("Match page title skips TBD teams", /titleTeams\.length === 2/.test(app));
  check("Domain switch script exists", fs.existsSync("/tmp/jsdomtest/set-domain.sh"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
