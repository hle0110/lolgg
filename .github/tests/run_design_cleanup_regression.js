const fs = require("fs");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const style = fs.readFileSync("/tmp/jsdomtest/style.css", "utf8");
  const esports = fs.readFileSync("/tmp/jsdomtest/esports.css", "utf8");
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check("Light theme's background is no longer a beige/cream tone (#f5f1e8 gone)", !/#f5f1e8|#eeeadf|#e6e0d2/.test(style));
  const lightBlockMatch = style.match(/html\[data-theme="light"\]\s*{([^}]*)}/);
  check("Light theme background is now a neutral cool gray/white instead", !!lightBlockMatch && /--bg:\s*#f7f8fa/.test(lightBlockMatch[1]));

  check("A dedicated --heading variable exists so heading color is independent of button/accent gold", /--heading:/.test(style));
  const lightHeadingMatch = lightBlockMatch ? lightBlockMatch[1].match(/--heading:\s*(#[0-9a-fA-F]+)/) : null;
  check("Light theme's heading color is a neutral dark tone, not the brownish/orange gold", !!lightHeadingMatch && lightHeadingMatch[1].toLowerCase() === "#1a2333");

  const headingSelectors = [
    /\.legal-page h2\s*{([^}]*)}/,
    /\.match-page h3\s*{([^}]*)}/,
    /\.stage-name\s*{([^}]*)}/,
    /\.standings-table thead th\s*{([^}]*)}/,
    /\.bracket-column-title\s*{([^}]*)}/,
  ];
  const combinedCss = style + "\n" + esports;
  const allUseHeadingVar = headingSelectors.every((re) => {
    const m = combinedCss.match(re);
    return m && /color:\s*var\(--heading\)/.test(m[1]);
  });
  check("Every real heading (legal page, section titles, match page h3, stage name, standings header, bracket column title) now uses --heading instead of --gold", allUseHeadingVar);

  check("Buttons/pills/accents (league-pill.active, seg-btn.active) still use --gold untouched - only headings changed", /\.league-pill\.active\s*{[^}]*var\(--gold\)/.test(esports) && /\.seg-btn\.active\s*{[^}]*var\(--gold\)/.test(esports));

  check("The .stage-name eyebrow-style kicker (uppercase + letter-spacing above a heading) has been de-styled", (() => {
    const m = esports.match(/\.stage-name\s*{([^}]*)}/);
    return m && !/text-transform:\s*uppercase/.test(m[1]) && !/letter-spacing/.test(m[1]);
  })());

  check("No serif font is used anywhere on the site", !/font-family:[^;]*serif[^-]/.test(style.replace(/sans-serif/g, "")));

  check("The colored pulsing live-dot indicator has been removed from esports.css", !/\.live-dot\s*{/.test(esports) && !/live-dot-pulse/.test(esports));
  check("The red circle emoji status indicator has been removed from the tournament Live Now heading", !app.includes("🔴 Live Now") && app.includes(">Live Now<"));
  check("The tournament live-game row now uses the same text state-badge pattern as everywhere else on the site instead of a dot", app.includes('<span class="state-badge inProgress">Live</span>'));

  check("No grid-like repeating background pattern exists anywhere in the CSS", !/repeating-linear-gradient|repeating-radial-gradient/.test(style + esports));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
