const fs = require("fs");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
  const found = [...new Set([...app.matchAll(emojiRe)].map((m) => m[0]))];
  const onlyStarsRemain = found.every((ch) => ch === "★" || ch === "☆");

  check("No decorative emoji remain in app.js (bell, calendar, theatre-mode icons, live-dot emoji all removed)", onlyStarsRemain);
  check("Notify Me button label has no bell emoji", fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").includes('>Notify Me</button>') && !app.includes("🔔"));
  check("Add to Calendar button label has no calendar emoji", app.includes(">Add to Calendar</button>") && !app.includes("📅"));
  check("Theatre Mode button labels have no fullscreen-icon emoji", app.includes(">Theatre Mode</button>") && !app.includes("⛶"));
  check("The theatre mode toggle's dynamic label text is also emoji-free", /"Exit Theatre Mode" : "Theatre Mode"/.test(app));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
