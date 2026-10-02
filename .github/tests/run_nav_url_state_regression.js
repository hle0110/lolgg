const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only" });
const { window } = dom;
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const leagues = [
  { id: "L1", name: "LCK", slug: "lck", image: "" },
  { id: "L2", name: "LEC", slug: "lec", image: "" },
  { id: "L3", name: "DCGI", slug: "demacia_cup", image: "" },
  { id: "L4", name: "LCK Challengers", slug: "lck_challengers_league", image: "" },
];
const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const ev = (id, start, state, a, b, league) => ({
  type: "match", id, startTime: start, state, blockName: "Playoffs", league,
  match: { id, strategy: { count: 3 }, teams: [
    { id: a, name: a, code: a, result: { gameWins: 0, outcome: null } },
    { id: b, name: b, code: b, result: { gameWins: 0, outcome: null } },
  ] },
});
const fetchLog = [];
window.fetch = async (url) => {
  const u = String(url);
  fetchLog.push(u);
  const ok = (data) => ({ ok: true, json: async () => ({ data }) });
  if (u.includes("/getLeagues")) return ok({ leagues });
  if (u.includes("/getLive")) return ok({ schedule: { events: [] } });
  if (u.includes("/getSchedule")) return ok({ schedule: { events: [ev("M1", soon, "unstarted", "GEN", "T1", { name: "LCK", slug: "lck" })], pages: {} } });
  if (u.includes("/getTournamentsForLeague")) return ok({ leagues: [{ tournaments: [] }] });
  if (u.includes("/getStandings")) return ok({ standings: [] });
  if (u.includes("/getCompletedEvents")) return ok({ schedule: { events: [] } });
  return ok({});
};
window.requestAnimationFrame = (cb) => cb();
window.Notification = undefined;

(async () => {
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await tick(300);
  const doc = window.document;
  const pills = [...doc.querySelectorAll("#league-filter .league-pill[data-id]")].map((b) => b.textContent);
  check("Demacia Cup league (Riot name DCGI) is curated and shown with a readable name", pills.includes("Demacia Cup"));
  check("Challengers league is not a main pill (only under More leagues)", !pills.includes("LCK Challengers") || !!doc.querySelector('.more-leagues [data-id="L4"]'));
  check("Challengers league is not among the main pills", ![...doc.querySelectorAll("#league-filter > .league-pill[data-id]")].some((b) => b.textContent === "LCK Challengers"));
  check("Live and Matches are active by default", doc.querySelector('[data-status="live"]').classList.contains("active") && doc.querySelector('[data-view="matches"]').classList.contains("active"));
  check("Empty live tab shows the next upcoming match instead of a dead end", doc.getElementById("tab-content").innerHTML.includes("Next up") && doc.getElementById("tab-content").innerHTML.includes("GEN"));

  doc.querySelector('[data-status="upcoming"]').click();
  await tick(5);
  check("Clicking Upcoming writes status to the URL", window.location.hash === "#/?status=upcoming");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await tick(100);
  check("Upcoming becomes the only active status", doc.querySelector('[data-status="upcoming"]').classList.contains("active") && !doc.querySelector('[data-status="live"]').classList.contains("active"));

  doc.querySelector('#league-filter .league-pill[data-id="L1"]').click();
  await tick(5);
  check("Selecting a league adds its slug to the URL", window.location.hash === "#/?status=upcoming&leagues=lck");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await tick(100);
  check("League pill reflects URL state", doc.querySelector('#league-filter .league-pill[data-id="L1"]').getAttribute("aria-pressed") === "true");
  check("All Leagues pill turns off when a league is selected", doc.querySelector('#league-filter .league-pill[data-id="__all__"]').getAttribute("aria-pressed") === "false");

  doc.querySelector('[data-view="tournaments"]').click();
  await tick(5);
  check("Tournaments with one league selected stays on the list (no silent jump)", window.location.hash === "#/?view=tournaments&status=upcoming&leagues=lck");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await tick(100);
  check("Tournaments view keeps the shared status", doc.querySelector('[data-view="tournaments"]').classList.contains("active") && doc.querySelector('[data-status="upcoming"]').classList.contains("active"));
  check("No duplicate status select inside the tournaments tab", !doc.querySelector("#tournaments-status-select"));

  window.location.hash = "#/?view=matches&status=completed&leagues=lec,bogus&mine=1";
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await tick(100);
  check("Shared link restores status", doc.querySelector('[data-status="completed"]').classList.contains("active"));
  check("Shared link restores leagues and ignores unknown slugs", doc.querySelector('#league-filter .league-pill[data-id="L2"]').classList.contains("active") && doc.querySelectorAll("#league-filter .league-pill.active[data-id]").length === 1);
  check("Shared link restores My Teams", doc.querySelector("#league-filter .my-teams-pill").classList.contains("active"));

  doc.querySelector('#league-filter .league-pill[data-id="__all__"]').click();
  await tick(5);
  check("All Leagues clears league selection in the URL", window.location.hash === "#/?status=completed&mine=1");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
