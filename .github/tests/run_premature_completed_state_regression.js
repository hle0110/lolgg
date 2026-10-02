const fs = require("fs");
const vm = require("vm");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check(
    "deriveMissingOutcomes no longer treats an unknown bestOf as an automatically clinched series (this was the root cause of live Bo3/Bo5 matches like a 1-0 series lead showing as Completed)",
    /const seriesClinched = threshold !== null && leaderWins >= threshold;/.test(app)
  );
  check(
    "computeEffectiveState's early-live window now starts 15 minutes before the scheduled start time, not only after it",
    /if \(elapsedMs > -15 \* 60 \* 1000 && elapsedMs < 5 \* 60 \* 60 \* 1000\) return "inProgress";/.test(app)
  );

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `
    ${app.match(/function seriesWinThreshold\(bestOf\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function deriveMissingOutcomes\(teams, bestOf\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function seriesOutcomeDecided\(teams\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function seriesInProgressByScore\(teams\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function computeEffectiveState\(rawState, teams, startTime\) {[\s\S]*?\n}/)[0]}
    `,
    context
  );

  const bo3Game1Lead = [
    { gameWins: 1, outcome: null },
    { gameWins: 0, outcome: null },
  ];
  const derivedUnknownBestOf = context.deriveMissingOutcomes(
    bo3Game1Lead.map((t) => ({ ...t })),
    null
  );
  check(
    "A 1-0 game lead with an unknown bestOf does NOT get an outcome assigned (series isn't actually over just because the format is unknown)",
    !derivedUnknownBestOf[0].outcome && !derivedUnknownBestOf[1].outcome
  );
  check(
    "That same unresolved series correctly evaluates as still in progress, not completed",
    context.computeEffectiveState("inProgress", derivedUnknownBestOf, null) === "inProgress" &&
      !context.seriesOutcomeDecided(derivedUnknownBestOf)
  );

  const bo3Clinched = [
    { gameWins: 2, outcome: null },
    { gameWins: 0, outcome: null },
  ];
  const derivedKnownBestOf = context.deriveMissingOutcomes(
    bo3Clinched.map((t) => ({ ...t })),
    3
  );
  check(
    "A real 2-0 sweep in a known Bo3 still correctly gets marked completed",
    derivedKnownBestOf[0].outcome === "win" && derivedKnownBestOf[1].outcome === "loss"
  );
  check(
    "computeEffectiveState reports completed for that genuinely-decided Bo3",
    context.computeEffectiveState("inProgress", derivedKnownBestOf, null) === "completed"
  );

  const bo3OneGameLead = [
    { gameWins: 1, outcome: null },
    { gameWins: 0, outcome: null },
  ];
  const derivedOneGameLead = context.deriveMissingOutcomes(
    bo3OneGameLead.map((t) => ({ ...t })),
    3
  );
  check(
    "A 1-0 lead in a KNOWN Bo3 does not get an outcome yet (only 1 of 2 needed wins)",
    !derivedOneGameLead[0].outcome && !derivedOneGameLead[1].outcome
  );

  const now = Date.now();
  const iso = (msFromNow) => new Date(now + msFromNow).toISOString();
  const realNow = Date.now;
  Date.now = () => now;
  try {
    check(
      "A match scheduled 10 minutes from now (inside the 15-min early window) is treated as live",
      context.computeEffectiveState("unstarted", [], iso(10 * 60 * 1000)) === "inProgress"
    );
    check(
      "A match scheduled 30 minutes from now (outside the 15-min early window) correctly stays unstarted",
      context.computeEffectiveState("unstarted", [], iso(30 * 60 * 1000)) === "unstarted"
    );
    check(
      "A match whose scheduled time already passed (previous game ran long/short) is still treated as live",
      context.computeEffectiveState("unstarted", [], iso(-60 * 60 * 1000)) === "inProgress"
    );
  } finally {
    Date.now = realNow;
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
