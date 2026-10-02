const fs = require("fs");
const vm = require("vm");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check(
    "highlightsChannelSearchUrl now prioritizes each team's short code over its long/raw name",
    /const teamCodes = \(teams \|\| \[\]\)\.map\(\(t\) => t\.code \|\| t\.name\)\.filter\(Boolean\)\.join\(" vs "\);/.test(app)
  );
  check(
    "The league name is no longer prepended to the search query (it was garbling the query, e.g. 'LPL Shenzhen NINJAS IN PYJAMAS')",
    !/const query = `\$\{league\?\.name \|\| ""\} \$\{teamNames\}`\.trim\(\);/.test(app)
  );

  const context = { encodeURIComponent };
  vm.createContext(context);
  vm.runInContext(app.match(/function highlightsChannelSearchUrl\(channel, league, teams\) {[\s\S]*?\n}/)[0], context);

  const league = { name: "LPL" };
  const teams = [
    { name: "Shenzhen NINJAS IN PYJAMAS", code: "NIP" },
    { name: "WeiboGaming", code: "WBG" },
  ];
  const url = context.highlightsChannelSearchUrl("oplolreplay", league, teams);

  check(
    "The real-world NIP vs WeiboGaming case now searches by code ('NIP vs WBG'), matching how the actual uploaded video is titled",
    url.includes(encodeURIComponent("NIP vs WBG"))
  );
  check(
    "The garbled long-name query ('Shenzhen NINJAS IN PYJAMAS vs WeiboGaming') no longer appears",
    !url.includes(encodeURIComponent("Shenzhen NINJAS IN PYJAMAS"))
  );

  const teamsMissingCode = [{ name: "Some New Team", code: null }, { name: "T1", code: "T1" }];
  const fallbackUrl = context.highlightsChannelSearchUrl("oplolreplay", league, teamsMissingCode);
  check(
    "A team with no code at all still falls back to its name rather than dropping out of the query",
    fallbackUrl.includes(encodeURIComponent("Some New Team vs T1"))
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
