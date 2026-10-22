const fs = require("fs");
const { JSDOM } = require("jsdom");

const WORLDS = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/worlds_2026-10-19.json", "utf8"));
const DEMACIA = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_live_2026-10-03.json", "utf8"));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/#/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  const vods = WORLDS.eventDetails["115660588583171786"].data.event.match.games.flatMap((g) => g.vods);
  const twitch = vods.find((v) => v.provider === "twitch");
  const youtube = vods.find((v) => v.provider === "youtube");
  check("Real capture: KC vs C9 has a Twitch and a YouTube VOD", twitch && youtube);
  check("A real Twitch VOD links to its Twitch page", w.watchUrlFor(twitch, "vod") === `https://www.twitch.tv/videos/${twitch.parameter}`);
  check("A real YouTube VOD links to its YouTube page", w.watchUrlFor(youtube, "vod") === `https://www.youtube.com/watch?v=${youtube.parameter}`);
  check(
    "Twitch and YouTube parameters are URL-encoded before going into a link",
    /videos\/\$\{encodeURIComponent\(item\.parameter\)\}/.test(app) && /twitch\.tv\/\$\{encodeURIComponent\(item\.parameter\)\}/.test(app) && /watch\?v=\$\{encodeURIComponent\(extractYoutubeId\(item\.parameter\)\)\}/.test(app)
  );

  const meta = DEMACIA.statsWindow.body.gameMetadata.blueTeamMetadata.participantMetadata[0];
  const row = w.playerRowHtml(null, meta, "blue", [], DEMACIA.statsWindow.body.gameMetadata.patchVersion, null);
  const box = new JSDOM(`<body>${row}</body>`).window.document;
  check("Real capture: the first blue player is WE Cube on Galio", meta.summonerName === "WE Cube" && meta.championId === "Galio");
  check("The live stats row shows the player's name as text", box.querySelector(".liveplayer-name").textContent === meta.summonerName);
  check("The champion icon has the champion as its alt text", box.querySelector(".liveplayer-champ-icon").getAttribute("alt") === "Galio");
  check("Player names and champion alt text are escaped", /liveplayer-name">\$\{escapeHtml\(summoner\)\}/.test(app) && /alt="\$\{escapeHtml\(champion\)\}"/.test(app));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
