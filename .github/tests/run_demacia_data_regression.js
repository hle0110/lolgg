const fs = require("fs");
const { JSDOM } = require("jsdom");

// Fixture is a real capture of Riot's API for Demacia Cup 2026 (see capturedFrom inside it), only filtered.
const fx = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_cup_2026.json", "utf8"));
const DC = "117126995932274206";
const CBLOL = "98767991332355509";
const MATCH = "117133805552196841";
const RED_ID = "99566408221961358";
const tournament = fx.tournaments[DC][0];

const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only" });
const { window } = dom;
window.localStorage.setItem("lolgg_tz", "UTC");
window.scrollTo = () => {};
window.Notification = undefined;
const results = [];
const check = (name, cond) => results.push({ name, pass: !!cond });
const calls = [];
window.fetch = async (url) => {
  const u = new URL(String(url));
  const path = u.pathname.split("/").pop();
  const id = u.searchParams.get("leagueId") || u.searchParams.get("id") || u.searchParams.get("tournamentId") || "";
  calls.push(`${path}:${id}`);
  const ok = (data) => ({ ok: true, json: async () => ({ data }) });
  if (path === "getLeagues") return ok({ leagues: fx.leagues });
  if (path === "getSchedule") return ok({ schedule: { events: fx.schedule[id] || [], pages: { older: null, newer: null } } });
  if (path === "getTournamentsForLeague") return ok({ leagues: [{ tournaments: fx.tournaments[id] || [] }] });
  if (path === "getEventDetails") return fx.eventDetails[id] ? ok({ event: fx.eventDetails[id] }) : { ok: false, status: 404 };
  if (path === "getTeams") return ok({ teams: fx.teams[id] ? [fx.teams[id]] : [] });
  if (path === "getStandingsV3") return ok({ standings: fx.standingsV3 });
  if (path === "getStandings") return ok({ standings: fx.standings });
  return ok({ schedule: { events: [] } });
};

(async () => {
  window.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  await new Promise((r) => setTimeout(r, 300));

  const label = window.tournamentDateRangeLabel(tournament, DC);
  check("Demacia Cup shows its first match day (Oct 3), not Riot's padded start date (Oct 2)", label.includes("Oct 3") && !label.includes("Oct 2 "));
  check("Demacia Cup still ends on the day of its final (Oct 17)", label.includes("Oct 17, 2026"));
  check("With no league to look matches up in, Riot's own dates are kept", window.tournamentDateRangeLabel(tournament).startsWith("Oct 2 "));

  const v3 = fx.standingsV3[0];
  const standings = fx.standings[0];
  const div = window.document.createElement("div");
  div.innerHTML = window.bracketV3Html(v3, new Map(), standings);
  const titles = [...div.querySelectorAll(".bracket-column-title")].map((t) => t.textContent.trim());
  check("Round 4, which Riot ships as a group with no bracket columns, is shown in the bracket", titles.includes("Round 4"));
  check("All 27 Demacia Cup matches are in the bracket, including the 3 from Round 4", div.querySelectorAll("a.bracket-match").length === 27);
  div.innerHTML = window.bracketV3Html(v3, new Map());
  check("Without the standings matches the bracket still renders the other 24", div.querySelectorAll("a.bracket-match").length === 24);
  check("Only stages named Round N are pulled in, never a normal group stage", window.roundStageColumns(standings, { id: v3.stages[0].id, name: "Swiss" }).length === 0);

  const red = { code: "RED", name: "RED Kalunga" };
  const navi = { code: "NAVI", name: "Natus Vincere" };
  check("RED has no history before its home league is loaded (CBLOL is not a curated league)", window.recentResults("RED").length === 0);
  check("No estimate is made from one team's record alone", window.computePredictionPct([red, navi], MATCH) === null);
  check("No estimate is made against an undecided team", window.computePredictionPct([{ code: "TBD", name: "TBD" }, navi], MATCH) === null);
  const tbd = window.predictionHtml([{ code: "TBD", name: "TBD" }, navi], MATCH);
  check("An undecided team gets a plain note, never a percentage", tbd.includes("once both teams are decided") && !tbd.includes("%"));
  check("No head-to-head block against an undecided team", window.headToHeadHtml([{ code: "TBD", name: "TBD" }, navi], MATCH) === "");

  window.location.hash = `#/match/${MATCH}`;
  await new Promise((r) => setTimeout(r, 500));
  check("The match page looks RED up by its real team id from getEventDetails", calls.includes(`getTeams:${RED_ID}`));
  check("The match page then loads RED's home league schedule (CBLOL)", calls.includes(`getSchedule:${CBLOL}`));
  const rows = [...window.document.querySelectorAll("#recent-form-slot .recent-form-row")];
  check("RED now shows its last 20 results on the match page", rows.length === 2 && rows[0].querySelectorAll(".form-pip").length === 20);
  const estimate = window.document.querySelector("#prediction-slot").textContent;
  check("Cross-league match gets an estimate with both records", /RED \d+%/.test(estimate) && estimate.includes("RED 10W-10L in their last 20") && estimate.includes("NAVI"));
  check("Cross-league estimate says it is a rough guide", estimate.includes("different leagues") && estimate.includes("rough guide"));

  await window.renderTeamPage("RED");
  const teamHtml = window.document.getElementById("team-main").textContent;
  check("Team page resolves the home league for a team outside the curated leagues", teamHtml.includes("CBLOL") && teamHtml.includes("BRAZIL"));

  const lecSplit2 = { id: "lec_split_2_2026", startDate: "2026-03-27", endDate: "2026-06-07" };
  check(
    "When a split's first matches are not loaded (only NAVI's from Apr 24 on), Riot's start date is kept instead of a wrong later one",
    window.tournamentDateRangeLabel(lecSplit2, "98767991302996019").startsWith("Mar 27 ")
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
