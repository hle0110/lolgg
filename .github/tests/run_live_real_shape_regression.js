const fs = require("fs");
const { JSDOM } = require("jsdom");

const FX = JSON.parse(fs.readFileSync("/tmp/jsdomtest/fixtures/demacia_live_2026-10-03.json", "utf8"));
const LEAGUE = FX.earlyStart.live.data.schedule.events[0].league;
const J = (d, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => d, text: async () => "" });

function boot(hash, routes) {
  const html = fs.readFileSync("/tmp/jsdomtest/index.html", "utf8").replace(/<script src="app\.js[^"]*"><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://example.com/" + hash, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.console = { ...console, error: () => {}, warn: () => {}, log: () => {}, info: () => {}, debug: () => {} };
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const s = String(u);
    for (const [part, fn] of routes) if (s.includes(part)) return fn(s);
    if (s.includes("/getLeagues")) return J({ data: { leagues: [LEAGUE] } });
    if (s.includes("decapi")) return { ok: true, status: 200, text: async () => "OFFLINE", json: async () => ({}) };
    return J({ data: {} });
  };
  w.eval(fs.readFileSync("/tmp/jsdomtest/app.js", "utf8"));
  return w;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const early = FX.earlyStart;
  const liveEvent = early.live.data.schedule.events[0];
  const detailEvent = early.detail.data.event;
  const minutesEarly = (new Date(liveEvent.startTime) - new Date(early.capturedAt)) / 60000;

  check("Real capture: getEventDetails has no state and no startTime", !("state" in detailEvent) && !("startTime" in detailEvent));
  check("Real capture: the match went live more than 15 minutes before its scheduled start", liveEvent.state === "inProgress" && minutesEarly > 15);
  check("Real capture: the series is 0-0 with game 1 in progress", detailEvent.match.teams.every((t) => t.result.gameWins === 0) && detailEvent.match.games[0].state === "inProgress");

  const earlyRoutes = [
    ["/getLive", () => J(early.live)],
    ["/getSchedule", () => J(early.schedule)],
    ["/getEventDetails", () => J(early.detail)],
  ];
  const w1 = boot("#/", earlyRoutes);
  await wait(800);
  const tab = w1.document.getElementById("tab-content").innerHTML;
  const names = liveEvent.match.teams.map((t) => t.name);
  check("Live tab shows the early, 0-0 match", /live-grid/.test(tab) && names.every((n) => tab.includes(n)));
  check("Live tab does not say no matches are live", !tab.includes("No matches are live right now"));
  const finished = early.schedule.data.schedule.events.find((e) => e.state === "completed");
  check("A finished match from the same capture is not on the Live tab", !tab.includes(`#/match/${finished.match.id}"`));
  const detail = await w1.getEventDetails(liveEvent.id);
  check("getEventDetails derives inProgress from the running game", detail.state === "inProgress");
  const scheduleEvent = (await w1.getSchedule([LEAGUE.id])).find((e) => e.id === liveEvent.id);
  check("eventIsGenuinelyLive accepts it", (await w1.eventIsGenuinelyLive(scheduleEvent)) === true);

  const stale = FX.staleLive.data.schedule.events[0];
  const w2 = boot("#/", [
    ["/getLive", () => J(FX.staleLive)],
    ["/getSchedule", () => J({ data: { schedule: { events: [stale], pages: { older: null, newer: null } } } })],
    ["/getEventDetails", () => J(FX.finishedDetail)],
  ]);
  await wait(800);
  check("Real capture: the finished detail still has no state", !("state" in FX.finishedDetail.data.event));
  check(
    "A match Riot still lists as live, whose details show the series decided, stays off the Live tab",
    !/live-grid/.test(w2.document.getElementById("tab-content").innerHTML)
  );

  const statsEvent = FX.staleLive.data.schedule.events[0];
  const minAge = Number(/less than (\d+) sec old/.exec(FX.statsRejected.message)[1]);
  const feed = [];
  const w4 = boot(`#/match/${statsEvent.id}`, [
    ["/getLive", () => J(FX.staleLive)],
    ["/getSchedule", () => J({ data: { schedule: { events: [statsEvent], pages: { older: null, newer: null } } } })],
    ["/getEventDetails", () => J(FX.statsDetail)],
    ["/livestats/v1/", (s) => {
      const start = new Date(new URL(s).searchParams.get("startingTime")).getTime();
      const endAge = (Date.now() - (start + 10000)) / 1000;
      const ok = endAge >= minAge;
      feed.push({ url: s, endAge, ok });
      if (!ok) return J(FX.statsRejected, 400);
      return s.includes("/window/") ? J(FX.statsWindow.body) : J({ frames: [] });
    }],
  ]);
  await wait(1500);
  const main = w4.document.getElementById("match-main");
  const slot = main.querySelector("#live-stats-slot");
  const frame = FX.statsWindow.body.frames[0];
  check("Real capture: Riot rejects a stats window whose end is under 70 seconds old", minAge === 70 && FX.statsRejected.httpStatus === 400);
  check("Live stats are requested", feed.length >= 2);
  check("Every live stats request is old enough for Riot to accept", feed.length && feed.every((f) => f.ok));
  check(
    "Live stats render the real captured gold totals",
    slot && slot.textContent.includes(frame.blueTeam.totalGold.toLocaleString()) && slot.textContent.includes(frame.redTeam.totalGold.toLocaleString())
  );
  check("Live stats do not show the unavailable message", slot && !slot.textContent.includes("aren't available"));

  check("Real capture: Riot lists no Twitch or YouTube stream for this match", detailEvent.streams.every((s) => !["twitch", "youtube"].includes(s.provider)));
  const buttons = [...main.querySelectorAll(".locale-btn")].map((b) => b.textContent.trim());
  check("Demacia Cup match page offers the English Twitch and Chinese Huya players", buttons.join("|") === "Twitch (English)|Huya (Chinese)");
  main.querySelector(".stream-poster").click();
  const twitchSrc = (main.querySelector("#live-embed-wrap iframe") || {}).src || "";
  check("English player is the lplenglish Twitch channel", twitchSrc.startsWith("https://player.twitch.tv/?channel=lplenglish&"));
  main.querySelectorAll(".locale-btn")[1].click();
  const huyaSrc = (main.querySelector("#live-embed-wrap iframe") || {}).src || "";
  check("Chinese player is Huya's share iframe for room 660000", huyaSrc.startsWith("https://liveshare.huya.com/iframe/660000"));
  const watch = main.querySelector("#live-watch-link-wrap a");
  check("Huya fallback link opens the room on huya.com", watch && watch.href === "https://www.huya.com/660000" && watch.textContent.includes("Huya"));
  const linkRow = [...main.querySelectorAll(".watch-links-row a")].map((a) => a.href);
  check("Official links row lists Twitch and Huya", linkRow.includes("https://www.twitch.tv/lplenglish") && linkRow.includes("https://www.huya.com/660000"));
  check("Stream hint names Demacia Cup, not DCGI", main.textContent.includes("official Demacia Cup Twitch channel") && !main.textContent.includes("DCGI"));
  check("LPL's huya.com/lpl link is not turned into an embed", w4.huyaRoomFromUrl("https://www.huya.com/lpl") === null);
  check("An unknown provider is still not playable", w4.isPlayableStream({ provider: "afreecatv", parameter: "aflol" }) === false);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
