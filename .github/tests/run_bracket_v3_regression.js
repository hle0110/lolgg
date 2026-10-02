const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only" });
const { window } = dom;
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const fx = (n) => JSON.parse(fs.readFileSync(`/tmp/jsdomtest/fixtures/${n}.json`, "utf8")).data.standings[0];
const lcs = fx("lcs_split_3_2026");
const worlds = fx("worlds_2026");
let v3Response = { standings: [lcs] };
window.fetch = async (url) => {
  const u = String(url);
  const ok = (data) => ({ ok: true, json: async () => ({ data }) });
  if (u.includes("/getStandingsV3")) return ok(v3Response);
  if (u.includes("/getStandings")) return ok({ standings: [] });
  if (u.includes("/getSchedule")) return ok({ schedule: { events: [], pages: {} } });
  if (u.includes("/getCompletedEvents")) return ok({ schedule: { events: [] } });
  return ok({ leagues: [] });
};
window.Notification = undefined;

(async () => {
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 100));
  const render = (st, events) => {
    const div = window.document.createElement("div");
    div.innerHTML = window.bracketV3Html(st, new Map(events || []));
    return div;
  };

  const a = render(lcs);
  const titles = [...a.querySelectorAll(".bracket-column-title")].map((t) => t.textContent.trim());
  check("Riot round names are shown without the raw dash", titles.includes("UpperSemifinals") && titles.includes("LowerRound 1") && !titles.some((t) => t.includes(" - ")));
  check("Lower bracket cells sit on row 2, upper on row 1", [...a.querySelectorAll(".bracket-column")].every((c) => /grid-row:2/.test(c.getAttribute("style")) === !!c.querySelector(".lane-tag.lower")));
  check("Double elimination hint shown", a.textContent.includes("Double elimination"));
  check("TBD final slot names the exact feeder match", a.textContent.includes("Winner of LYON vs C9"));
  check("Every match links to its match page", a.querySelectorAll('a.bracket-match[href^="#/match/"]').length === 10);
  const opts = [...a.querySelectorAll(".bracket-follow option")].map((o) => o.value);
  check("Follow a team lists real teams only", opts.includes("C9") && opts.includes("TLAW") && !opts.includes("TBD"));

  const b = render(worlds);
  check("Future bracket labels winners and losers by round when teams are unknown", b.textContent.includes("Loser of Upper Semifinals 1") && b.textContent.includes("Winner of Quarterfinals 1"));
  check("Swiss section gets its own hint", b.textContent.includes("Swiss: each round pairs"));
  check("Unknown future bracket has no follow menu", !b.querySelector(".bracket-follow"));

  const ev = { id: lcs.stages[1].sections[0].columns[5].cells[0].matches[0].id, state: "unstarted", startTime: "2026-10-04T20:00:00Z", bestOf: 5 };
  const c = render(lcs, [[ev.id, ev]]);
  check("Schedule data adds best-of and time", c.innerHTML.includes("Bo5") && !c.innerHTML.includes("Date TBD</span></div></a>\n    </div>\n  </section>"));

  const sel = a.querySelector(".bracket-follow");
  window.document.body.appendChild(a);
  sel.value = "C9";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("Following a team highlights only its matches", a.querySelector(".bracket-v3").classList.contains("following") && a.querySelectorAll(".bracket-match.followed").length === 4);
  const rerender = render(lcs);
  check("Followed team survives a re-render (polling)", rerender.querySelectorAll(".bracket-match.followed").length === 4);

  check("Empty V3 falls back to nothing so the old renderer runs", window.bracketV3Html(null, new Map()) === "" && window.bracketV3Html({ stages: [{ sections: [{ matches: [] }] }] }, new Map()) === "");

  const page = await window.buildTournamentContentHtml("L", { id: "T", startDate: "2026-08-01", endDate: "2026-10-05" }, { id: "L", name: "LCS", slug: "lcs" });
  check("Tournament page uses the V3 bracket when Riot has it", page.includes("bracket-v3") && page.includes("Winner of LYON vs C9"));
  v3Response = { standings: [] };
  const page2 = await window.buildTournamentContentHtml("L2", { id: "T2", startDate: "2026-08-01", endDate: "2026-10-05" }, { id: "L2", name: "LCS", slug: "lcs" });
  check("Without V3 data the page still renders a bracket section", page2.includes("<h3>Bracket</h3>") && !page2.includes("bracket-v3"));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
