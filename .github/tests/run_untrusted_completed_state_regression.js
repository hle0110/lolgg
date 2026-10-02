const fs = require("fs");
const vm = require("vm");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check(
    "A hasNoRecordedProgress helper exists to detect a 0-0/no-outcome team pair",
    /function hasNoRecordedProgress\(teams\) {/.test(app)
  );
  check(
    "computeEffectiveState no longer blindly trusts rawState 'completed' when there's zero score/outcome evidence behind it",
    /const untrustedCompleted = rawState === "completed" && hasNoRecordedProgress\(teams\);/.test(app)
  );

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `
    ${app.match(/function seriesWinThreshold\(bestOf\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function deriveMissingOutcomes\(teams, bestOf\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function seriesOutcomeDecided\(teams\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function seriesInProgressByScore\(teams\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function hasNoRecordedProgress\(teams\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function computeEffectiveState\(rawState, teams, startTime\) {[\s\S]*?\n}/)[0]}
    `,
    context
  );

  const now = Date.now();
  const iso = (msFromNow) => new Date(now + msFromNow).toISOString();
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const zeroZeroTeams = [
      { gameWins: 0, outcome: null },
      { gameWins: 0, outcome: null },
    ];
    check(
      "A 'completed' event with 0-0/no-outcome teams that started 20 minutes ago is corrected to inProgress (Riot's real bogus-completed bug, e.g. WE vs EDG)",
      context.computeEffectiveState("completed", zeroZeroTeams, iso(-20 * 60 * 1000)) === "inProgress"
    );
    check(
      "That same bogus 'completed' event, if scheduled far in the future, is corrected back to unstarted rather than trusted as Final",
      context.computeEffectiveState("completed", zeroZeroTeams, iso(3 * 60 * 60 * 1000)) === "unstarted"
    );
    check(
      "That same bogus 'completed' event, if scheduled more than 5 hours in the past (well past any reasonable live window), falls back to unstarted rather than staying falsely Final",
      context.computeEffectiveState("completed", zeroZeroTeams, iso(-6 * 60 * 60 * 1000)) === "unstarted"
    );

    const realFinishedTeams = [
      { gameWins: 2, outcome: "win" },
      { gameWins: 0, outcome: "loss" },
    ];
    check(
      "A genuinely finished match (real recorded score + outcome) still correctly reports completed",
      context.computeEffectiveState("completed", realFinishedTeams, iso(-20 * 60 * 1000)) === "completed"
    );

    const partialScoreTeams = [
      { gameWins: 1, outcome: null },
      { gameWins: 0, outcome: null },
    ];
    check(
      "A 'completed' event with a real partial score (1-0, series not yet decided) correctly reports inProgress rather than a premature Final - only the pure 0-0/no-signal case falls through to the completed-trust guard",
      context.computeEffectiveState("completed", partialScoreTeams, iso(-20 * 60 * 1000)) === "inProgress"
    );

    check(
      "An event with no team data at all and rawState 'completed' scheduled long ago falls back to unstarted rather than being trusted blind",
      context.computeEffectiveState("completed", [], iso(-10 * 60 * 60 * 1000)) === "unstarted"
    );
  } finally {
    Date.now = realNow;
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
