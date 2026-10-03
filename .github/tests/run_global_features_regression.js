const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { url: "https://example.com/#/?status=upcoming", runScripts: "outside-only" });
const { window } = dom;
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const leagues = [
  { id: "L1", name: "LCK", slug: "lck", image: "" },
  { id: "L9", name: "CBLOL", slug: "cblol-brazil", image: "" },
  { id: "L8", name: "TFT Esports ", slug: "tft_esports", image: "" },
];
const at = (h) => new Date(Date.now() + h * 3600000).toISOString();
const ev = (id, h, league, a, b) => ({ type: "match", id, startTime: at(h), state: "unstarted", blockName: "W1", league,
  match: { id, strategy: { count: 3 }, teams: [{ id: a, name: a, code: a, result: null }, { id: b, name: b, code: b, result: null }] } });
const fetched = [];
window.fetch = async (url) => {
  const u = String(url);
  fetched.push(u);
  const ok = (data) => ({ ok: true, json: async () => ({ data }) });
  if (u.includes("/getLeagues")) return ok({ leagues });
  if (u.includes("/getSchedule")) {
    const events = u.includes("L9") ? [ev("B1", 5, { name: "CBLOL", slug: "cblol-brazil" }, "LOUD", "PAIN")] : [ev("K1", 3, { name: "LCK", slug: "lck" }, "GEN", "T1"), ev("K2", 30, { name: "LCK", slug: "lck" }, "HLE", "DK")];
    return ok({ schedule: { events, pages: {} } });
  }
  if (u.includes("/getLive")) return ok({ schedule: { events: [] } });
  return ok({ leagues: [{ tournaments: [] }], standings: [], schedule: { events: [] } });
};
window.Notification = undefined;
let downloaded = null;
window.URL.createObjectURL = (blob) => { downloaded = blob; return "blob:x"; };
window.URL.revokeObjectURL = () => {};

(async () => {
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await tick(300);
  const doc = window.document;
  const tab = doc.getElementById("tab-content");

  const btn = tab.querySelector(".calendar-all-btn");
  check("Upcoming tab offers one calendar file for every listed match", btn && btn.textContent.includes("Add these 2 matches"));
  btn.click();
  const ics = downloaded ? await downloaded.text() : "";
  check("Calendar file holds every listed match in one VCALENDAR", (ics.match(/BEGIN:VEVENT/g) || []).length === 2 && (ics.match(/BEGIN:VCALENDAR/g) || []).length === 1 && ics.includes("GEN vs T1"));
  check("Single match ICS still works", window.buildMatchIcs({ id: "z", startTime: at(1), teams: [{ name: "A" }, { name: "B" }] }).includes("SUMMARY:A vs B"));

  const more = doc.querySelector(".more-leagues-pill");
  check("Non-major leagues sit behind a More leagues pill", more && doc.querySelector(".more-leagues").classList.contains("hidden") && doc.querySelector('.more-leagues [data-id="L9"]'));
  check("TFT is never offered as a LoL league", !doc.querySelector('[data-id="L8"]'));
  more.click();
  check("More leagues reveals them", !doc.querySelector(".more-leagues").classList.contains("hidden") && more.textContent === "Fewer leagues");
  doc.querySelector('.more-leagues [data-id="L9"]').click();
  await tick(5);
  check("Picking a minor league goes into the shareable URL", window.location.hash === "#/?status=upcoming&leagues=cblol-brazil");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await tick(150);
  check("Minor league schedule loads", tab.innerHTML.includes("LOUD"));

  const dom2Pill = doc.querySelector('.more-leagues [data-id="L9"]');
  check("Selected minor league pill shows as active", dom2Pill.getAttribute("aria-pressed") === "true");

  const scores = doc.getElementById("scores-toggle");
  check("Hide scores starts off", scores.getAttribute("aria-pressed") === "false" && !doc.documentElement.classList.contains("hide-scores"));
  scores.click();
  check("Hide scores toggles the page class and remembers it", doc.documentElement.classList.contains("hide-scores") && window.localStorage.getItem("lolgg_hide_scores") === "1" && scores.textContent === "Show scores");
  const css = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  check(
    "With Hide scores on, the form section says why it is empty and the estimate takes no blank space",
    /\.hide-scores \.recent-form-grid::after\s*{[^}]*content: "Hidden while Hide scores is on/.test(css) && /\.hide-scores #prediction-slot\s*{\s*display: none/.test(css)
  );
  check("Hide scores CSS covers series scores, bracket scores, and form", /\.hide-scores \.game-wins/.test(css) && /\.hide-scores \.bracket-team-score/.test(css) && /\.hide-scores \.form-pips/.test(css));
  scores.click();
  check("Hide scores turns back off", !doc.documentElement.classList.contains("hide-scores"));

  check("Timezone labels show the UTC offset", /\(GMT\+7\)/.test(window.timeZoneLabel("Asia/Ho_Chi_Minh")));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
