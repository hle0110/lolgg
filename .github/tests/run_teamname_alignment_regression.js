const fs = require("fs");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const css = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");

  const teamNameBlockMatches = [...css.matchAll(/(^|\n)\.team-name\s*{([^}]*)}/g)].map((m) => m[2]);
  const anyTeamNameRuleHasEllipsis = teamNameBlockMatches.some((b) => /text-overflow:\s*ellipsis/.test(b));
  check("Team names are never truncated with an ellipsis - the full name always shows", !anyTeamNameRuleHasEllipsis);

  const reservedHeightMatch = css.match(/\n\.schedule-row \.team-name,\s*\n\.game-row \.team-name\s*{([^}]*)}/);
  check("Schedule/game row team names reserve a fixed 2-line height so every row lines up the same", !!reservedHeightMatch && /min-height:\s*2\.6em/.test(reservedHeightMatch[1]));
  check("That reserved-height box vertically centers a short (1-line) name within the same space a wrapped 2-line name would take", reservedHeightMatch && /align-items:\s*center/.test(reservedHeightMatch[1]));

  const genericMatch = css.match(/\n\.team-name\s*{([^}]*)}/);
  check("The generic .team-name rule still allows wrapping so long names are never cut off", genericMatch && /word-break:\s*break-word/.test(genericMatch[1]));

  const firstChildAlign = css.match(/\n\.schedule-row \.esports-team:first-child \.team-name,\s*\n\.game-row \.esports-team:first-child \.team-name\s*{([^}]*)}/);
  check("The home/left-side team name stays right-aligned next to its logo even when it wraps to 2 lines", !!firstChildAlign && /text-align:\s*right/.test(firstChildAlign[1]));

  const teamRowMatch = css.match(/\n\.esports-team\s*{([^}]*)}/);
  check("The team row centers the logo against the reserved-height name box, matching wherever the (also centered) text sits", !!teamRowMatch && /align-items:\s*center/.test(teamRowMatch[1]));

  const firstChildTeamMatch = css.match(/\n\.esports-team:first-child\s*{([^}]*)}/);
  const lastChildTeamMatch = css.match(/\n\.esports-team:last-child\s*{([^}]*)}/);
  check(
    "Each team's icon+name group is sized to its own content (not stretched to fill its wide grid column) and positioned via grid justify-self, so a big gap can't open up between the icon and the name",
    !!firstChildTeamMatch && /justify-self:\s*end/.test(firstChildTeamMatch[1]) && !!lastChildTeamMatch && /justify-self:\s*start/.test(lastChildTeamMatch[1])
  );

  const teamLinkFirstMatch = css.match(/\n\.match-teams \.team-link:first-child\s*{([^}]*)}/);
  const teamLinkLastMatch = css.match(/\n\.match-teams \.team-link:last-child\s*{([^}]*)}/);
  check(
    "The match page hero's clickable team-link wrapper (used when a team has a code) gets the same content-sized + justify-self fix, so the same gap bug can't reappear there",
    !!teamLinkFirstMatch && /justify-self:\s*end/.test(teamLinkFirstMatch[1]) && !!teamLinkLastMatch && /justify-self:\s*start/.test(teamLinkLastMatch[1])
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
