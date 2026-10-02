const fs = require("fs");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const css = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  const match = css.match(/\.standings-rank\s*{([^}]*)}/);
  const rankBlock = match ? match[1] : "";

  check(".standings-rank rule exists in esports.css", !!match);
  check(".standings-rank forces no-wrap so a 2-digit rank stays on one line", /white-space:\s*nowrap/.test(rankBlock));
  check(".standings-rank does not force word-break, which previously stacked digits vertically", !/word-break:\s*break-word/.test(rankBlock));
  check(".standings-rank does not force overflow-wrap break-word", !/overflow-wrap:\s*break-word/.test(rankBlock));

  const tableTdMatch = css.match(/\.standings-table td\s*{([^}]*)}/);
  check(".standings-table td still exists (shared cell padding/border untouched)", !!tableTdMatch);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
