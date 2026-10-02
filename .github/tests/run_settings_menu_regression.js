const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const lcs = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/lcs_split_3_2026.json", "utf8")).data.standings[0];

function boot(notifications) {
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only" });
  const w = dom.window;
  w.fetch = async (url) => {
    const u = String(url);
    const ok = (data) => ({ ok: true, json: async () => ({ data }) });
    if (u.includes("/getLeagues")) return ok({ leagues: [{ id: "L1", name: "LCK", slug: "lck", image: "" }] });
    if (u.includes("/getLive")) return ok({ schedule: { events: [] } });
    if (u.includes("/getSchedule")) return ok({ schedule: { events: [], pages: {} } });
    return ok({ leagues: [{ tournaments: [] }], standings: [] });
  };
  w.Notification = notifications ? Object.assign(function () {}, { permission: "default", requestPermission: async () => "granted" }) : undefined;
  w.eval(app);
  return w;
}

(async () => {
  const w = boot(false);
  await tick(200);
  const d = w.document;
  check("Site is English only: no language picker, no translation table", !d.getElementById("lang-select") && !/I18N|lolgg_lang|data-i18n/.test(app + html));
  check("Notify Me is not in the league filter row", !d.querySelector("#league-filter [data-notify-toggle]") && !d.querySelector("#league-filter .notify-toggle-pill"));
  check("Notify Me is hidden when the browser has no notifications", d.getElementById("notify-btn").classList.contains("hidden"));
  check("Settings menu holds Hide scores and Notify Me", !!d.querySelector("#settings-menu #scores-toggle") && !!d.querySelector("#settings-menu #notify-btn"));
  d.getElementById("settings-menu").open = true;
  d.body.click();
  check("Clicking outside closes the settings menu", d.getElementById("settings-menu").open === false);

  const w2 = boot(true);
  await tick(200);
  const notify = w2.document.getElementById("notify-btn");
  check("Notify Me shows when the browser supports notifications", !notify.classList.contains("hidden"));
  notify.click();
  await tick(20);
  check("Notify Me turns on after permission is granted", notify.getAttribute("aria-pressed") === "true");
  const theme = w2.document.documentElement.getAttribute("data-theme");
  w2.document.getElementById("scores-toggle").click();
  w2.document.querySelector("#settings-menu summary").click();
  check("Settings buttons never change the theme (they share the theme-btn look)", w2.document.documentElement.getAttribute("data-theme") === theme && w2.localStorage.getItem("lolgg_theme") !== "null");

  const b = d.createElement("div");
  b.innerHTML = w.bracketV3Html(lcs, new Map());
  d.body.appendChild(b);
  const chips = [...b.querySelectorAll(".bracket-round-chips [data-col]")];
  check("One round chip per bracket column", chips.length === lcs.stages[1].sections[0].columns.length);
  check("Round chips name the bracket side so names never repeat", new Set(chips.map((c) => c.textContent)).size === chips.length && chips.some((c) => c.textContent === "Upper Finals") && chips.some((c) => c.textContent === "Lower Finals"));
  let scrolled = null;
  b.querySelector(".bracket-grid").scrollTo = (o) => (scrolled = o);
  chips[2].click();
  check("Tapping a round chip scrolls the bracket", scrolled && scrolled.behavior === "smooth");
  const css = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  check("Round chips only show on narrow screens and rounds snap", /\.bracket-round-chips\s*{\s*display: none/.test(css) && /scroll-snap-type: x mandatory/.test(css));
  check("Game rows wrap on phones instead of squeezing team names", /@media \(max-width: 600px\)\s*{\s*\.game-row\s*{\s*flex-wrap: wrap/.test(css));
  check("Leagues under More leagues get real tournament pages (no 'isn't covered' dead end)", !app.includes("isn't covered here") && /const league = allLeagues\.find\(\(l\) => l\.id === leagueId\);/.test(app));
  check("Form pips wrap instead of running off screen", /\.form-pips\s*{[^}]*flex-wrap: wrap/.test(css));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
