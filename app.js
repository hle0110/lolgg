const ESPORTS_API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const ESPORTS_BASE = "https://esports-api.lolesports.com/persisted/gw";
const LIVESTATS_BASE = "https://feed.lolesports.com/livestats/v1";
const leagueFilterEl = document.getElementById("league-filter");
const tabContentEl = document.getElementById("tab-content");
const tabsEl = document.getElementById("tabs");
const homeViewEl = document.getElementById("home-view");
const matchViewEl = document.getElementById("match-view");
const matchMainEl = document.getElementById("match-main");
const tournamentViewEl = document.getElementById("tournament-view");
const tournamentMainEl = document.getElementById("tournament-main");
const teamViewEl = document.getElementById("team-view");
const teamMainEl = document.getElementById("team-main");
let allLeagues = [];
let curatedLeagues = [];
let selectedLeagueIds = new Set();
let activeTab = "live";

let matchesTab = "live";
let scheduleCache = [];

const DATA_CUTOFF_MS = Date.parse("2023-01-01T00:00:00Z");
function isOnOrAfterCutoff(dateStr) {
  if (!dateStr) return true;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) || t >= DATA_CUTOFF_MS;
}
let matchPagePollTimer = null;
let matchPageStreamState = null;
let matchPageCountdownTimer = null;
const LOCALE_PRIORITY = ["en-US", "en-GB", "en-AU"];
const MAJOR_LEAGUE_KEYWORDS = [
  "lck", "lec", "lpl", "lcs", "lcp",
  "msi", "mid-season invitational",
  "world championship", "worlds",
  "first stand",
  "esports world cup", "ewc",
  "masters",
];

const EXCLUDE_LEAGUE_KEYWORDS = [
  "academy",
  "hitpoint masters",
  "emea masters",
  "qualifying series",
  "pcs",
  "vcs",
  "cblol",
  "challengers",
];
function isMajorLeague(league) {
  const name = (league.name || "").toLowerCase();
  if (EXCLUDE_LEAGUE_KEYWORDS.some((kw) => name.includes(kw))) return false;
  return MAJOR_LEAGUE_KEYWORDS.some((kw) => name.includes(kw));
}
const COSTREAMERS = [
  { name: "Caedrel", twitch: "caedrel" },
  { name: "LS", twitch: "imls" },
  { name: "Vedius", twitch: "vediusofficial" },
  { name: "Jankos", twitch: "jankos" },
  { name: "IWDominate", twitch: "iwdominate" },
];
const EWC_ARENA_STREAMS = [
  { name: "Arena Stage 1", twitch: "ewc_stcarena_en" },
  { name: "Arena Stage 2", twitch: "ewc_stcarena_en2" },
];
function isEwcLeague(league) {
  return !!(league && league.name && league.name.toLowerCase().includes("esports world cup"));
}
function ewcArenaStreamItems() {
  return EWC_ARENA_STREAMS.map((s) => ({ provider: "twitch", parameter: s.twitch, locale: s.name }));
}
const OFFICIAL_YOUTUBE_LINK_HTML = `<a class="watch-link" href="https://www.youtube.com/@lolesports/live" target="_blank" rel="noopener">Official YouTube channel ↗</a>`;

const LEAGUE_OFFICIAL_STREAMS = [
  { match: "lec", links: [
    { url: "https://www.twitch.tv/lec", label: "Twitch" },
    { url: "https://www.youtube.com/LEC", label: "YouTube" },
  ] },
  { match: "lck", links: [
    { url: "https://www.youtube.com/@LCKglobal", label: "YouTube" },
    { url: "https://www.twitch.tv/lck/", label: "Twitch" },
  ] },
  { match: "lpl", links: [
    { url: "https://www.twitch.tv/lplenglish", label: "Twitch" },
    { url: "https://www.youtube.com/@LPL_English", label: "YouTube" },

    { url: "https://www.huya.com/lpl", label: "Huya" },
  ] },
  { match: "lcs", links: [
    { url: "https://www.twitch.tv/lcs", label: "Twitch" },
    { url: "https://www.youtube.com/@LCS", label: "YouTube" },
  ] },
  { match: "lcp", links: [
    { url: "https://www.youtube.com/@lolpacificen", label: "YouTube" },
    { url: "https://www.twitch.tv/lolpacificen/", label: "Twitch" },
  ] },
];

function officialLeagueStreamEntry(league) {
  if (!league) return null;
  const slug = (league.slug || "").trim().toLowerCase();
  const name = (league.name || "").trim().toLowerCase();
  return LEAGUE_OFFICIAL_STREAMS.find((l) => l.match === slug || l.match === name) || null;
}
function twitchLoginFromUrl(url) {
  const m = /twitch\.tv\/([a-zA-Z0-9_]+)/.exec(url || "");
  return m ? m[1] : null;
}

async function decapiTwitchIsLive(twitchLogin) {
  if (!twitchLogin) return null;
  return cached(`twitchlive:${twitchLogin}`, 30 * 1000, async () => {
    try {
      const res = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(twitchLogin)}?offline_msg=OFFLINE`);
      if (!res.ok) return null;
      const text = (await res.text()).trim();
      return text.toUpperCase() !== "OFFLINE";
    } catch {
      return null;
    }
  });
}

async function resolveKnownLeagueStreamPriority(known, startTime) {
  const twitchLink = known.links.find((l) => l.label === "Twitch");
  const youtubeLink = known.links.find((l) => l.label === "YouTube");
  if (!twitchLink || !youtubeLink) return { primary: twitchLink ? "twitch" : "youtube", status: "" };

  const goLiveAt = startTime ? new Date(startTime).getTime() - 10 * 60 * 1000 : null;
  if (goLiveAt && Date.now() < goLiveAt) {
    return { primary: "twitch", status: "" };
  }
  const isLive = await decapiTwitchIsLive(twitchLoginFromUrl(twitchLink.url));
  if (isLive === false) {
    return { primary: "youtube", status: "Twitch isn't live yet - showing YouTube instead." };
  }
  return { primary: "twitch", status: isLive === true ? "Live now on Twitch." : "" };
}

async function officialStreamLinksHtml(league, startTime) {
  if (isEwcLeague(league)) {

    const links = EWC_ARENA_STREAMS.map(
      (s) => `<a class="watch-link" href="https://twitch.tv/${encodeURIComponent(s.twitch)}" target="_blank" rel="noopener">${s.name} (Twitch) ↗</a>`
    );
    return `<div class="watch-links-row">${links.join("")}</div>`;
  }
  const known = officialLeagueStreamEntry(league);
  if (known) {
    const { primary, status } = await resolveKnownLeagueStreamPriority(known, startTime);
    const ordered = [...known.links].sort((a, b) => {
      const rank = (l) => (l.label.toLowerCase() === primary ? 0 : 1);
      return rank(a) - rank(b);
    });
    const links = ordered.map(
      (l) =>
        `<a class="watch-link ${l.label.toLowerCase() === primary ? "watch-link-primary" : ""}" href="${l.url}" target="_blank" rel="noopener">${league.name || league.slug || "Official"} ${l.label} ↗</a>`
    );
    const statusHtml = status ? `<p class="hint stream-priority-hint">${status}</p>` : "";
    return `${statusHtml}<div class="watch-links-row">${links.join("")}</div>`;
  }
  return `<div class="watch-links-row">${OFFICIAL_YOUTUBE_LINK_HTML}</div>`;
}
async function decapiTwitchTitle(twitchLogin) {
  return cached(`streamtitle:${twitchLogin}`, 30 * 1000, async () => {
    try {
      const res = await fetch(`https://decapi.me/twitch/title/${encodeURIComponent(twitchLogin)}`);
      if (!res.ok) return "";
      return (await res.text()).trim();
    } catch {
      return "";
    }
  });
}
function titleMentionsTeam(title, team) {
  if (!title || !team) return false;
  const t = title.toLowerCase();
  const candidates = [team.code, team.name]
    .filter(Boolean)
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 2);
  return candidates.some((c) => t.includes(c));
}
async function resolveEwcStreamForMatch(teams) {
  if (!teams || teams.length !== 2) return null;
  const titles = await Promise.all(EWC_ARENA_STREAMS.map((s) => decapiTwitchTitle(s.twitch)));
  const matches = EWC_ARENA_STREAMS.map((s, i) => ({
    stream: s,
    title: titles[i],
    matchesBoth: !!titles[i] && teams.every((t) => titleMentionsTeam(titles[i], t)),
  }));
  const confident = matches.filter((m) => m.matchesBoth);
  if (confident.length === 1) {
    return { provider: "twitch", parameter: confident[0].stream.twitch, locale: confident[0].stream.name };
  }
  return null;
}
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  return fn().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}
async function esportsFetch(path, params = {}) {
  const url = new URL(ESPORTS_BASE + path);
  url.searchParams.set("hl", "en-US");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, { headers: { "x-api-key": ESPORTS_API_KEY } });
  if (!res.ok) throw new Error(`Esports API error (${res.status})`);
  return res.json();
}

function backfillLeagueId(l) {
  if (l && l.id) return l.id;
  const name = ((l && l.name) || "").trim().toLowerCase();
  const slug = ((l && l.slug) || "").trim().toLowerCase();
  if (!name && !slug) return null;
  const found = [...curatedLeagues, ...allLeagues].find(
    (x) => (name && (x.name || "").trim().toLowerCase() === name) || (slug && (x.slug || "").trim().toLowerCase() === slug)
  );
  return found ? found.id : null;
}
function normalizeLeague(l) {
  return { id: backfillLeagueId(l), name: l.name, slug: l.slug, image: l.image };
}
function normalizeTeam(t) {
  return {
    id: t.id,
    name: t.name,
    code: t.code,
    image: t.image,
    gameWins: t.result ? t.result.gameWins : null,
    outcome: t.result ? t.result.outcome : null,
  };
}

function seriesWinThreshold(bestOf) {
  return typeof bestOf === "number" && bestOf > 0 ? Math.ceil(bestOf / 2) : null;
}
function deriveMissingOutcomes(teams, bestOf) {
  if (!teams || teams.length !== 2) return teams;
  const [a, b] = teams;
  const bothScored = typeof a.gameWins === "number" && typeof b.gameWins === "number" && a.gameWins !== b.gameWins;
  if (!bothScored) return teams;
  const threshold = seriesWinThreshold(bestOf);
  const leaderWins = Math.max(a.gameWins, b.gameWins);
  const seriesClinched = threshold === null || leaderWins >= threshold;
  if (!seriesClinched) return teams;
  if (!a.outcome) a.outcome = a.gameWins > b.gameWins ? "win" : "loss";
  if (!b.outcome) b.outcome = b.gameWins > a.gameWins ? "win" : "loss";
  return teams;
}

function isTbdPlaceholderTeam(t) {
  if (!t) return true;
  const code = t.code ? String(t.code).trim().toUpperCase() : "";
  const name = t.name ? String(t.name).trim().toUpperCase() : "";
  const codeIsTbd = !code || code === "TBD";
  const nameIsTbd = !name || name === "TBD";
  return codeIsTbd && nameIsTbd;
}
function isUnresolvedMatch(teams) {
  return !!(teams && teams.length === 2 && teams.every(isTbdPlaceholderTeam));
}

function isMatchEvent(e) {
  return !!(e && (!e.type || e.type === "match"));
}

function seriesOutcomeDecided(teams) {
  return !!(teams && teams.length && teams.every((t) => t.outcome === "win" || t.outcome === "loss"));
}
function seriesInProgressByScore(teams) {
  return !!(teams && teams.length && teams.some((t) => t.gameWins > 0) && !seriesOutcomeDecided(teams));
}
function computeEffectiveState(rawState, teams, startTime) {
  if (seriesOutcomeDecided(teams)) return "completed";
  if (seriesInProgressByScore(teams)) return "inProgress";

  if (rawState === "unstarted" && startTime) {
    const elapsedMs = Date.now() - new Date(startTime).getTime();
    if (elapsedMs > 0 && elapsedMs < 5 * 60 * 60 * 1000) return "inProgress";
  }
  return rawState;
}
function normalizeEvent(e) {
  const bestOf = e.match && e.match.strategy ? e.match.strategy.count : null;
  const teams = e.match && e.match.teams ? deriveMissingOutcomes(e.match.teams.map(normalizeTeam), bestOf) : [];
  return {
    id: e.match ? e.match.id : e.id,
    startTime: e.startTime,
    state: computeEffectiveState(e.state, teams, e.startTime),
    blockName: e.blockName,
    bestOf,
    league: e.league ? normalizeLeague(e.league) : null,
    teams,
  };
}
async function getLeagues() {
  return cached("leagues", 6 * 60 * 60 * 1000, async () => {
    const data = await esportsFetch("/getLeagues");
    return data.data.leagues.map(normalizeLeague);
  });
}
function effectiveLeagueIds() {
  if (selectedLeagueIds.size > 0) return [...selectedLeagueIds];
  return curatedLeagues.map((l) => l.id);
}

function liveTabLeagueIds() {
  if (selectedLeagueIds.size > 0) return [...selectedLeagueIds];
  return curatedLeagues.map((l) => l.id);
}
function findLeagueIdByName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const found = [...curatedLeagues, ...allLeagues].find((l) => (l.name || "").toLowerCase() === lower);
  return found ? found.id : null;
}
async function fetchScheduleRaw(params) {
  const data = await esportsFetch("/getSchedule", params);
  const schedule = data.data.schedule || {};
  return {
    events: (schedule.events || []).filter(isMatchEvent).map(normalizeEvent),
    older: schedule.pages ? schedule.pages.older : null,
    newer: schedule.pages ? schedule.pages.newer : null,
  };
}
async function fetchScheduleFreshForLeague(leagueId) {
  const baseParams = leagueId ? { leagueId } : {};
  const byId = new Map();
  const addAll = (events) => {
    for (const e of events) {
      if (isOnOrAfterCutoff(e.startTime)) byId.set(e.id, e);
    }
  };
  const basePage = await fetchScheduleRaw(baseParams);
  addAll(basePage.events);

  await Promise.all([
    (async () => {
      let newerToken = basePage.newer;
      for (let i = 0; newerToken && i < 6; i++) {
        const page = await fetchScheduleRaw({ ...baseParams, pageToken: newerToken });
        addAll(page.events);
        newerToken = page.newer;
      }
    })(),
    (async () => {
      let olderToken = basePage.older;
      for (let i = 0; olderToken && i < 4; i++) {
        const older = await fetchScheduleRaw({ ...baseParams, pageToken: olderToken });

        if (older.events.length && older.events.every((e) => !isOnOrAfterCutoff(e.startTime))) break;
        addAll(older.events);
        olderToken = older.older;
      }
    })(),
  ]);
  return [...byId.values()];
}
async function fetchScheduleFresh(leagueIds) {
  const byId = new Map();
  const addAll = (events) => {
    for (const e of events) byId.set(e.id, e);
  };
  if (!leagueIds || !leagueIds.length) {
    addAll(await fetchScheduleFreshForLeague(null));
    return [...byId.values()];
  }
  const perLeague = await Promise.all(
    leagueIds.map((id) => fetchScheduleFreshForLeague(id).catch(() => []))
  );
  for (const events of perLeague) addAll(events);
  return [...byId.values()];
}
async function getTournamentsForLeagueFresh(leagueId) {
  try {
    const data = await esportsFetch("/getTournamentsForLeague", { leagueId });
    const leagues = (data.data && data.data.leagues) || [];
    const league = leagues[0];
    const tournaments = (league && league.tournaments) || [];
    return tournaments.filter((t) => isOnOrAfterCutoff(t.startDate));
  } catch {
    return [];
  }
}
async function getSupplementalCompletedEvents(leagueIds) {
  const leaguesToCheck =
    leagueIds && leagueIds.length ? curatedLeagues.filter((l) => leagueIds.includes(l.id)) : curatedLeagues;
  const results = await Promise.all(
    leaguesToCheck.map(async (league) => {
      try {
        const override = liquipediaDateOverrideForLeague(league);
        const now = Date.now();
        const inOverrideWindow =
          !!override && now >= startOfUtcDay(override.startDate) && now <= endOfUtcDay(override.endDate);

        const tournaments = inOverrideWindow
          ? await getTournamentsForLeagueFresh(league.id)
          : await getTournamentsForLeague(league.id);
        if (!tournaments.length) return [];
        let candidateTournaments;
        if (inOverrideWindow) {

          candidateTournaments = tournaments;
        } else {
          const active = findActiveTournament(tournaments, league);
          candidateTournaments = active ? [active] : [];
        }
        const perTournament = await Promise.all(
          candidateTournaments.map((t) => getCompletedEventsForTournament(t.id).catch(() => []))
        );
        return perTournament.flat().map((e) => ({ ...e, league: e.league || league }));
      } catch {
        return [];
      }
    })
  );
  return results.flat();
}
async function getSchedule(leagueIds) {
  const key = `schedule:${(leagueIds || []).slice().sort().join(",")}`;

  const [events, supplemental] = await Promise.all([
    cached(key, 20 * 1000, () => fetchScheduleFresh(leagueIds)),
    getSupplementalCompletedEvents(leagueIds).catch(() => []),
  ]);

  const freshEvents = events.filter((e) => isOnOrAfterCutoff(e.startTime));
  const freshSupplemental = supplemental.filter((e) => isOnOrAfterCutoff(e.startTime));
  const byId = new Map(scheduleCache.filter((e) => isOnOrAfterCutoff(e.startTime)).map((e) => [e.id, e]));
  for (const e of freshEvents) byId.set(e.id, e);

  for (const e of freshSupplemental) byId.set(e.id, e);
  scheduleCache = [...byId.values()];
  const combined = new Map(freshEvents.map((e) => [e.id, e]));
  for (const e of freshSupplemental) combined.set(e.id, e);
  return [...combined.values()];
}
function hasTeamData(e) {
  return !!(e && e.teams && e.teams.length);
}
function mergeLiveEvent(scheduleCacheVersion, liveEndpointVersion) {

  if (liveEndpointVersion && hasTeamData(liveEndpointVersion)) return liveEndpointVersion;
  if (scheduleCacheVersion && hasTeamData(scheduleCacheVersion)) return scheduleCacheVersion;
  return liveEndpointVersion || scheduleCacheVersion;
}
async function getLive(leagueIds) {

  const [fromLiveEndpoint, scheduleEvents] = await Promise.all([
    cached("live", 15 * 1000, async () => {
      const data = await esportsFetch("/getLive");
      return (data.data.schedule.events || []).filter(isMatchEvent).map(normalizeEvent);
    }),
    getSchedule(leagueIds).catch(() => scheduleCache),
  ]);
  const byId = new Map();
  for (const e of scheduleEvents) {
    if (e.state === "inProgress") byId.set(e.id, e);
  }
  for (const e of fromLiveEndpoint) {
    byId.set(e.id, mergeLiveEvent(byId.get(e.id), e));
  }
  const events = [...byId.values()];
  if (!leagueIds || !leagueIds.length) return events;
  return events.filter((e) => e.league && leagueIds.includes(e.league.id));
}
function normalizeVod(v) {
  return { provider: v.provider, parameter: v.parameter, locale: v.locale };
}
async function getEventDetails(id) {
  return cached(`event:${id}`, 15 * 1000, async () => {
    const data = await esportsFetch("/getEventDetails", { id });
    const event = data.data.event;
    const streams = (event.streams || []).map(normalizeVod);
    const games = (event.match && event.match.games ? event.match.games : []).map((g) => ({
      id: g.id,
      number: g.number,
      state: g.state,
      teams: (g.teams || []).map((t) => ({ id: t.id, side: t.side })),
      vods: (g.vods || []).map(normalizeVod),
    }));

    const bestOf = event.match && event.match.strategy ? event.match.strategy.count : null;
    const teams = event.match && event.match.teams ? deriveMissingOutcomes(event.match.teams.map(normalizeTeam), bestOf) : [];
    const state = computeEffectiveState(event.state, teams, event.startTime);
    return { id: event.id, state, streams, games, teams, bestOf, startTime: event.startTime || null };
  });
}

function pickCurrentLiveGame(games) {
  const list = games || [];
  return list.find((g) => g.state === "inProgress") || list.find((g) => g.state !== "completed") || list[list.length - 1] || null;
}
async function getTournamentsForLeague(leagueId) {
  return cached(`tournaments:${leagueId}`, 6 * 60 * 60 * 1000, async () => {
    try {
      const data = await esportsFetch("/getTournamentsForLeague", { leagueId });
      const leagues = (data.data && data.data.leagues) || [];
      const league = leagues[0];
      const tournaments = (league && league.tournaments) || [];
      return tournaments.filter((t) => isOnOrAfterCutoff(t.startDate));
    } catch {
      return [];
    }
  });
}

async function getCompletedEventsForTournament(tournamentId) {
  return cached(`completed:${tournamentId}`, 60 * 1000, async () => {
    try {
      const data = await esportsFetch("/getCompletedEvents", { tournamentId });
      const events = (data.data && data.data.schedule && data.data.schedule.events) || [];
      return events
        .filter(isMatchEvent)
        .filter((e) => isOnOrAfterCutoff(e.startTime))
        .map((e) => {
          const bestOf = e.match && e.match.strategy ? e.match.strategy.count : null;
          return {
            id: e.match ? e.match.id : e.id,
            startTime: e.startTime,
            state: e.state || "completed",
            blockName: e.blockName,
            bestOf,
            league: e.league ? normalizeLeague(e.league) : null,
            teams: e.match && e.match.teams ? deriveMissingOutcomes(e.match.teams.map(normalizeTeam), bestOf) : [],
          };
        });
    } catch {
      return [];
    }
  });
}
async function getTeamByQuery(value) {
  return cached(`teamByQuery:${value}`, 6 * 60 * 60 * 1000, async () => {
    try {
      const data = await esportsFetch("/getTeams", { id: value });
      const teams = (data.data && data.data.teams) || [];
      return teams[0] || null;
    } catch {
      return null;
    }
  });
}
async function resolveMissingTeamRef(t) {
  if (t.id) {
    const byId = await getTeamByQuery(t.id).catch(() => null);
    if (byId) return byId;
  }
  if (t.slug) {
    const bySlug = await getTeamByQuery(t.slug).catch(() => null);
    if (bySlug) return bySlug;
  }
  return null;
}
function startOfUtcDay(dateStr) {
  const d = new Date(dateStr);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}
function endOfUtcDay(dateStr) {
  const d = new Date(dateStr);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
}
const LIQUIPEDIA_DATE_OVERRIDES = [
  { match: "esports world cup", startDate: "2026-07-15", endDate: "2026-07-19" },
];
function liquipediaDateOverrideForLeague(league) {
  if (!league || !league.name) return null;
  const name = league.name.toLowerCase();
  return LIQUIPEDIA_DATE_OVERRIDES.find((o) => name.includes(o.match)) || null;
}

const EWC_PLAYOFFS_QF_OVERRIDE = [
  { id: "ewc26-qf-hle-t1", teams: ["HLE", "T1"], startTime: "2026-07-17T11:00:00Z" },
  { id: "ewc26-qf-agal-kc", teams: ["AGAL", "KC"], startTime: "2026-07-17T11:00:00Z" },
  { id: "ewc26-qf-gen-jdg", teams: ["GEN", "JDG"], startTime: "2026-07-17T13:30:00Z" },
  { id: "ewc26-qf-blg-dk", teams: ["BLG", "DK"], startTime: "2026-07-17T13:30:00Z" },
];

const EWC_THIRD_PLACE_MATCH_ID = "116855104460702386";
const EWC_GRAND_FINAL_MATCH_ID = "116855104460702380";

const EWC_SEMIFINAL_FEEDER_GROUPS = [
  ["HLE", "T1", "AGAL", "KC"],
  ["GEN", "JDG", "BLG", "DK"],
];

function ewcSemifinalFeeders(semifinalEvent, quarterfinalEvents) {
  const knownTeam = (semifinalEvent.teams || []).find((t) => !isTbdPlaceholderTeam(t));
  const knownCode = knownTeam ? (knownTeam.code || knownTeam.name || "").toUpperCase() : null;
  if (!knownCode) return null;
  const group = EWC_SEMIFINAL_FEEDER_GROUPS.find((codes) => codes.includes(knownCode));
  if (!group) return null;
  const matches = (quarterfinalEvents || []).filter((e) =>
    (e.teams || []).some((t) => group.includes((t.code || t.name || "").toUpperCase()))
  );
  return matches.length === 2 ? matches : null;
}

function teamImageByCode(teamLookup) {
  const byCode = new Map();
  if (teamLookup) {
    for (const t of teamLookup.values()) {
      if (t && t.code && t.image) byCode.set(t.code.toUpperCase(), t.image);
    }
  }
  return byCode;
}
function ewcPlayoffsOverrideEvents(league, existingEvents, teamLookup) {
  if (!isEwcLeague(league)) return [];
  const haveTeamPair = (a, b) =>
    (existingEvents || []).some((e) => {
      const codes = (e.teams || []).map((t) => (t.code || "").toUpperCase());
      return codes.includes(a) && codes.includes(b);
    });
  const imageForCode = teamImageByCode(teamLookup);
  return EWC_PLAYOFFS_QF_OVERRIDE.filter((m) => !haveTeamPair(m.teams[0], m.teams[1])).map((m) => ({
    id: m.id,
    startTime: m.startTime,
    state: "unstarted",
    blockName: "Quarterfinals",
    bestOf: 3,
    league,
    teams: m.teams.map((code) => ({
      id: null,
      name: code,
      code,
      image: imageForCode.get(code.toUpperCase()) || null,
      gameWins: null,
      outcome: null,
    })),
    manualOverride: true,
  }));
}

async function ewcTeamImagesByCode(league) {
  try {
    const tournaments = await getTournamentsForLeague(league.id);
    const byCode = new Map();
    for (const t of tournaments) {
      try {
        const standings = await getStandings(t.id);
        if (!standings) continue;
        const lookup = await buildFullTeamLookup(standings);
        for (const [code, image] of teamImageByCode(lookup)) {
          if (!byCode.has(code)) byCode.set(code, image);
        }
      } catch {
      }
    }
    return byCode;
  } catch {
    return new Map();
  }
}
function isUnresolvedEwcEvent(e) {
  return !!(e && e.league && isEwcLeague(e.league) && isUnresolvedMatch(e.teams));
}
async function resolveEwcHomeEvents(events) {
  const unresolvedEwc = events.filter(isUnresolvedEwcEvent);
  if (!unresolvedEwc.length) return events;
  const imageForCode = await ewcTeamImagesByCode(unresolvedEwc[0].league);

  const overrideQueueByTime = new Map();
  for (const m of EWC_PLAYOFFS_QF_OVERRIDE) {
    const t = new Date(m.startTime).getTime();
    if (!overrideQueueByTime.has(t)) overrideQueueByTime.set(t, []);
    overrideQueueByTime.get(t).push(m);
  }
  const resolved = [];
  for (const e of events) {
    if (!isUnresolvedEwcEvent(e)) {
      resolved.push(e);
      continue;
    }
    const queue = overrideQueueByTime.get(new Date(e.startTime).getTime());
    const override = queue && queue.length ? queue.shift() : null;
    if (!override) continue;
    resolved.push({
      ...e,
      teams: override.teams.map((code) => ({
        id: null,
        name: code,
        code,
        image: imageForCode.get(code.toUpperCase()) || null,
        gameWins: null,
        outcome: null,
      })),
    });
  }
  return resolved;
}

async function resolveEwcHomeEventById(eventId) {
  try {
    const events = await getSchedule(effectiveLeagueIds());
    const resolved = await resolveEwcHomeEvents(events);
    return resolved.find((e) => e.id === eventId) || null;
  } catch {
    return null;
  }
}
function findActiveTournament(tournaments, league) {
  const override = liquipediaDateOverrideForLeague(league);
  const now = Date.now();
  if (override) {
    const inRange = now >= startOfUtcDay(override.startDate) && now <= endOfUtcDay(override.endDate);
    if (inRange) return tournaments[0] || null;
  }
  return (
    tournaments.find((t) => {
      if (!t.startDate || !t.endDate) return false;
      return now >= startOfUtcDay(t.startDate) && now <= endOfUtcDay(t.endDate);
    }) || null
  );
}
function tournamentDateRangeLabel(t) {
  if (!t || !t.startDate) return "";
  const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return t.endDate ? `${fmt(t.startDate)} to ${fmt(t.endDate)}` : fmt(t.startDate);
}
function resolvedTournamentDateRangeLabel(league, tournament) {
  const override = liquipediaDateOverrideForLeague(league);
  if (override) return tournamentDateRangeLabel({ startDate: override.startDate, endDate: override.endDate });
  return tournamentDateRangeLabel(tournament);
}
function pickDisplayTournament(tournaments, league) {
  if (!tournaments || !tournaments.length) return null;
  const active = findActiveTournament(tournaments, league);
  if (active) return active;
  const now = Date.now();
  const withDates = tournaments.filter((t) => t.startDate);
  const past = withDates.filter((t) => new Date(t.startDate).getTime() <= now).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  if (past.length) return past[0];
  const future = withDates.filter((t) => new Date(t.startDate).getTime() > now).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  return future[0] || null;
}
function nearestTournamentToTime(tournaments, time) {
  const withDates = tournaments.filter((t) => t.startDate);
  if (!withDates.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const t of withDates) {
    const mid = (startOfUtcDay(t.startDate) + endOfUtcDay(t.endDate || t.startDate)) / 2;
    const dist = Math.abs(time - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}
async function resolveTournamentForEvent(event) {
  if (!event || !event.league) return null;
  let tournaments = [];
  try {
    tournaments = await getTournamentsForLeague(event.league.id);
  } catch {
    return null;
  }
  if (!tournaments.length) return null;
  const eventTime = event.startTime ? new Date(event.startTime).getTime() : null;
  if (eventTime) {
    const containing = tournaments.find((t) => {
      if (!t.startDate || !t.endDate) return false;
      return eventTime >= startOfUtcDay(t.startDate) && eventTime <= endOfUtcDay(t.endDate);
    });
    if (containing) return containing;
    const nearest = nearestTournamentToTime(tournaments, eventTime);
    if (nearest) return nearest;
  }
  return pickDisplayTournament(tournaments, event.league);
}
async function getStandings(tournamentId) {
  return cached(`standings:${tournamentId}`, 30 * 1000, async () => {
    try {
      const data = await esportsFetch("/getStandings", { tournamentId });
      const standings = (data.data && data.data.standings) || [];
      return standings[0] || null;
    } catch {
      return null;
    }
  });
}
function buildStandingsTeamLookup(standings) {
  const byKey = new Map();
  for (const stage of standings.stages || []) {
    for (const section of stage.sections || []) {
      for (const r of section.rankings || []) {
        for (const t of r.teams || []) {
          if (t.id) byKey.set(`id:${t.id}`, t);
          if (t.slug) byKey.set(`slug:${t.slug}`, t);
        }
      }
    }
  }
  return byKey;
}
function slugToTitleCase(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function resolveMatchTeam(t, lookup) {
  if (!t) return null;
  const found = (t.id && lookup.get(`id:${t.id}`)) || (t.slug && lookup.get(`slug:${t.slug}`));
  if (found) return { ...found, result: t.result };

  const looksLikeRealSlug = t.slug && /[a-z]/i.test(t.slug);
  return { code: null, name: looksLikeRealSlug ? slugToTitleCase(t.slug) : null, result: t.result };
}
function normalizeStandingsMatchState(m) {
  const teams = m.teams || [];
  const decided = teams.length === 2 && teams.every((t) => t.result && (t.result.outcome === "win" || t.result.outcome === "loss"));
  if (decided) return "completed";
  if (m.state === "completed") return "completed";
  if (m.state === "inProgress") return "inProgress";
  return "unstarted";
}

function standingsBracketEvents(standings, teamLookup, league) {
  if (!standings || !standings.stages) return [];
  const events = [];
  for (const stage of standings.stages || []) {
    for (const section of stage.sections || []) {
      for (const m of section.matches || []) {
        const teams = (m.teams || []).map((t) => resolveMatchTeam(t, teamLookup)).filter(Boolean);
        if (teams.length !== 2 || !teams.some((t) => !isTbdPlaceholderTeam(t))) continue;
        events.push({
          id: m.id || null,
          startTime: null,
          state: normalizeStandingsMatchState(m),
          blockName: section.name || stage.name || "Bracket",
          bestOf: null,
          league,
          teams: teams.map((t) => ({
            id: t.id || null,
            name: t.name || t.code || null,
            code: t.code || null,
            image: t.image || null,
            gameWins: t.result && t.result.gameWins !== undefined ? t.result.gameWins : null,
            outcome: t.result ? t.result.outcome : null,
          })),
          fromStandings: true,
        });
      }
    }
  }
  return events;
}
function collectStandingsTeamRefs(standings) {
  const refs = [];
  for (const stage of standings.stages || []) {
    for (const section of stage.sections || []) {
      for (const r of section.rankings || []) {
        for (const t of r.teams || []) refs.push(t);
      }
      for (const m of section.matches || []) {
        for (const t of m.teams || []) refs.push(t);
      }
    }
  }
  return refs;
}
async function buildFullTeamLookup(standings) {
  const lookup = buildStandingsTeamLookup(standings);
  const refs = collectStandingsTeamRefs(standings);
  const missing = refs.filter(
    (t) => (t.id || t.slug) && !(t.slug && lookup.has(`slug:${t.slug}`)) && !(t.id && lookup.has(`id:${t.id}`))
  );
  const uniqueMissing = [];
  const seenKeys = new Set();
  for (const t of missing) {
    const key = t.id || t.slug;
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueMissing.push(t);
    }
  }
  if (uniqueMissing.length) {
    try {
      const resolved = await Promise.all(uniqueMissing.map((t) => resolveMissingTeamRef(t).catch(() => null)));
      uniqueMissing.forEach((t, idx) => {
        const found = resolved[idx];
        if (!found) return;
        if (t.slug) lookup.set(`slug:${t.slug}`, found);
        if (t.id) lookup.set(`id:${t.id}`, found);
        if (found.slug) lookup.set(`slug:${found.slug}`, found);
        if (found.id) lookup.set(`id:${found.id}`, found);
      });
    } catch {
    }
  }
  return lookup;
}
function bracketSectionSide(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("upper")) return "upper";
  if (n.includes("lower")) return "lower";
  if (n.includes("quarterfinal") || n.includes("semifinal")) return "other";
  if (n.includes("final")) return "final";
  return "other";
}
function standingsTableRowHtml(ordinal, t) {
  const teamCell = t.code
    ? `<a class="standings-team-link" href="#/team/${encodeURIComponent(t.code)}">${teamLogoHtml(t)}<span class="standings-team-name">${t.name || t.code}</span></a>`
    : `${teamLogoHtml(t)}<span class="standings-team-name">${t.name || "TBD"}</span>`;
  return `
    <tr>
      <td class="standings-rank">${ordinal ?? ""}</td>
      <td class="standings-team-cell">${teamCell}</td>
      <td class="standings-record">${t.record ? `${t.record.wins}-${t.record.losses}` : ""}</td>
    </tr>`;
}

function standingsHtml(standings, providedLookup) {
  if (!standings || !standings.stages || !standings.stages.length) {
    return `<p class="idle">No standings/bracket data available for this tournament yet.</p>`;
  }
  const stagesHtml = standings.stages
    .map((stage) => {
      const sections = stage.sections || [];
      const renderedSections = sections
        .map((section) => {
          let rankingsHtml = "";
          if (section.rankings && section.rankings.length) {
            const rows = section.rankings
              .flatMap((r) => (r.teams || []).filter((t) => t.code || t.name).map((t) => ({ ordinal: r.ordinal, t })))
              .map(({ ordinal, t }) => standingsTableRowHtml(ordinal, t))
              .join("");
            if (rows) {
              rankingsHtml = `<table class="standings-table"><thead><tr><th>#</th><th>Team</th><th class="standings-th-record">W-L</th></tr></thead><tbody>${rows}</tbody></table>`;
            }
          }
          if (!rankingsHtml) return null;
          return `<div class="standings-section">${section.name ? `<h4>${section.name}</h4>` : ""}${rankingsHtml}</div>`;
        })
        .filter(Boolean);
      if (!renderedSections.length) return "";
      return `<div class="standings-stage">${stage.name ? `<h4 class="stage-name">${stage.name}</h4>` : ""}${renderedSections.join("")}</div>`;
    })
    .filter(Boolean)
    .join("");
  return stagesHtml || `<p class="idle">Standings aren't available for this tournament yet - group stage hasn't started, or it's straight into bracket play.</p>`;
}

let liveStatsDelaySeconds = 0;
let liveStatsDelayGameId = null;
let liveStatsCleanFetchStreak = 0;
function ensureLiveStatsDelayForGame(gameId) {
  if (gameId !== liveStatsDelayGameId) {
    liveStatsDelayGameId = gameId;
    liveStatsDelaySeconds = 0;
    liveStatsCleanFetchStreak = 0;
  }
}
function isoTimeWithDelay(delaySeconds) {
  const date = new Date();
  date.setMilliseconds(0);
  const secs = date.getSeconds();
  if (secs % 10 !== 0) date.setSeconds(secs - (secs % 10));
  date.setSeconds(date.getSeconds() - delaySeconds);
  return date.toISOString();
}
function bumpLiveStatsDelay() {
  liveStatsDelaySeconds = Math.min(liveStatsDelaySeconds + 10, 60);
  liveStatsCleanFetchStreak = 0;
}
function relaxLiveStatsDelay() {
  liveStatsCleanFetchStreak += 1;
  if (liveStatsCleanFetchStreak >= 2 && liveStatsDelaySeconds > 0) {
    liveStatsDelaySeconds = Math.max(0, liveStatsDelaySeconds - 10);
    liveStatsCleanFetchStreak = 0;
  }
}
async function getGameWindow(gameId) {
  ensureLiveStatsDelayForGame(gameId);
  const startingTime = isoTimeWithDelay(liveStatsDelaySeconds);
  return cached(`window:${gameId}:${startingTime}`, 5 * 1000, async () => {
    try {
      const url = new URL(`${LIVESTATS_BASE}/window/${gameId}`);
      url.searchParams.set("startingTime", startingTime);
      const res = await fetch(url);
      if (!res.ok) {
        try {
          const body = await res.json();
          if (body && body.message && body.message.includes("window with end time less than")) {
            bumpLiveStatsDelay();
          }
        } catch {
        }
        return null;
      }
      const json = await res.json();
      if (json && json.frames && json.frames.length) relaxLiveStatsDelay();
      return json;
    } catch {
      return null;
    }
  });
}
async function getGameDetailsFeed(gameId) {
  ensureLiveStatsDelayForGame(gameId);
  const startingTime = isoTimeWithDelay(liveStatsDelaySeconds);
  return cached(`detailsfeed:${gameId}:${startingTime}`, 5 * 1000, async () => {
    try {
      const url = new URL(`${LIVESTATS_BASE}/details/${gameId}`);
      url.searchParams.set("startingTime", startingTime);
      const res = await fetch(url);
      if (!res.ok) {
        try {
          const body = await res.json();
          if (body && body.message && body.message.includes("window with end time less than")) {
            bumpLiveStatsDelay();
          }
        } catch {
        }
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  });
}
function formatChampionName(id) {
  if (!id) return "";
  return String(id)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
function participantRoleOrder(role) {
  const order = ["top", "jungle", "mid", "bottom", "support"];
  const idx = order.indexOf((role || "").toLowerCase());
  return idx === -1 ? 99 : idx;
}
function buildRosterLookup(teamMetadata) {
  const map = new Map();
  for (const p of (teamMetadata && teamMetadata.participantMetadata) || []) {
    map.set(p.participantId, p);
  }
  return map;
}

function extractItemsByParticipant(detailsData) {
  const itemsByParticipant = new Map();
  try {
    const detailFrames = (detailsData && detailsData.frames) || [];
    const latestDetailFrame = detailFrames[detailFrames.length - 1];
    if (!latestDetailFrame) return itemsByParticipant;
    const flatParticipants =
      latestDetailFrame.participants ||
      [...((latestDetailFrame.blueTeam && latestDetailFrame.blueTeam.participants) || []), ...((latestDetailFrame.redTeam && latestDetailFrame.redTeam.participants) || [])];
    for (const p of flatParticipants || []) {
      if (p && p.participantId && Array.isArray(p.items)) itemsByParticipant.set(p.participantId, p.items);
    }
  } catch {
  }
  return itemsByParticipant;
}
async function getLiveStats(gameId) {
  const [data, detailsData] = await Promise.all([getGameWindow(gameId), getGameDetailsFeed(gameId).catch(() => null)]);
  const frames = data && data.frames ? data.frames : [];
  const gameMetadata = (data && data.gameMetadata) || (detailsData && detailsData.gameMetadata) || null;
  const itemsByParticipant = extractItemsByParticipant(detailsData);
  if (frames.length) {
    const latest = frames[frames.length - 1];
    return {
      timestamp: latest.rfc460Timestamp || null,
      blueTeam: latest.blueTeam || null,
      redTeam: latest.redTeam || null,
      gameMetadata,
      itemsByParticipant,
    };
  }
  const detailFrames = detailsData && detailsData.frames ? detailsData.frames : [];
  if (!detailFrames.length) return null;
  const latestDetail = detailFrames[detailFrames.length - 1];
  if (!latestDetail.blueTeam && !latestDetail.redTeam) return null;
  return {
    timestamp: latestDetail.rfc460Timestamp || null,
    blueTeam: latestDetail.blueTeam || null,
    redTeam: latestDetail.redTeam || null,
    gameMetadata,
    itemsByParticipant,
  };
}
const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
})();

const TIMEZONE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "America/Los_Angeles", label: "US Pacific" },
  { value: "America/New_York", label: "US Eastern" },
  { value: "Europe/London", label: "UK" },
  { value: "Europe/Paris", label: "Central Europe" },
  { value: "Asia/Shanghai", label: "China" },
  { value: "Asia/Seoul", label: "Korea" },
];
function getStoredTimeZone() {
  try {
    return localStorage.getItem("lolgg_tz") || "auto";
  } catch {
    return "auto";
  }
}
function setStoredTimeZone(tz) {
  try {
    localStorage.setItem("lolgg_tz", tz);
  } catch {
  }
}
function getActiveTimeZone() {
  const stored = getStoredTimeZone();
  return stored && stored !== "auto" ? stored : LOCAL_TZ;
}

function getStoredTheme() {
  try {
    return localStorage.getItem("lolgg_theme") || "auto";
  } catch {
    return "auto";
  }
}
function setStoredTheme(theme) {
  try {
    localStorage.setItem("lolgg_theme", theme);
  } catch {
  }
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === theme);
  });
}
function initThemePicker() {
  applyTheme(getStoredTheme());
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.getAttribute("data-theme-choice");
      setStoredTheme(theme);
      applyTheme(theme);
    });
  });
}

const FAVORITES_KEY = "lolgg_favorite_teams";
function getFavoriteTeams() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function isFavoriteTeam(code) {
  if (!code) return false;
  return getFavoriteTeams().includes(code);
}
function setFavoriteTeams(codes) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(codes));
  } catch {
  }
}

function toggleFavoriteTeam(code) {
  if (!code) return false;
  const current = getFavoriteTeams();
  const idx = current.indexOf(code);
  let nowFavorite;
  if (idx === -1) {
    current.push(code);
    nowFavorite = true;
  } else {
    current.splice(idx, 1);
    nowFavorite = false;
  }
  setFavoriteTeams(current);
  try {
    document.dispatchEvent(new CustomEvent("lolgg:favorites-changed", { detail: { code, favorite: nowFavorite } }));
  } catch {
  }
  return nowFavorite;
}
function favoriteStarHtml(code, extraClass = "") {
  if (!code) return "";
  const active = isFavoriteTeam(code);
  return `<button type="button" class="favorite-star ${active ? "active" : ""} ${extraClass}" data-favorite-code="${encodeURIComponent(code)}" aria-pressed="${active}" aria-label="${active ? "Remove from favorites" : "Add to favorites"}" title="${active ? "Remove from favorites" : "Add to favorites"}">${active ? "★" : "☆"}</button>`;
}

function wireFavoriteStarDelegation() {
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".favorite-star");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const code = decodeURIComponent(btn.getAttribute("data-favorite-code") || "");
    if (!code) return;
    const nowFavorite = toggleFavoriteTeam(code);

    document.querySelectorAll(`.favorite-star[data-favorite-code="${encodeURIComponent(code)}"]`).forEach((el) => {
      el.classList.toggle("active", nowFavorite);
      el.textContent = nowFavorite ? "★" : "☆";
      el.setAttribute("aria-pressed", String(nowFavorite));
      el.setAttribute("aria-label", nowFavorite ? "Remove from favorites" : "Add to favorites");
      el.title = nowFavorite ? "Remove from favorites" : "Add to favorites";
    });
  });
}

function knownTeamsForSearch() {
  const byCode = new Map();
  for (const e of scheduleCache) {
    for (const t of e.teams || []) {
      if (t.code && !byCode.has(t.code)) byCode.set(t.code, { code: t.code, name: t.name || t.code, image: t.image || null });
    }
  }
  return [...byCode.values()];
}
function siteSearchResults(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const leagueResults = curatedLeagues
    .filter((l) => (l.name || "").toLowerCase().includes(q))
    .map((l) => ({ type: "league", id: l.id, label: l.name, hint: "League" }));
  const teamResults = knownTeamsForSearch()
    .filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
    .map((t) => ({ type: "team", id: t.code, label: t.name, hint: t.code }));
  return [...leagueResults, ...teamResults].slice(0, 8);
}
function siteSearchResultHref(result) {
  return result.type === "league" ? `#/tournament/${encodeURIComponent(result.id)}` : `#/team/${encodeURIComponent(result.id)}`;
}
function initSiteSearch() {
  const input = document.getElementById("site-search-input");
  const resultsEl = document.getElementById("site-search-results");
  if (!input || !resultsEl) return;
  const render = () => {
    const results = siteSearchResults(input.value);
    if (!results.length) {
      resultsEl.innerHTML = "";
      resultsEl.classList.remove("open");
      return;
    }
    resultsEl.innerHTML = results
      .map(
        (r) =>
          `<a class="site-search-result" href="${siteSearchResultHref(r)}" data-close-search="1"><span>${r.label}</span><span class="hint">${r.hint}</span></a>`
      )
      .join("");
    resultsEl.classList.add("open");
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  resultsEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-search]")) {
      input.value = "";
      resultsEl.innerHTML = "";
      resultsEl.classList.remove("open");
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target !== input && !resultsEl.contains(e.target)) {
      resultsEl.classList.remove("open");
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      resultsEl.innerHTML = "";
      resultsEl.classList.remove("open");
      input.blur();
    }
  });
}
function localTimeLabel(iso) {
  const tz = getActiveTimeZone();
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz || undefined,
  });
}

function bracketTimeLabel(iso) {
  const tz = getActiveTimeZone();
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz || undefined,
  });
}
function teamInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
const TEAM_NAME_ABBREVIATIONS = {
  "cloud9": "C9",
  "100 thieves": "100T",
  "flyquest": "FLY",
  "team liquid": "TL",
  "evil geniuses": "EG",
  "dignitas": "DIG",
  "shopify rebellion": "SR",
  "ninjas in pyjamas": "NIP",
  "movistar koi": "MKOI",
  "team bds": "BDS",
  "shifters": "SHIFT",
  "karmine corp": "KC",
  "giantx": "GX",
  "sk gaming": "SK",
  "team vitality": "VIT",
  "fnatic": "FNC",
  "g2 esports": "G2",
  "rogue": "RGE",
  "gen.g esports": "GEN",
  "gen.g": "GEN",
  "dplus kia": "DK",
  "hanwha life esports": "HLE",
  "kt rolster": "KT",
  "bnk fearx": "BFX",
  "kiwoom drx": "DRX",
  "nongshim red force": "NS",
  "hanjin brion": "BRO",
  "top esports": "TES",
  "jd gaming": "JDG",
  "bilibili gaming": "BLG",
  "weibo gaming": "WBG",
  "lng esports": "LNG",
  "edward gaming": "EDG",
  "royal never give up": "RNG",
  "invictus gaming": "IG",
  "funplus phoenix": "FPX",
  "team we": "WE",
  "loud": "LOUD",
  "paineleiras": "PAIN",
  "pain gaming": "PAIN",
  "furia esports": "FUR",
  "kabum esports": "KBM",
  "vivo keyd stars": "VKS",
  "mad lions": "MAD",
  "gam esports": "GAM",
  "sentinels": "SEN",
  "team secret": "TS",
  "lyon gaming": "LYON",
  "dwg kia": "DK",
};
function shortTeamLabel(team) {
  if (!team) return "TBD";
  if (team.code && team.code.length <= 5) return team.code;
  const rawName = (team.name || team.code || "TBD").trim();
  const normalized = rawName.replace(/-/g, " ");
  const mapped = TEAM_NAME_ABBREVIATIONS[normalized.toLowerCase()];
  if (mapped) return mapped;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 5);
  if (team.code && team.code.length <= 8) return team.code;
  return normalized.slice(0, 4).toUpperCase();
}

function teamLogoHtml(team) {
  if (team.image) {
    const label = team.name || team.code || "Team";
    const fallback = teamInitials(team.name || team.code);
    return `<img src="${team.image}" alt="${label}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div class="team-avatar-fallback" style="display:none">${fallback}</div>`;
  }
  return `<div class="team-avatar-fallback">${teamInitials(team.name || team.code)}</div>`;
}

function teamHtml(team, hideScore) {
  const showScore = !hideScore && team.gameWins !== null && team.gameWins !== undefined;
  return `
    <div class="esports-team ${team.outcome === "win" ? "won" : team.outcome === "loss" ? "lost" : ""}">
      ${teamLogoHtml(team)}
      <div class="team-name">${team.name || team.code || "TBD"}</div>
      ${showScore ? `<div class="game-wins">${team.gameWins}</div>` : ""}
    </div>`;
}
function resolveLeagueImage(league) {
  if (!league) return "";
  if (league.image) return league.image;
  const found = allLeagues.find((l) => l.id === league.id) || curatedLeagues.find((l) => l.id === league.id);
  return found?.image || "";
}
function leagueLogoHtml(league, extraClass) {
  const img = resolveLeagueImage(league);
  if (!img) return "";
  const cls = `league-logo${extraClass ? ` ${extraClass}` : ""}`;

  return `<img class="${cls}" src="${img}" alt="${league?.name || ""}" title="${league?.name || ""}" loading="lazy" onerror="this.style.display='none';" />`;
}
function matchCardHtml(event) {
  const stateLabel = event.state === "inProgress" ? "Ongoing" : event.state === "completed" ? "Final" : "";
  const bestOf = event.bestOf ? `Bo${event.bestOf}` : "";
  return `
    <a class="schedule-row ${event.state}" href="#/match/${encodeURIComponent(event.id)}">
      ${leagueLogoHtml(event.league)}
      <div class="league-name">${event.league?.name || ""}${event.blockName ? ` · ${event.blockName}` : ""}</div>
      <div class="match-teams">${event.teams.map((t) => teamHtml(t, event.state === "unstarted")).join('<div class="vs">vs</div>')}</div>
      <div class="match-meta">
        ${stateLabel ? `<span class="state-badge ${event.state}">${stateLabel}</span>` : ""}
        ${event.state === "inProgress" ? "" : `<span class="match-time">${localTimeLabel(event.startTime)}</span>`}
        <span class="best-of">${bestOf}</span>
      </div>
    </a>`;
}
function groupByDay(events) {
  const groups = new Map();
  const tz = getActiveTimeZone();
  for (const e of events) {
    const day = new Date(e.startTime).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz || undefined });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  return groups;
}

let myTeamsOnlyFilter = false;
function eventInvolvesFavoriteTeam(event) {
  const favorites = getFavoriteTeams();
  if (!favorites.length) return false;
  return (event.teams || []).some((t) => t.code && favorites.includes(t.code));
}
async function loadLeagueFilter() {
  allLeagues = await getLeagues();
  curatedLeagues = allLeagues.filter(isMajorLeague);
  const sorted = [...curatedLeagues].sort((a, b) => a.name.localeCompare(b.name));
  leagueFilterEl.innerHTML =
    `<button class="league-pill my-teams-pill ${myTeamsOnlyFilter ? "active" : ""}" data-my-teams="1">★ My Teams</button>` +
    `<button class="league-pill active" data-id="__all__">All Leagues</button>` +
    sorted.map((l) => `<button class="league-pill" data-id="${l.id}">${l.name}</button>`).join("");
  const myTeamsBtn = leagueFilterEl.querySelector(".my-teams-pill");
  if (myTeamsBtn) {
    myTeamsBtn.addEventListener("click", () => {
      myTeamsOnlyFilter = !myTeamsOnlyFilter;
      myTeamsBtn.classList.toggle("active", myTeamsOnlyFilter);
      loadActiveTab();
    });
  }
  leagueFilterEl.querySelectorAll(".league-pill:not(.my-teams-pill)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (id === "__all__") {
        selectedLeagueIds.clear();
        leagueFilterEl.querySelectorAll(".league-pill:not(.my-teams-pill)").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      } else {
        leagueFilterEl.querySelector('.league-pill[data-id="__all__"]').classList.remove("active");
        btn.classList.toggle("active");
        if (selectedLeagueIds.has(id)) selectedLeagueIds.delete(id);
        else selectedLeagueIds.add(id);
        if (selectedLeagueIds.size === 0) {
          leagueFilterEl.querySelector('.league-pill[data-id="__all__"]').classList.add("active");
        }
      }
      loadActiveTab();
    });
  });
}
let tournamentsStatusFilter = "ongoing";
function pickTournamentByStatus(tournaments, league, status) {
  if (!tournaments || !tournaments.length) return null;
  const now = Date.now();
  const override = liquipediaDateOverrideForLeague(league);
  if (override) {
    const overrideStart = startOfUtcDay(override.startDate);
    const overrideEnd = endOfUtcDay(override.endDate);
    if (status === "ongoing") return now >= overrideStart && now <= overrideEnd ? tournaments[0] || null : null;
    if (status === "upcoming") return now < overrideStart ? tournaments[0] || null : null;
    if (status === "completed") return now > overrideEnd ? tournaments[0] || null : null;
  }
  if (status === "ongoing") return findActiveTournament(tournaments, league);
  const withDates = tournaments.filter((t) => t.startDate);
  const isFuture = (t) => new Date(t.startDate).getTime() > now && (!t.endDate || new Date(t.endDate).getTime() > now);
  const isPast = (t) => (t.endDate ? new Date(t.endDate).getTime() <= now : new Date(t.startDate).getTime() <= now);
  if (status === "upcoming") {
    const future = withDates.filter(isFuture).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    return future[0] || null;
  }
  if (status === "completed") {
    const past = withDates.filter(isPast).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    return past[0] || null;
  }
  return null;
}

let lastTabContentHtml = null;
function setTabContent(html) {
  if (html === lastTabContentHtml) return false;
  lastTabContentHtml = html;
  tabContentEl.innerHTML = html;
  return true;
}
async function loadTournamentsTab(silent = false) {
  if (!silent) {
    setTabContent(`
    <div class="tournaments-filter-row">
      <select id="tournaments-status-select" class="tournaments-status-select">
        <option value="ongoing">Ongoing</option>
        <option value="upcoming">Upcoming</option>
        <option value="completed">Completed</option>
      </select>
    </div>
    <p class="loading">Loading tournaments…</p>`);
  }
  const selectEl = tabContentEl.querySelector("#tournaments-status-select");
  if (selectEl) {
    selectEl.value = tournamentsStatusFilter;
    selectEl.addEventListener("change", () => {
      tournamentsStatusFilter = selectEl.value;
      if (typeof updateNavLabels === "function") updateNavLabels();
      loadTournamentsTab();
    });
  }
  try {
    const leaguesToShow =
      selectedLeagueIds.size > 0 ? curatedLeagues.filter((l) => selectedLeagueIds.has(l.id)) : curatedLeagues;
    const results = await Promise.all(
      leaguesToShow.map(async (league) => {
        const tournaments = await getTournamentsForLeague(league.id);
        return { league, tournament: pickTournamentByStatus(tournaments, league, tournamentsStatusFilter) };
      })
    );
    const withTournament = results.filter((r) => r.tournament);
    const gridHtml = withTournament.length
      ? `<div class="tournaments-grid">${withTournament
          .map(
            ({ league, tournament }) => `
            <a class="tournament-card" href="#/tournament/${encodeURIComponent(league.id)}/${encodeURIComponent(tournament.id)}">
              ${leagueLogoHtml(league, "tournament-card-logo")}
              <div class="tournament-card-name">${league.name}</div>
              <div class="tournament-card-dates hint">${resolvedTournamentDateRangeLabel(league, tournament)}</div>
            </a>`
          )
          .join("")}</div>`
      : `<p class="idle">No ${tournamentsStatusFilter} tournaments found for the selected leagues.</p>`;
    const selectHtml = `
      <div class="tournaments-filter-row">
        <select id="tournaments-status-select" class="tournaments-status-select">
          <option value="ongoing">Ongoing</option>
          <option value="upcoming">Upcoming</option>
          <option value="completed">Completed</option>
        </select>
      </div>`;

    if (setTabContent(selectHtml + gridHtml)) {
      const freshSelectEl = tabContentEl.querySelector("#tournaments-status-select");
      if (freshSelectEl) {
        freshSelectEl.value = tournamentsStatusFilter;
        freshSelectEl.addEventListener("change", () => {
          tournamentsStatusFilter = freshSelectEl.value;
          loadTournamentsTab();
        });
      }
    }
  } catch {

    if (!silent) setTabContent(`<p class="idle">Couldn't load tournaments right now.</p>`);
  }
}

async function eventIsGenuinelyLive(event) {
  try {
    const detail = await getEventDetails(event.id);
    return detail.state === "inProgress";
  } catch {
    return false;
  }
}
async function loadLiveTab(silent = false) {
  if (!silent) setTabContent(`<p class="loading">Checking for live matches…</p>`);
  try {
    const events = await getLive(liveTabLeagueIds());
    if (!events.length) {
      setTabContent(`<p class="idle">No League of Legends esports matches are live right now. Check the Upcoming tab for what's next.</p>`);
      return;
    }
    const checked = await Promise.all(events.map(async (e) => ((await eventIsGenuinelyLive(e)) ? e : null)));
    let genuinelyLive = await resolveEwcHomeEvents(checked.filter(Boolean));
    if (!genuinelyLive.length) {
      setTabContent(`<p class="idle">No League of Legends esports matches are live right now. Check the Upcoming tab for what's next.</p>`);
      return;
    }
    if (myTeamsOnlyFilter) {
      genuinelyLive = genuinelyLive.filter(eventInvolvesFavoriteTeam);
      if (!genuinelyLive.length) {
        setTabContent(
          getFavoriteTeams().length
            ? `<p class="idle">None of your favorited teams are live right now.</p>`
            : `<p class="idle">You haven't favorited any teams yet - star a team on its team page or the Teams grid to filter matches down to just them.</p>`
        );
        return;
      }
    }
    setTabContent(`<div class="live-grid">${genuinelyLive.map(matchCardHtml).join("")}</div>`);
  } catch (err) {
    console.error(err);
    if (!silent) setTabContent(`<p class="idle">Couldn't load live matches right now.</p>`);
  }
}
async function loadScheduleTab(state, silent = false) {
  if (!silent) setTabContent(`<p class="loading">Loading…</p>`);
  try {
    const rawEvents = await getSchedule(effectiveLeagueIds());
    const events = await resolveEwcHomeEvents(rawEvents);
    const now = Date.now();
    let filtered = events.filter((e) => e.state === state);
    if (state === "unstarted") {
      filtered = filtered.filter((e) => new Date(e.startTime).getTime() > now);
      filtered.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    } else if (state === "completed") {
      filtered.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }
    if (myTeamsOnlyFilter) {
      filtered = filtered.filter(eventInvolvesFavoriteTeam);
    }
    if (!filtered.length) {
      setTabContent(
        myTeamsOnlyFilter && !getFavoriteTeams().length
          ? `<p class="idle">You haven't favorited any teams yet - star a team on its team page or the Teams grid to filter matches down to just them.</p>`
          : `<p class="idle">No matches found for this filter.</p>`
      );
      return;
    }
    const groups = groupByDay(filtered);
    const dayBlocks = [...groups.entries()].map(
      ([day, dayEvents]) => `<h3 class="day-heading">${day}</h3>${dayEvents.map(matchCardHtml).join("")}`
    );

    if (setTabContent(paginatedBlocksHtml(dayBlocks, 5))) wirePagination(tabContentEl);
  } catch (err) {
    console.error(err);
    if (!silent) setTabContent(`<p class="idle">Couldn't load the schedule right now.</p>`);
  }
}
function loadActiveTab(silent = false) {
  if (activeTab === "live") loadLiveTab(silent);
  else if (activeTab === "tournaments") loadTournamentsTab(silent);
  else loadScheduleTab(activeTab, silent);
}
const EXCLUDED_LOCALES = ["ar-ae"];
function localeRank(locale) {
  if (locale && locale.toLowerCase().startsWith("en")) return 0;
  const idx = LOCALE_PRIORITY.indexOf(locale);
  return idx === -1 ? 999 : idx + 1;
}

function streamDedupeKey(s) {
  const provider = providerName(s.provider);
  if (provider === "youtube") return `youtube:${extractYoutubeId(s.parameter)}`;
  return `${provider}:${String(s.parameter || "").trim().toLowerCase()}`;
}
function pickStreams(streams) {
  if (!streams || streams.length === 0) return [];
  const sorted = [...streams]
    .filter((s) => !EXCLUDED_LOCALES.includes((s.locale || "").toLowerCase()))
    .sort((a, b) => localeRank(a.locale) - localeRank(b.locale));

  const seen = new Set();
  const deduped = [];
  for (const s of sorted) {
    const key = streamDedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped;
}
function providerName(provider) {
  return (provider || "").toLowerCase();
}
function extractYoutubeId(param) {
  if (!param) return param;
  const value = String(param).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  const patterns = [/[?&]v=([a-zA-Z0-9_-]{11})/, /youtu\.be\/([a-zA-Z0-9_-]{11})/, /embed\/([a-zA-Z0-9_-]{11})/];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) return m[1];
  }
  return value;
}
function embedUrlForStream(stream) {
  const parentHost = window.location.hostname || "localhost";
  const provider = providerName(stream.provider);
  if (provider === "twitch") {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(stream.parameter)}&parent=${parentHost}&muted=true`;
  }
  if (provider === "youtube") {
    return `https://www.youtube.com/embed/${encodeURIComponent(extractYoutubeId(stream.parameter))}?autoplay=1&mute=1`;
  }
  return null;
}
function watchUrlFor(item) {
  const provider = providerName(item.provider);
  if (provider === "twitch") return `https://twitch.tv/${item.parameter}`;
  if (provider === "youtube") return `https://www.youtube.com/watch?v=${extractYoutubeId(item.parameter)}`;
  return null;
}
function embedUrlForVod(vod) {
  const parentHost = window.location.hostname || "localhost";
  const provider = providerName(vod.provider);
  if (provider === "twitch") {
    return `https://player.twitch.tv/?video=${encodeURIComponent(vod.parameter)}&parent=${parentHost}`;
  }
  if (provider === "youtube") {
    return `https://www.youtube.com/embed/${encodeURIComponent(extractYoutubeId(vod.parameter))}`;
  }
  return null;
}

function isPlayableVod(v) {
  const provider = providerName(v.provider);
  if (provider === "twitch") return !!(v.parameter && String(v.parameter).trim());
  if (provider === "youtube") return /^[a-zA-Z0-9_-]{11}$/.test(extractYoutubeId(v.parameter) || "");
  return false;
}

function highlightsChannelSearchUrl(league, teams) {
  const teamNames = (teams || []).map((t) => t.name || t.code).filter(Boolean).join(" vs ");
  const query = `${league?.name || ""} ${teamNames}`.trim();
  return `https://www.youtube.com/@oplolreplay/search?query=${encodeURIComponent(query)}`;
}

function streamPosterHtml(label) {
  return `<button type="button" class="stream-poster"><span class="stream-poster-play">&#9654;</span><span class="stream-poster-label">${label}</span></button>`;
}
function mountStreamPoster(wrap, label, onPlay) {
  wrap.innerHTML = streamPosterHtml(label);
  const btn = wrap.querySelector(".stream-poster");
  if (btn) btn.addEventListener("click", onPlay);
}

function mountStreamPlayer(wrap, url, onReload) {
  if (!url) {
    wrap.innerHTML = `<div class="no-stream">This stream provider isn't supported for embedding.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="stream-embed-frame">
      <iframe src="${url}" allowfullscreen class="stream-embed"></iframe>
      ${onReload ? `<button type="button" class="stream-reload-btn" title="Stream frozen or stuck? Reload it.">&#8635; Reload</button>` : ""}
    </div>`;
  if (onReload) {
    const btn = wrap.querySelector(".stream-reload-btn");
    if (btn) btn.addEventListener("click", onReload);
  }
}
function streamSectionHtml(items, kind) {
  if (!items || !items.length) {
    return `<div class="no-stream">${kind === "live" ? "No official stream link available for this match yet." : "No VOD available yet."}</div>`;
  }
  const first = items[0];
  const firstWatchUrl = watchUrlFor(first);
  const localeButtons =
    items.length > 1
      ? `<div class="locale-switch">${items
          .map(
            (s, idx) =>
              `<button class="locale-btn ${idx === 0 ? "active" : ""}" data-idx="${idx}" data-kind="${kind}">${providerName(s.provider) === "twitch" ? "Twitch" : "YouTube"} (${s.locale})</button>`
          )
          .join("")}</div>`
      : "";
  const providerLabel = providerName(first.provider) === "twitch" ? "Twitch" : "YouTube";
  return `
    ${localeButtons}
    <div class="stream-embed-wrap" id="${kind}-embed-wrap">${streamPosterHtml(`Click to play on ${providerLabel}`)}</div>
    <div class="stream-controls-row">
      <div id="${kind}-watch-link-wrap">${firstWatchUrl ? `<a class="watch-link" href="${firstWatchUrl}" target="_blank" rel="noopener">If the player above doesn't load, watch on ${providerLabel} directly ↗</a>` : ""}</div>
      <button class="theatre-toggle-btn" type="button">⛶ Theatre Mode</button>
    </div>`;
}

function wireTheatreToggle(container) {
  const btns = container.querySelectorAll(".theatre-toggle-btn");
  if (!btns.length) return;
  const label = () => (matchViewEl.classList.contains("theatre-mode") ? "⛶ Exit Theatre Mode" : "⛶ Theatre Mode");
  const syncAll = () => btns.forEach((b) => { b.textContent = label(); });
  syncAll();
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      matchViewEl.classList.toggle("theatre-mode");
      syncAll();
    });
  });
}
function wireStreamSection(container, items, kind) {
  const urlFor = kind === "live" ? embedUrlForStream : embedUrlForVod;
  const wrap = container.querySelector(`#${kind}-embed-wrap`);
  if (!wrap || !items || !items.length) return;
  const state = { idx: 0, playing: false };
  const remount = () => {
    const base = urlFor(items[state.idx]);
    const bustUrl = base ? `${base}${base.includes("?") ? "&" : "?"}_r=${Date.now()}` : base;
    mountStreamPlayer(wrap, bustUrl, remount);
  };
  const play = () => {
    remount();
    state.playing = true;
  };
  const showPoster = () => {
    const providerLabel = providerName(items[state.idx].provider) === "twitch" ? "Twitch" : "YouTube";
    mountStreamPoster(wrap, `Click to play on ${providerLabel}`, play);
  };
  showPoster();
  container.querySelectorAll(`.locale-btn[data-kind="${kind}"]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(`.locale-btn[data-kind="${kind}"]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.idx = Number(btn.dataset.idx);
      const item = items[state.idx];
      const watchWrap = container.querySelector(`#${kind}-watch-link-wrap`);
      const watchUrl = watchUrlFor(item);
      if (watchWrap) {
        watchWrap.innerHTML = watchUrl
          ? `<a class="watch-link" href="${watchUrl}" target="_blank" rel="noopener">If the player above doesn't load, watch on ${providerName(item.provider) === "twitch" ? "Twitch" : "YouTube"} directly ↗</a>`
          : "";
      }
      if (state.playing) play();
      else showPoster();
    });
  });
}
function costreamSectionHtml() {
  return `
    <div class="costream-section">
      <h3>Community Co-Streams</h3>
      <div id="costream-list" class="costream-list"><p class="loading">Checking who's live…</p></div>
    </div>`;
}
let matchPageCostreamKey = null;
async function isCostreamerLive(twitchLogin) {
  const sentinel = "LOL_ESPORTS_HUB_OFFLINE_SENTINEL";
  try {
    const url = `https://decapi.me/twitch/uptime?channel=${encodeURIComponent(twitchLogin)}&offline_msg=${encodeURIComponent(sentinel)}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const text = (await res.text()).trim();
    return text.length > 0 && text !== sentinel && !/error/i.test(text);
  } catch {
    return false;
  }
}
function costreamEmbedUrl(twitchLogin) {
  const parentHost = window.location.hostname || "localhost";
  return `https://player.twitch.tv/?channel=${encodeURIComponent(twitchLogin)}&parent=${parentHost}&muted=true`;
}

function costreamBlockHtml(liveOnes) {
  if (!liveOnes.length) {
    return `<p class="idle">No community co-streams are live right now.</p>`;
  }
  const switcher =
    liveOnes.length > 1
      ? `<div class="costream-select-row">
          <label for="costream-select" class="costream-select-label">Choose stream</label>
          <select id="costream-select" class="costream-select">
            ${liveOnes.map((c, idx) => `<option value="${idx}">${c.name}</option>`).join("")}
          </select>
        </div>`
      : "";
  return `
    ${switcher}
    <div class="stream-embed-wrap" id="costream-embed-wrap"></div>
    <div class="stream-controls-row">
      <span></span>
      <button class="theatre-toggle-btn" type="button">⛶ Theatre Mode</button>
    </div>`;
}
function wireCostreamSwitch(container, liveOnes) {
  const wrap = container.querySelector("#costream-embed-wrap");
  if (!wrap) return;
  const state = { idx: 0, playing: false };
  const remount = () => {
    const base = costreamEmbedUrl(liveOnes[state.idx].twitch);
    mountStreamPlayer(wrap, `${base}&_r=${Date.now()}`, remount);
  };
  const play = () => {
    remount();
    state.playing = true;
  };
  const showPoster = () => mountStreamPoster(wrap, `Click to play ${liveOnes[state.idx].name} on Twitch`, play);
  showPoster();
  const select = container.querySelector("#costream-select");
  if (select) {
    select.addEventListener("change", () => {
      state.idx = Number(select.value);
      if (state.playing) play();
      else showPoster();
    });
  }
}

async function loadCostreamStatuses(container, force, teams) {
  const section = container.querySelector(".costream-section");
  const slot = container.querySelector("#costream-list");
  if (!slot) return;
  try {
    const results = await Promise.all(
      COSTREAMERS.map(async (c) => ({ ...c, live: await isCostreamerLive(c.twitch) }))
    );
    const liveOnes = results.filter((c) => c.live);
    let confirmedOnes = liveOnes;
    if (teams && teams.length === 2 && liveOnes.length) {
      const titles = await Promise.all(liveOnes.map((c) => decapiTwitchTitle(c.twitch)));
      confirmedOnes = liveOnes.filter((c, i) => teams.every((t) => titleMentionsTeam(titles[i], t)));
    }
    const key = confirmedOnes.map((c) => c.twitch).sort().join(",");
    if (!force && key === matchPageCostreamKey) return;
    matchPageCostreamKey = key;
    if (!confirmedOnes.length) {
      if (section) section.style.display = "none";
      return;
    }
    if (section) section.style.display = "";
    slot.innerHTML = costreamBlockHtml(confirmedOnes);
    wireCostreamSwitch(slot, confirmedOnes);
    wireTheatreToggle(container);
  } catch {
    if (!matchPageCostreamKey) slot.innerHTML = `<p class="idle">Couldn't check co-stream status right now.</p>`;
  }
}
function recentFormHtml(teamCode, n = 20) {
  if (!teamCode) return "";
  const results = scheduleCache
    .filter((e) => e.state === "completed" && e.teams.some((t) => t.code === teamCode))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, n)
    .map((e) => e.teams.find((t) => t.code === teamCode).outcome);
  if (!results.length) return `<span class="form-empty">No recent results loaded</span>`;
  return results.map((r) => `<span class="form-pip ${r}">${r === "win" ? "W" : "L"}</span>`).join("");
}
function recentWinRate(teamCode, n = 20) {
  if (!teamCode) return null;
  const results = scheduleCache
    .filter((e) => e.state === "completed" && e.teams.some((t) => t.code === teamCode))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, n)
    .map((e) => e.teams.find((t) => t.code === teamCode).outcome);
  if (!results.length) return null;
  const wins = results.filter((r) => r === "win").length;
  return { games: results.length, wins, winRatePct: Math.round((wins / results.length) * 100) };
}

function headToHeadGames(codeA, codeB, currentEventId, n = 10) {
  if (!codeA || !codeB) return [];
  return scheduleCache
    .filter(
      (e) =>
        e.state === "completed" &&
        e.id !== currentEventId &&
        e.teams.some((t) => t.code === codeA) &&
        e.teams.some((t) => t.code === codeB)
    )
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, n);
}

function computePredictionPct(teams, currentEventId) {
  if (!teams || teams.length !== 2) return null;
  const [a, b] = teams;
  const formA = recentWinRate(a.code, 20);
  const formB = recentWinRate(b.code, 20);
  const h2hGames = a.code && b.code ? headToHeadGames(a.code, b.code, currentEventId, 20) : [];
  const h2hAWins = h2hGames.filter((e) => e.teams.find((t) => t.code === a.code)?.outcome === "win").length;
  const h2hBWins = h2hGames.length - h2hAWins;

  const rateA = formA ? formA.winRatePct : formB ? 100 - formB.winRatePct : null;
  const rateB = formB ? formB.winRatePct : formA ? 100 - formA.winRatePct : null;
  let formShareA = null;
  if (rateA !== null && rateB !== null) {
    const sum = rateA + rateB;
    formShareA = sum > 0 ? (rateA / sum) * 100 : 50;
  }

  const h2hShareA = h2hGames.length ? (h2hAWins / h2hGames.length) * 100 : null;

  let pctA;
  if (formShareA !== null && h2hShareA !== null) {
    const h2hWeight = Math.min(0.5, h2hGames.length * 0.15);
    pctA = formShareA * (1 - h2hWeight) + h2hShareA * h2hWeight;
  } else if (formShareA !== null) {
    pctA = formShareA;
  } else if (h2hShareA !== null) {
    pctA = h2hShareA;
  } else {
    return null;
  }

  pctA = Math.min(92, Math.max(8, Math.round(pctA)));
  return { pctA, pctB: 100 - pctA, formA, formB, h2hGames, h2hAWins, h2hBWins };
}
function predictionHtml(teams, currentEventId) {
  if (!teams || teams.length !== 2) return "";
  const [a, b] = teams;
  const nameA = a.code || a.name || "Team A";
  const nameB = b.code || b.name || "Team B";
  const result = computePredictionPct(teams, currentEventId);
  if (!result) {
    return `<h3>AI Prediction</h3><p class="hint prediction-basis">No completed match history loaded yet for either team, so there's nothing to base a prediction on.</p>`;
  }
  const { pctA, pctB, formA, formB, h2hGames, h2hAWins, h2hBWins } = result;
  const basisParts = [];
  if (formA) basisParts.push(`${nameA} ${formA.wins}W-${formA.games - formA.wins}L in their last ${formA.games}`);
  if (formB) basisParts.push(`${nameB} ${formB.wins}W-${formB.games - formB.wins}L in their last ${formB.games}`);
  const formBasis = basisParts.length ? `Recent form: ${basisParts.join(", ")}.` : "";
  const h2hBasis = h2hGames.length
    ? ` Head-to-head: ${nameA} ${h2hAWins}-${h2hBWins} ${nameB} over their last ${h2hGames.length} meeting${h2hGames.length === 1 ? "" : "s"}.`
    : "";
  const favored = pctA === pctB ? "" : pctA > pctB ? nameA : nameB;
  return `
    <h3>AI Prediction</h3>
    <div class="prediction-bar" role="img" aria-label="${nameA} ${pctA}% - ${nameB} ${pctB}%">
      <div class="prediction-bar-fill prediction-bar-a" style="width:${pctA}%">${pctA >= 20 ? `${nameA} ${pctA}%` : ""}</div>
      <div class="prediction-bar-fill prediction-bar-b" style="width:${pctB}%">${pctB >= 20 ? `${nameB} ${pctB}%` : ""}</div>
    </div>
    <p class="prediction-basis">${favored ? `${favored} favored ${Math.max(pctA, pctB)}% to win. ` : ""}${formBasis}${h2hBasis}</p>`;
}
function headToHeadHtml(teams, currentEventId) {
  if (!teams || teams.length !== 2) return "";
  const [a, b] = teams;
  if (!a.code || !b.code) return "";
  const games = headToHeadGames(a.code, b.code, currentEventId, 10);
  if (!games.length) {
    return `<h3>Head-to-Head</h3><p class="hint prediction-basis">No previous meetings between these two teams loaded yet.</p>`;
  }
  const aWins = games.filter((e) => e.teams.find((t) => t.code === a.code)?.outcome === "win").length;
  const bWins = games.length - aWins;
  const rows = games
    .map((e) => {
      const winnerCode = e.teams.find((t) => t.outcome === "win")?.code;
      return `
      <a class="game-row recent-match-row" href="#/match/${encodeURIComponent(e.id)}">
        ${leagueLogoHtml(e.league, "recent-match-league-logo")}
        <div class="match-teams">${teamHtml(e.teams.find((t) => t.code === a.code))}<div class="vs">vs</div>${teamHtml(e.teams.find((t) => t.code === b.code))}</div>
        <div class="match-meta">
          <span class="hint">${winnerCode ? `${winnerCode} won` : ""}</span>
          <span class="match-time">${localTimeLabel(e.startTime)}</span>
        </div>
      </a>`;
    })
    .join("");
  return `
    <h3>Head-to-Head <span class="hint">(last ${games.length} meeting${games.length === 1 ? "" : "s"})</span></h3>
    <p class="prediction-basis">${a.code} ${aWins} - ${bWins} ${b.code}</p>
    <div class="games-list">${rows}</div>`;
}

function ddragonVersionFromPatch(patchVersion) {
  if (!patchVersion) return null;
  const parts = String(patchVersion).split(".");
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}.1`;
}
function itemIconUrl(itemId, ddragonVersion) {
  if (!itemId || !ddragonVersion) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${itemId}.png`;
}

function championIconUrl(championId, ddragonVersion) {
  if (!championId || !ddragonVersion) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${championId}.png`;
}
function playerRowHtml(participant, meta, side, items, ddragonVersion, goldDiff) {
  const gold = participant && typeof participant.totalGold === "number" ? participant.totalGold.toLocaleString() : "-";
  const cs = participant && participant.creepScore != null ? participant.creepScore : "-";
  const kda = participant ? `${participant.kills ?? 0}/${participant.deaths ?? 0}/${participant.assists ?? 0}` : "-/-/-";
  const level = participant && participant.level != null ? participant.level : null;
  const hpPct =
    participant && participant.maxHealth
      ? Math.max(0, Math.min(100, Math.round((participant.currentHealth / participant.maxHealth) * 100)))
      : null;
  const champion = formatChampionName(meta && meta.championId) || "-";
  const championIcon = championIconUrl(meta && meta.championId, ddragonVersion);
  const summoner = (meta && meta.summonerName) || "";
  const itemIds = (items || []).filter((id) => id);
  const itemsHtml =
    itemIds.length && ddragonVersion
      ? `<div class="liveplayer-items">${itemIds
          .map((id) => `<img src="${itemIconUrl(id, ddragonVersion)}" alt="" class="liveplayer-item-icon" loading="lazy" onerror="this.style.visibility='hidden'">`)
          .join("")}</div>`
      : "";
  const champIconHtml = championIcon
    ? `<span class="liveplayer-champ-icon-wrap">
        <img src="${championIcon}" alt="${champion}" class="liveplayer-champ-icon" loading="lazy" onerror="this.style.visibility='hidden'">
        ${level !== null ? `<span class="liveplayer-champ-level">${level}</span>` : ""}
      </span>`
    : "";
  const goldDiffHtml =
    goldDiff != null && goldDiff !== 0
      ? `<span class="liveplayer-golddiff ${goldDiff >= 0 ? "pos" : "neg"}">${goldDiff >= 0 ? "+" : "-"}${Math.abs(Math.round(goldDiff)).toLocaleString()}</span>`
      : "";
  return `
    <div class="liveplayer-card">
      <div class="liveplayer-row ${side}">
        ${champIconHtml}
        <div class="liveplayer-id">
          <span class="liveplayer-champ">${champion}</span>
          <span class="liveplayer-name">${summoner}</span>
        </div>
        ${hpPct !== null ? `<div class="liveplayer-hp"><div class="liveplayer-hp-fill ${side}" style="width:${hpPct}%"></div></div>` : ""}
        <span class="liveplayer-kda">${kda}</span>
        <span class="liveplayer-cs">${cs} CS</span>
        <span class="liveplayer-gold">${gold}${goldDiffHtml}</span>
      </div>
      ${itemsHtml}
    </div>`;
}
function buildSortedRoster(teamMetadata) {
  const roster = buildRosterLookup(teamMetadata);
  return [...roster.values()].sort((a, b) => participantRoleOrder(a.role) - participantRoleOrder(b.role));
}

function rosterTableHtml(sortedMetas, participants, side, itemsByParticipant, ddragonVersion, laneGoldDiffs) {
  if (!sortedMetas.length) return "";
  return `<div class="liveplayer-list ${side}">${sortedMetas
    .map((meta, idx) => {
      const p = (participants || []).find((x) => x.participantId === meta.participantId);
      const items = itemsByParticipant && itemsByParticipant.get(meta.participantId);
      const diff = laneGoldDiffs ? laneGoldDiffs[idx] : null;
      return playerRowHtml(p, meta, side, items, ddragonVersion, diff);
    })
    .join("")}</div>`;
}

function teamNameForSide(gm, sideKey, teams) {
  const meta = gm && gm[sideKey];
  const teamId = meta && meta.esportsTeamId;
  const match = teamId && (teams || []).find((t) => t.id === teamId);
  if (match) return match.code || match.name;
  return sideKey === "blueTeamMetadata" ? "Blue Side" : "Red Side";
}

const DRAGON_ICON_KEY = {
  infernal: "fire",
  ocean: "water",
  mountain: "earth",
  cloud: "air",
  hextech: "hextech",
  chemtech: "chemtech",
  elder: "elder",
};
const DRAGON_FALLBACK_TEXT = {
  infernal: "Infernal",
  ocean: "Ocean",
  mountain: "Mountain",
  cloud: "Cloud",
  hextech: "Hextech",
  chemtech: "Chemtech",
  elder: "Elder",
};
function objectiveIconHtml(iconUrl, fallbackText, alt) {
  const safeFallback = String(fallbackText).replace(/'/g, "");
  if (!iconUrl) return `<span class="obj-badge-text">${fallbackText}</span>`;
  return `<span class="obj-badge"><img src="${iconUrl}" alt="${alt}" class="obj-badge-icon" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'obj-badge-text',textContent:'${safeFallback}'}))"></span>`;
}
function dragonBadgeHtml(d) {
  const type = (typeof d === "string" ? d : d && (d.type || d.dragonType || d.name)) || "";
  const key = String(type).toLowerCase();
  const iconKey = DRAGON_ICON_KEY[key];
  const fallback = DRAGON_FALLBACK_TEXT[key] || "Dragon";
  const iconUrl = iconKey ? `https://raw.communitydragon.org/latest/game/assets/hud/icons2d/scoreboard_dragon_${iconKey}.png` : null;
  return objectiveIconHtml(iconUrl, fallback, `${fallback} Dragon`);
}
function dragonBadgesHtml(dragons) {
  const list = dragons || [];
  if (!list.length) return "-";
  return `<span class="obj-badge-row">${list.map(dragonBadgeHtml).join("")}</span>`;
}
function baronBadgeHtml(count) {
  if (!count) return "0";
  const icon = objectiveIconHtml("https://raw.communitydragon.org/latest/game/assets/hud/icons2d/scoreboard_baron.png", "Baron", "Baron");
  return `<span class="obj-badge-row">${icon}<span class="obj-badge-count">${count}</span></span>`;
}
function liveStatsHtml(stats, teams) {
  if (!stats || (!stats.blueTeam && !stats.redTeam)) {
    return `<p class="idle">Live stats aren't available for this match right now.</p>`;
  }
  const row = (label, blue, red) => `
    <div class="livestat-row">
      <span class="livestat-val blue">${blue ?? "-"}</span>
      <span class="livestat-label">${label}</span>
      <span class="livestat-val red">${red ?? "-"}</span>
    </div>`;
  const b = stats.blueTeam || {};
  const r = stats.redTeam || {};
  const gm = stats.gameMetadata;
  const ddragonVersion = gm ? ddragonVersionFromPatch(gm.patchVersion) : null;
  let rosterHtml = "";
  if (gm) {
    const blueSorted = buildSortedRoster(gm.blueTeamMetadata);
    const redSorted = buildSortedRoster(gm.redTeamMetadata);
    const laneCount = Math.max(blueSorted.length, redSorted.length);
    const laneGoldDiffsBlue = [];
    const laneGoldDiffsRed = [];
    for (let i = 0; i < laneCount; i++) {
      const bp = blueSorted[i] && (b.participants || []).find((x) => x.participantId === blueSorted[i].participantId);
      const rp = redSorted[i] && (r.participants || []).find((x) => x.participantId === redSorted[i].participantId);
      const bg = bp && typeof bp.totalGold === "number" ? bp.totalGold : null;
      const rg = rp && typeof rp.totalGold === "number" ? rp.totalGold : null;
      const diff = bg != null && rg != null ? bg - rg : null;
      laneGoldDiffsBlue.push(diff);
      laneGoldDiffsRed.push(diff != null ? -diff : null);
    }
    const blueTeamName = teamNameForSide(gm, "blueTeamMetadata", teams);
    const redTeamName = teamNameForSide(gm, "redTeamMetadata", teams);
    rosterHtml = `<div class="liveplayer-panel">
        <div class="liveplayer-column">
          <div class="liveplayer-team-header blue">${blueTeamName}</div>
          ${rosterTableHtml(blueSorted, b.participants, "blue", stats.itemsByParticipant, ddragonVersion, laneGoldDiffsBlue)}
        </div>
        <div class="liveplayer-column">
          <div class="liveplayer-team-header red">${redTeamName}</div>
          ${rosterTableHtml(redSorted, r.participants, "red", stats.itemsByParticipant, ddragonVersion, laneGoldDiffsRed)}
        </div>
      </div>`;
  }
  const patchHtml = gm && gm.patchVersion ? `<span class="livestats-patch">Patch ${gm.patchVersion.split(".").slice(0, 2).join(".")}</span>` : "";

  return `
    ${patchHtml ? `<div class="livestats-clock">${patchHtml}</div>` : ""}
    <div class="livestats-panel">
      ${row("Gold", typeof b.totalGold === "number" ? b.totalGold.toLocaleString() : b.totalGold, typeof r.totalGold === "number" ? r.totalGold.toLocaleString() : r.totalGold)}
      ${row("Kills", b.totalKills, r.totalKills)}
      ${row("Towers", b.towers, r.towers)}
      ${row("Dragons", dragonBadgesHtml(b.dragons), dragonBadgesHtml(r.dragons))}
      ${row("Barons", baronBadgeHtml(b.barons), baronBadgeHtml(r.barons))}
    </div>
    ${rosterHtml}`;
}

function detectLiveEvents(prevStats, currStats, teams) {
  const events = [];
  if (!prevStats || !currStats) return events;
  const gm = currStats.gameMetadata;
  const sides = [
    { key: "blueTeam", metaKey: "blueTeamMetadata" },
    { key: "redTeam", metaKey: "redTeamMetadata" },
  ];
  const killerHits = [];
  const victimHits = [];
  let totalKillDelta = 0;
  for (const side of sides) {
    const p = prevStats[side.key] || {};
    const c = currStats[side.key] || {};
    const sideName = gm ? teamNameForSide(gm, side.metaKey, teams) : side.key === "blueTeam" ? "Blue Side" : "Red Side";
    const towerDelta = (c.towers || 0) - (p.towers || 0);
    if (towerDelta > 0) events.push({ text: `${sideName} destroys a tower${towerDelta > 1 ? ` (x${towerDelta})` : ""}`, type: "tower" });
    const baronDelta = (c.barons || 0) - (p.barons || 0);
    if (baronDelta > 0) events.push({ text: `${sideName} takes Baron Nashor`, type: "baron" });
    const prevDragonCount = (p.dragons || []).length;
    const currDragons = c.dragons || [];
    if (currDragons.length > prevDragonCount) {
      for (const d of currDragons.slice(prevDragonCount)) {
        const type = (typeof d === "string" ? d : d && (d.type || d.dragonType || d.name)) || "";
        const label = DRAGON_FALLBACK_TEXT[String(type).toLowerCase()] || "a";
        events.push({ text: `${sideName} takes the ${label} Drake`, type: "dragon" });
      }
    }
    const roster = gm ? buildRosterLookup(gm[side.metaKey]) : null;
    const pParts = p.participants || [];
    for (const cp of c.participants || []) {
      const pp = pParts.find((x) => x.participantId === cp.participantId);
      if (!pp) continue;
      const killDelta = (cp.kills || 0) - (pp.kills || 0);
      const deathDelta = (cp.deaths || 0) - (pp.deaths || 0);
      if (killDelta > 0) {
        const meta = roster && roster.get(cp.participantId);
        killerHits.push({ name: (meta && meta.summonerName) || "A player", count: killDelta });
        totalKillDelta += killDelta;
      }
      if (deathDelta > 0) {
        const meta = roster && roster.get(cp.participantId);
        victimHits.push({ name: (meta && meta.summonerName) || "a player", count: deathDelta });
      }
    }
  }
  if (killerHits.length === 1 && victimHits.length === 1 && killerHits[0].count === 1 && victimHits[0].count === 1) {
    events.push({ text: `${killerHits[0].name} kills ${victimHits[0].name}`, type: "kill" });
  } else if (totalKillDelta > 0) {
    events.push({ text: `Team fight! ${totalKillDelta} kill${totalKillDelta > 1 ? "s" : ""}`, type: "kill" });
  }
  return events;
}
function showEventToast(text, variant) {
  if (typeof document === "undefined") return;
  const container = document.getElementById("event-toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `event-toast${variant ? ` event-toast-${variant}` : ""}`;
  el.textContent = text;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("event-toast-show"));
  setTimeout(() => {
    el.classList.add("event-toast-hide");
    setTimeout(() => el.remove(), 400);
  }, 5000);
}

function playVictoryChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    setTimeout(() => ctx.close(), (notes.length * 0.16 + 0.7) * 1000);
  } catch {
  }
}
let liveStatsPollTimer = null;
let currentLiveStatsGameId = null;
let liveEventPrevStats = null;

function stopLiveStatsExtras() {
  if (liveStatsPollTimer) {
    clearInterval(liveStatsPollTimer);
    liveStatsPollTimer = null;
  }
  currentLiveStatsGameId = null;
  liveEventPrevStats = null;
}

function countdownPartsFromNow(targetMs) {
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) return null;
  const totalSeconds = Math.floor(diffMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}
function countdownDigitsHtml(parts) {
  const pad = (n) => String(n).padStart(2, "0");
  const segments = parts.days > 0 ? [`${parts.days}d`, pad(parts.hours) + "h"] : [pad(parts.hours) + "h"];
  segments.push(pad(parts.minutes) + "m", pad(parts.seconds) + "s");
  return segments.map((s) => `<span class="countdown-segment">${s}</span>`).join('<span class="countdown-sep">:</span>');
}
function stopMatchPageCountdown() {
  if (matchPageCountdownTimer) {
    clearInterval(matchPageCountdownTimer);
    matchPageCountdownTimer = null;
  }
}
function startMatchPageCountdown(startTimeIso) {
  stopMatchPageCountdown();
  const targetMs = new Date(startTimeIso).getTime();
  if (Number.isNaN(targetMs)) return;
  const tick = () => {
    const el = matchMainEl.querySelector("#match-countdown-slot");

    if (!el) {
      stopMatchPageCountdown();
      return;
    }
    const parts = countdownPartsFromNow(targetMs);
    if (!parts) {
      el.innerHTML = `<span class="countdown-segment countdown-imminent">Starting any moment…</span>`;
      stopMatchPageCountdown();
      return;
    }
    el.innerHTML = countdownDigitsHtml(parts);
  };
  tick();
  matchPageCountdownTimer = setInterval(tick, 1000);
}

function startLiveStatsPolling(eventId, gameId, hintStartTime, teams) {
  if (liveStatsPollTimer) {
    clearInterval(liveStatsPollTimer);
    liveStatsPollTimer = null;
  }
  currentLiveStatsGameId = gameId;
  liveEventPrevStats = null;

  let consecutiveMisses = 0;
  liveStatsPollTimer = setInterval(async () => {
    const r = getRoute();
    if (!(r.view === "match" && r.id === eventId)) {
      clearInterval(liveStatsPollTimer);
      liveStatsPollTimer = null;
      return;
    }
    const slot = matchMainEl.querySelector("#live-stats-slot");
    if (!slot) return;
    try {
      const stats = await getLiveStats(gameId);
      if (stats) {
        consecutiveMisses = 0;
        for (const evt of detectLiveEvents(liveEventPrevStats, stats, teams)) {
          showEventToast(evt.text, evt.type);
        }
        liveEventPrevStats = stats;
        slot.innerHTML = liveStatsHtml(stats, teams);
      } else {
        consecutiveMisses += 1;
        if (consecutiveMisses >= 3) slot.innerHTML = liveStatsHtml(null, teams);
      }
    } catch {
      consecutiveMisses += 1;
      if (consecutiveMisses >= 3) slot.innerHTML = liveStatsHtml(null, teams);
    }
  }, 8 * 1000);
}
function stopMatchPagePolling() {
  if (matchPagePollTimer) {
    clearInterval(matchPagePollTimer);
    matchPagePollTimer = null;
  }
  stopLiveStatsExtras();
  stopMatchPageCountdown();
}
async function renderMatchPage(eventId) {
  stopMatchPagePolling();
  stopTournamentPagePolling();
  matchPageStreamState = null;
  matchPageCostreamKey = null;
  homeViewEl.classList.add("hidden");
  tournamentViewEl.classList.add("hidden");
  teamViewEl.classList.add("hidden");
  matchViewEl.classList.remove("hidden");
  matchViewEl.classList.remove("theatre-mode");
  matchMainEl.innerHTML = `<a class="back-link" href="#/">&larr; Back to schedule</a><p class="loading">Loading match…</p>`;
  window.scrollTo(0, 0);
  let event = scheduleCache.find((e) => e.id === eventId);
  if (!event) {
    try {
      const events = await getLive([]);
      event = events.find((e) => e.id === eventId);
    } catch {
    }
  }
  if (!event) {
    try {
      const events = await getSchedule(effectiveLeagueIds());
      event = events.find((e) => e.id === eventId);
    } catch {
    }
  }

  if (!event) {
    let peek = null;
    try {
      peek = await getEventDetails(eventId);
    } catch {
    }
    if (peek && peek.startTime && !isOnOrAfterCutoff(peek.startTime)) {
      matchMainEl.innerHTML = `<a class="back-link" href="#/">&larr; Back to schedule</a><p class="idle">This match is from before 2023 and isn't available on lolgg.</p>`;
      return;
    }
  }
  if (event && isUnresolvedEwcEvent(event)) {
    const resolvedEvent = await resolveEwcHomeEventById(eventId);
    if (resolvedEvent) event = resolvedEvent;
  }
  await paintMatchPage(eventId, event);
  matchPagePollTimer = setInterval(() => {
    const r = getRoute();
    if (r.view === "match" && r.id === eventId) {
      refreshMatchPage(eventId, event);
    } else {
      stopMatchPagePolling();
    }
  }, 30 * 1000);
}
async function refreshMatchPage(eventId, event) {
  let detail;
  try {
    detail = await getEventDetails(eventId);
  } catch {
    return;
  }
  const newState = detail.state || (event ? event.state : "unstarted");
  if (newState !== matchPageStreamState) {
    await paintMatchPage(eventId, event);
    return;
  }
  if (newState === "inProgress") {

    const liveGame = pickCurrentLiveGame(detail.games);
    const slot = matchMainEl.querySelector("#live-stats-slot");
    if (slot) {

      if (liveGame && liveGame.state !== "completed") {
        if (liveGame.id !== currentLiveStatsGameId) {
          const stats = await getLiveStats(liveGame.id);
          slot.innerHTML = liveStatsHtml(stats, event ? event.teams : []);
          startLiveStatsPolling(eventId, liveGame.id, event ? event.startTime : null, event ? event.teams : []);
        }
      } else {
        stopLiveStatsExtras();
        slot.innerHTML = `<p class="idle">Live stats will go live once the game goes live.</p>`;
      }
    }
  }
  const teams = event ? event.teams : [];
  const formSlot = matchMainEl.querySelector("#recent-form-slot");
  if (formSlot) {
    formSlot.innerHTML = `
      ${teams.map((t) => `<div class="recent-form-row"><span class="form-team">${t.code || t.name}</span><span class="form-pips">${recentFormHtml(t.code)}</span></div>`).join("")}
    `;
  }
  const predictionSlot = matchMainEl.querySelector("#prediction-slot");
  if (predictionSlot) predictionSlot.innerHTML = predictionHtml(teams, eventId);
  const h2hSlot = matchMainEl.querySelector("#h2h-slot");
  if (h2hSlot) h2hSlot.innerHTML = headToHeadHtml(teams, eventId);
  if (newState === "inProgress") loadCostreamStatuses(matchMainEl, false, teams);
}
async function paintMatchPage(eventId, event) {
  let detail = { streams: [], games: [], state: event ? event.state : undefined };
  try {
    detail = await getEventDetails(eventId);
  } catch {
    matchMainEl.innerHTML = `<a class="back-link" href="#/">&larr; Back to schedule</a><p class="idle">Couldn't load this match right now.</p>`;
    return;
  }
  const state = detail.state || (event ? event.state : "unstarted");

  const prevPageState = matchPageStreamState;
  const teams = event ? event.teams : [];
  const league = event ? event.league : null;
  const startTime = event ? event.startTime : null;

  const streams = isEwcLeague(league)
    ? pickStreams(detail.streams).filter((s) => providerName(s.provider) === "twitch")
    : pickStreams(detail.streams);
  const allVods = (detail.games || []).flatMap((g) => g.vods || []);
  const vods = pickStreams(allVods);
  let liveStreamItems = streams;
  let ewcFallbackHint = "";
  if (!streams.length && isEwcLeague(league) && state === "inProgress") {
    let matched = null;
    try {
      matched = await resolveEwcStreamForMatch(teams);
    } catch {
    }
    if (matched) {
      liveStreamItems = [matched];
      ewcFallbackHint = `<p class="hint">Matched from the arena stream's live title (no per-match EWC stream link yet).</p>`;
    } else {
      liveStreamItems = ewcArenaStreamItems();
      ewcFallbackHint = `<p class="hint">No per-match EWC stream link yet &ndash; pick whichever arena stage this match is on.</p>`;
    }
  }
  let streamBlockHtml;
  if (state === "inProgress") {

    streamBlockHtml = `<h3>Live Stream</h3>${streamSectionHtml(liveStreamItems, "live")}${ewcFallbackHint}${await officialStreamLinksHtml(league, startTime)}${costreamSectionHtml()}`;
  } else if (state === "completed") {

    const playableVods = vods.filter(isPlayableVod);
    streamBlockHtml = playableVods.length
      ? `<h3>Watch VOD</h3>${streamSectionHtml(playableVods, "vod")}`
      : `<h3>Watch Highlights</h3><div class="no-stream">No official VOD link available for this match.</div><a class="watch-link" href="${highlightsChannelSearchUrl(league, teams)}" target="_blank" rel="noopener">Search for highlights on oplolreplay (YouTube) ↗</a>`;
  } else {
    const when = startTime
      ? `Scheduled for ${localTimeLabel(startTime)} (${getActiveTimeZone() || "your local time"}). The stream will appear here automatically once the match goes live.`
      : "The stream will appear here automatically once the match goes live.";

    const countdownHtml = startTime
      ? `<div class="match-countdown" id="match-countdown-slot">${(() => {
          const parts = countdownPartsFromNow(new Date(startTime).getTime());
          return parts ? countdownDigitsHtml(parts) : `<span class="countdown-segment countdown-imminent">Starting any moment…</span>`;
        })()}</div>`
      : "";

    streamBlockHtml = `<h3>Stream</h3>${countdownHtml}<div class="no-stream">${when}</div><p class="hint">If this match already started, but the streams are not showing, please use the links below to access.</p>${await officialStreamLinksHtml(league, startTime)}`;
  }
  const liquipediaQuery = `${league?.name || ""} ${teams.map((t) => t.name).join(" ")}`.trim();
  const liquipediaSearchUrl = `https://liquipedia.net/leagueoflegends/Special:Search?search=${encodeURIComponent(liquipediaQuery)}`;

  let tournamentHref = null;
  if (event) {
    const resolvedTournament = await resolveTournamentForEvent(event);
    if (resolvedTournament && league && league.id) {
      tournamentHref = `#/tournament/${encodeURIComponent(league.id)}/${encodeURIComponent(resolvedTournament.id)}`;
    } else if (league && league.id) {
      tournamentHref = `#/tournament/${encodeURIComponent(league.id)}`;
    }
  }
  const bracketLinkHtml = tournamentHref
    ? `<a class="watch-link" href="${tournamentHref}">Full bracket ↗</a>`
    : `<a class="watch-link" href="${liquipediaSearchUrl}" target="_blank" rel="noopener">Full bracket on Liquipedia ↗</a>`;
  const modalHeaderInner = `
      ${leagueLogoHtml(league, "modal-league-logo")}
      <div>
        <div class="modal-league">${league?.name || ""}${event?.blockName ? ` · ${event.blockName}` : ""}</div>
        <div class="modal-state">${state === "inProgress" ? "Ongoing" : state === "completed" ? "Final" : startTime ? localTimeLabel(startTime) : ""}${event?.bestOf ? ` · Bo${event.bestOf}` : ""}</div>
      </div>`;
  matchMainEl.innerHTML = `
    <a class="back-link" href="#/">&larr; Back to schedule</a>
    <div class="modal-header">
      ${
        tournamentHref
          ? `<a class="modal-header-link" href="${tournamentHref}" title="View full tournament">${modalHeaderInner}</a>`
          : modalHeaderInner
      }
    </div>
    <div class="match-teams modal-teams">${teams
      .map((t, idx) => {

        const star = t.code ? favoriteStarHtml(t.code, "match-team-star") : "";
        const info = teamHtml(t, state === "unstarted");
        const inner = idx === 0 ? `${star}${info}` : `${info}${star}`;
        return t.code ? `<a class="team-link" href="#/team/${encodeURIComponent(t.code)}">${inner}</a>` : info;
      })
      .join('<div class="vs">vs</div>')}</div>
    ${streamBlockHtml}
    ${
      state === "inProgress"
        ? `<h3>Live In-Game Stats</h3><div id="live-stats-slot"><p class="loading">Loading live stats…</p></div>`
        : ""
    }
    <h3>Recent Form <span class="hint">(last 20 results)</span></h3>
    <div id="recent-form-slot" class="recent-form-grid">
      ${teams.map((t) => `<div class="recent-form-row"><span class="form-team">${t.code || t.name}</span><span class="form-pips">${recentFormHtml(t.code)}</span></div>`).join("")}
    </div>
    <div id="prediction-slot">${predictionHtml(teams, eventId)}</div>
    <div id="h2h-slot">${headToHeadHtml(teams, eventId)}</div>
    ${bracketLinkHtml}
  `;
  if (state === "inProgress" && liveStreamItems.length) wireStreamSection(matchMainEl, liveStreamItems, "live");
  if (state === "completed" && vods.length) wireStreamSection(matchMainEl, vods, "vod");
  if (state === "inProgress") loadCostreamStatuses(matchMainEl, true, teams);
  if (state === "unstarted" && startTime) startMatchPageCountdown(startTime);
  else stopMatchPageCountdown();
  if (state === "inProgress") {
    const liveGame = pickCurrentLiveGame(detail.games);
    const slot = matchMainEl.querySelector("#live-stats-slot");
    if (slot) {

      if (liveGame && liveGame.state !== "completed") {
        const stats = await getLiveStats(liveGame.id);
        slot.innerHTML = liveStatsHtml(stats, teams);
        startLiveStatsPolling(eventId, liveGame.id, startTime, teams);
      } else {
        stopLiveStatsExtras();
        slot.innerHTML = `<p class="idle">Live stats will go live once the game goes live.</p>`;
      }
    }
  } else {
    stopLiveStatsExtras();
  }
  wireTheatreToggle(matchMainEl);
  if (prevPageState && prevPageState !== state) {
    if (state === "inProgress") {
      showEventToast("Match is live!", "start");
    } else if (state === "completed" && prevPageState === "inProgress") {
      showEventToast("Game complete!", "end");
      playVictoryChime();
    }
  }
  matchPageStreamState = state;
}
function getRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("match/")) {
    return { view: "match", id: decodeURIComponent(hash.slice("match/".length)) };
  }
  if (hash.startsWith("tournament/")) {
    const rest = hash.slice("tournament/".length);
    const [leagueIdRaw, tournamentIdRaw] = rest.split("/");
    return {
      view: "tournament",
      id: decodeURIComponent(leagueIdRaw || ""),
      tournamentId: tournamentIdRaw ? decodeURIComponent(tournamentIdRaw) : null,
    };
  }
  if (hash.startsWith("team/")) {
    return { view: "team", id: decodeURIComponent(hash.slice("team/".length)) };
  }
  return { view: "home" };
}
function renderHome() {
  stopMatchPagePolling();
  stopTournamentPagePolling();
  matchViewEl.classList.add("hidden");
  matchMainEl.innerHTML = "";
  tournamentViewEl.classList.add("hidden");
  teamViewEl.classList.add("hidden");
  homeViewEl.classList.remove("hidden");
  loadActiveTab();
}
function extractTeamsFromStandings(standings, providedLookup) {
  if (!standings || !standings.stages) return [];
  const lookup = providedLookup || buildStandingsTeamLookup(standings);
  const byId = new Map();
  for (const stage of standings.stages) {
    for (const section of stage.sections || []) {
      for (const r of section.rankings || []) {
        for (const t of r.teams || []) {
          const key = t.id || t.code || t.name;
          if (key && !byId.has(key)) byId.set(key, t);
        }
      }
      for (const m of section.matches || []) {
        for (const t of m.teams || []) {
          const resolved = resolveMatchTeam(t, lookup) || t;
          const key = resolved.id || resolved.code || resolved.name;
          if (key && !byId.has(key)) byId.set(key, resolved);
        }
      }
    }
  }
  return [...byId.values()];
}
function paginatedBlocksHtml(blocksHtml, pageSize, wrapperClass = "") {
  if (!blocksHtml.length) return "";
  const rows = blocksHtml
    .map((html, idx) => `<div class="pg-item${idx >= pageSize ? " pg-hidden" : ""}">${html}</div>`)
    .join("");
  const btn = blocksHtml.length > pageSize ? `<button class="load-more-btn" data-pg-size="${pageSize}">Show more</button>` : "";
  return `<div class="pg-list ${wrapperClass}">${rows}</div>${btn}`;
}
function wirePagination(container) {
  container.querySelectorAll(".load-more-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pageSize = parseInt(btn.dataset.pgSize, 10) || 10;
      const list = btn.previousElementSibling;
      if (!list) return;
      const hidden = list.querySelectorAll(".pg-hidden");
      for (let i = 0; i < Math.min(pageSize, hidden.length); i++) hidden[i].classList.remove("pg-hidden");
      if (list.querySelectorAll(".pg-hidden").length === 0) btn.remove();
    });
  });
}
function teamsGridHtml(teams) {
  if (!teams.length) return `<p class="idle">No team list available yet for this tournament.</p>`;
  return `<div class="teams-grid">${teams
    .map((t) => {
      const inner = `${t.code ? favoriteStarHtml(t.code, "team-card-star") : ""}${teamLogoHtml(t)}<div class="team-name">${t.name || t.code || "TBD"}</div>`;
      return t.code
        ? `<a class="team-card" href="#/team/${encodeURIComponent(t.code)}">${inner}</a>`
        : `<div class="team-card">${inner}</div>`;
    })
    .join("")}</div>`;
}

function vodLikelyAvailable(startTime) {
  if (!startTime) return true;
  const ageMs = Date.now() - new Date(startTime).getTime();
  return ageMs < 7 * 24 * 60 * 60 * 1000;
}
function tournamentGameRowHtml(e, actionLabel) {
  const isCompleted = actionLabel === "Watch VOD ↗";
  const teams = e.teams.map((t) => (isCompleted ? t : { ...t, gameWins: null }));
  const label = isCompleted && !vodLikelyAvailable(e.startTime) ? "View match ↗" : actionLabel;
  return `
    <a class="game-row recent-match-row" href="#/match/${encodeURIComponent(e.id)}">
      <div class="match-teams">${teams.map((t) => teamHtml(t)).join('<div class="vs">vs</div>')}</div>
      <div class="match-meta">
        <span class="hint">${e.bestOf ? `Bo${e.bestOf}` : ""}</span>
        <span class="match-time">${localTimeLabel(e.startTime)}</span>
        <span class="watch-link">${label}</span>
      </div>
    </a>`;
}

function tournamentLiveGameRowHtml(e) {
  const teams = e.teams.map((t) => ({ ...t, gameWins: null }));
  return `
    <a class="game-row recent-match-row tournament-live-row" href="#/match/${encodeURIComponent(e.id)}">
      <span class="live-dot" aria-hidden="true"></span>
      <div class="match-teams">${teams.map((t) => teamHtml(t)).join('<div class="vs">vs</div>')}</div>
      <div class="match-meta">
        <span class="hint">${e.bestOf ? `Bo${e.bestOf}` : ""}</span>
        <span class="watch-link">Watch Live ↗</span>
      </div>
    </a>`;
}
async function getLiveEventsForTournament(leagueId, tournament, league) {
  try {
    const events = await getSchedule([leagueId]);
    const override = liquipediaDateOverrideForLeague(league);
    const range = override
      ? { start: override.startDate, end: override.endDate }
      : tournament && tournament.startDate && tournament.endDate
      ? { start: tournament.startDate, end: tournament.endDate }
      : null;
    const inRange = events.filter((e) => {
      if (e.state !== "inProgress") return false;
      if (!range) return true;
      const t = new Date(e.startTime).getTime();
      return t >= startOfUtcDay(range.start) && t <= endOfUtcDay(range.end);
    });

    const checked = await Promise.all(inRange.map(async (e) => ((await eventIsGenuinelyLive(e)) ? e : null)));
    return checked.filter(Boolean).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  } catch {
    return [];
  }
}
async function getUpcomingEventsForTournament(leagueId, tournament, league) {
  try {

    const events = await resolveEwcHomeEvents(await getSchedule([leagueId]));
    const override = liquipediaDateOverrideForLeague(league);
    const range = override
      ? { start: override.startDate, end: override.endDate }
      : tournament && tournament.startDate && tournament.endDate
      ? { start: tournament.startDate, end: tournament.endDate }
      : null;
    return events
      .filter((e) => {
        if (e.state !== "unstarted") return false;
        if (!range) return true;
        const t = new Date(e.startTime).getTime();
        return t >= startOfUtcDay(range.start) && t <= endOfUtcDay(range.end);
      })
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .slice(0, 40);
  } catch {
    return [];
  }
}

async function getAllTournamentBracketEvents(leagueId, tournament, league, recentGames, standings, teamLookup) {
  try {
    const events = await getSchedule([leagueId]);
    const override = liquipediaDateOverrideForLeague(league);
    const range = override
      ? { start: override.startDate, end: override.endDate }
      : tournament && tournament.startDate && tournament.endDate
      ? { start: tournament.startDate, end: tournament.endDate }
      : null;
    const inRange = range
      ? events.filter((e) => {
          const t = new Date(e.startTime).getTime();
          return t >= startOfUtcDay(range.start) && t <= endOfUtcDay(range.end);
        })
      : events;
    const byId = new Map(inRange.map((e) => [e.id, e]));

    for (const e of recentGames) byId.set(e.id, e);

    const haveTeamPair = (list, a, b) =>
      list.some((e) => {
        const codes = (e.teams || []).map((t) => (t.code || "").toUpperCase()).filter(Boolean);
        return codes.includes(a) && codes.includes(b);
      });

    const scheduleSoFar = [...byId.values()];
    for (const e of standingsBracketEvents(standings, teamLookup, league)) {
      const codes = (e.teams || []).map((t) => (t.code || "").toUpperCase()).filter(Boolean);
      if (codes.length === 2 && haveTeamPair(scheduleSoFar, codes[0], codes[1])) continue;
      byId.set(e.id || `standings:${codes.join("-")}`, e);
    }

    const unresolvedSeenAtTime = new Map();
    for (const e of [...byId.values()]) {
      const isUnresolved = isUnresolvedMatch(e.teams);
      if (!isUnresolved || !e.startTime) continue;
      const key = new Date(e.startTime).getTime();
      const existing = unresolvedSeenAtTime.get(key);
      if (existing === undefined) {
        unresolvedSeenAtTime.set(key, e.id);
      } else if (String(e.id) > String(existing)) {
        byId.delete(e.id);
      } else {
        byId.delete(existing);
        unresolvedSeenAtTime.set(key, e.id);
      }
    }

    if (isEwcLeague(league)) {
      const overrideTimes = EWC_PLAYOFFS_QF_OVERRIDE.map((m) => new Date(m.startTime).getTime());
      const overrideDayKeys = new Set(overrideTimes.map((t) => new Date(t).toISOString().slice(0, 10)));
      for (const e of [...byId.values()]) {
        const isBlank = isUnresolvedMatch(e.teams);
        if (!isBlank) continue;
        const blockNameLooksLikeQuarterfinal = (e.blockName || "").toLowerCase().includes("quarter");
        let sameDayAsOverride = false;
        let withinWideWindow = false;
        if (e.startTime) {
          const t = new Date(e.startTime).getTime();
          sameDayAsOverride = overrideDayKeys.has(new Date(t).toISOString().slice(0, 10));
          withinWideWindow = overrideTimes.some((ot) => Math.abs(t - ot) < 12 * 60 * 60 * 1000);
        }
        if (blockNameLooksLikeQuarterfinal || sameDayAsOverride || withinWideWindow) {
          byId.delete(e.id);
        }
      }
    }

    const soFar = [...byId.values()];
    const usedRealSlotIds = new Set();
    for (const ov of ewcPlayoffsOverrideEvents(league, soFar, teamLookup)) {
      const codes = (ov.teams || []).map((t) => (t.code || "").toUpperCase()).filter(Boolean);
      if (codes.length === 2 && haveTeamPair(soFar, codes[0], codes[1])) continue;
      const ovTime = ov.startTime ? new Date(ov.startTime).getTime() : null;

      let bestSlot = null;
      let bestDelta = Infinity;
      for (const e of soFar) {
        if (e.manualOverride || e.fromStandings || usedRealSlotIds.has(e.id)) continue;
        const isUnresolved = isUnresolvedMatch(e.teams);
        if (!isUnresolved || !e.startTime || ovTime === null) continue;
        const delta = Math.abs(new Date(e.startTime).getTime() - ovTime);
        if (delta < 60 * 60 * 1000 && delta < bestDelta) {
          bestDelta = delta;
          bestSlot = e;
        }
      }
      if (bestSlot) {
        bestSlot.teams = ov.teams;
        usedRealSlotIds.add(bestSlot.id);
        continue;
      }
      byId.set(ov.id, ov);
    }

    const resolvedBlockNames = new Set(
      [...byId.values()]
        .filter((e) => (e.teams || []).some((t) => !isTbdPlaceholderTeam(t)))
        .map((e) => e.blockName || "")
    );
    for (const e of [...byId.values()]) {
      const isUnresolved = isUnresolvedMatch(e.teams);
      if (isUnresolved && resolvedBlockNames.has(e.blockName || "")) {
        byId.delete(e.id);
      }
    }

    return [...byId.values()];
  } catch {
    return recentGames.slice();
  }
}

async function getAllTournamentRecentGames(leagueId, tournament, league, recentGames) {
  try {
    const events = await getSchedule([leagueId]);
    const override = liquipediaDateOverrideForLeague(league);
    const range = override
      ? { start: override.startDate, end: override.endDate }
      : tournament && tournament.startDate && tournament.endDate
      ? { start: tournament.startDate, end: tournament.endDate }
      : null;
    const inRange = range
      ? events.filter((e) => {
          const t = new Date(e.startTime).getTime();
          return t >= startOfUtcDay(range.start) && t <= endOfUtcDay(range.end);
        })
      : events;
    const scheduleCompleted = inRange.filter((e) => e.state === "completed");
    const byId = new Map(scheduleCompleted.map((e) => [e.id, e]));

    for (const e of recentGames) byId.set(e.id, e);
    return [...byId.values()];
  } catch {
    return recentGames.slice();
  }
}

function isRegularSeasonBlockName(name) {
  const n = (name || "").toLowerCase().trim();
  if (!n) return false;

  return /^week\s*\d+$/.test(n) || n === "regular season" || n === "groups" || n === "group stage";
}

function teamSlotHtml(t, feederMatch, feederOutcome = "win", hideScore = false, excludeCode = null) {
  const known = t && !isTbdPlaceholderTeam(t);
  if (known) {

    const showScore = !hideScore && t.gameWins !== null && t.gameWins !== undefined;
    return `
      <div class="bracket-match-team ${t.outcome === "win" ? "won" : ""}">
        ${teamLogoHtml(t)}
        <span class="bracket-team-name">${shortTeamLabel(t)}</span>
        <span class="bracket-team-score">${showScore ? t.gameWins : ""}</span>
      </div>`;
  }
  const feederTeams = (feederMatch && feederMatch.teams) || [];

  const feederPick = feederTeams.length === 2
    ? feederTeams.find((ft) => ft.outcome === feederOutcome && (ft.code || ft.name || "").toUpperCase() !== excludeCode)
    : null;
  if (feederPick) {
    return `
      <div class="bracket-match-team bracket-match-team-pending">
        ${teamLogoHtml(feederPick)}
        <span class="bracket-team-name">${shortTeamLabel(feederPick)}</span>
      </div>`;
  }
  if (feederTeams.length === 2 && feederTeams.every((ft) => !isTbdPlaceholderTeam(ft))) {
    const verb = feederOutcome === "loss" ? "Loser" : "Winner";
    const label = `${verb} of ${shortTeamLabel(feederTeams[0])} vs ${shortTeamLabel(feederTeams[1])}`;
    return `
      <div class="bracket-match-team bracket-match-team-pending">
        <span class="bracket-team-name bracket-team-name-pending">${label}</span>
      </div>`;
  }
  return `
    <div class="bracket-match-team">
      <span class="bracket-team-name">TBD</span>
    </div>`;
}

function bracketColumnMatchHtml(event, advanceInfo, feeders, feederOutcome = "win") {
  const stateLabel = event.state === "inProgress" ? "Ongoing" : event.state === "completed" ? "Final" : "";
  const eventTeams = event.teams || [];
  const teamsHtml = eventTeams
    .map((t, idx) => {

      const sibling = eventTeams.find((other, otherIdx) => otherIdx !== idx && other && !isTbdPlaceholderTeam(other));
      const excludeCode = sibling ? (sibling.code || sibling.name || "").toUpperCase() : null;
      let feederForSlot = feeders ? feeders[idx] : null;

      if (feeders && feeders.length === 2 && isTbdPlaceholderTeam(t) && excludeCode) {
        const correctFeeder = feeders.find(
          (f) => f && !(f.teams || []).some((ft) => (ft.code || ft.name || "").toUpperCase() === excludeCode)
        );
        if (correctFeeder) feederForSlot = correctFeeder;
      }
      return teamSlotHtml(t, feederForSlot, feederOutcome, event.state === "unstarted", excludeCode);
    })
    .join("");
  const advanceHtml = advanceInfo
    ? `<div class="bracket-advance">&rarr; ${advanceInfo.opponent ? `vs ${shortTeamLabel(advanceInfo.opponent)} next` : "advances"}</div>`
    : "";
  const metaHtml = `
    <div class="bracket-match-meta">
      ${stateLabel ? `<span class="state-badge ${event.state}">${stateLabel}</span>` : `<span class="match-time">${event.startTime ? bracketTimeLabel(event.startTime) : "Date TBD"}</span>`}
      ${event.bestOf ? `<span class="best-of">Bo${event.bestOf}</span>` : ""}
    </div>
    ${advanceHtml}`;

  const hasRealId = event.id && !event.manualOverride;
  if (!hasRealId) {
    const teamNames = (event.teams || []).map((t) => t.name || t.code).filter(Boolean).join(" vs ");
    const leagueName = (event.league && event.league.name) || "";
    const liquipediaUrl = `https://liquipedia.net/leagueoflegends/Special:Search?search=${encodeURIComponent(`${leagueName} ${teamNames}`.trim())}`;
    return `<a class="bracket-match ${event.state || ""} bracket-match-manual" href="${liquipediaUrl}" target="_blank" rel="noopener">${teamsHtml}${metaHtml}</a>`;
  }
  return `<a class="bracket-match ${event.state || ""}" href="#/match/${encodeURIComponent(event.id)}">${teamsHtml}${metaHtml}</a>`;
}

function matchWinnerTeam(event) {
  const teams = event.teams || [];
  if (teams.length !== 2) return null;
  return teams.find((t) => t.outcome === "win") || null;
}
function findNextRoundOpponentInfo(winnerTeam, nextColumnEvents) {
  if (!winnerTeam || !nextColumnEvents) return null;
  const key = winnerTeam.code || winnerTeam.name;
  if (!key) return null;
  for (const e of nextColumnEvents) {
    const teams = e.teams || [];
    if (teams.some((t) => (t.code || t.name) === key)) {
      const opponent = teams.find((t) => (t.code || t.name) !== key);
      return { nextEvent: e, opponent };
    }
  }
  return null;
}

function tournamentBracketByBlockHtml(events) {
  const withTeams = events.filter((e) => e.teams && e.teams.length && !isRegularSeasonBlockName(e.blockName));

  const resolvedRoundNames = new Set(withTeams.filter((e) => !isUnresolvedMatch(e.teams)).map((e) => e.blockName || "Matches"));
  const realEvents = withTeams.filter((e) => !isUnresolvedMatch(e.teams) || !resolvedRoundNames.has(e.blockName || "Matches"));
  if (!realEvents.length) return "";
  const groups = new Map();
  for (const e of realEvents) {

    let key = e.blockName || "Matches";
    if (e.id === EWC_THIRD_PLACE_MATCH_ID) key = "3rd Place Match";
    else if (e.id === EWC_GRAND_FINAL_MATCH_ID) key = "Grand Final";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const timeOrEnd = (e) => (e.startTime ? new Date(e.startTime).getTime() : Infinity);
  const ordered = [...groups.entries()]
    .map(([name, evts]) => {
      const sorted = evts.slice().sort((a, b) => timeOrEnd(a) - timeOrEnd(b));
      return { name, events: sorted, earliest: timeOrEnd(sorted[0]) };
    })
    .sort((a, b) => a.earliest - b.earliest);

  if (ordered.length <= 1 && !realEvents.some((e) => e.manualOverride || e.fromStandings)) return "";

  const semifinalsGroup = ordered.find((o) => /semifinal/i.test(o.name));
  const grandFinalGroup = ordered.find((o) => o.name === "Grand Final");
  return `<div class="bracket-columns">${ordered
    .map((g, colIdx) => {
      const isSemifinals = /semifinal/i.test(g.name);
      const isFinalsSplit = g.name === "3rd Place Match" || g.name === "Grand Final";

      const nextEvents = isSemifinals && grandFinalGroup
        ? grandFinalGroup.events
        : colIdx < ordered.length - 1 ? ordered[colIdx + 1].events : null;

      const prevEvents = isFinalsSplit && semifinalsGroup
        ? semifinalsGroup.events
        : colIdx > 0 ? ordered[colIdx - 1].events : null;
      const matchesHtml = g.events
        .map((e, i) => {
          const winner = matchWinnerTeam(e);
          const advanceInfo = winner ? findNextRoundOpponentInfo(winner, nextEvents) : null;
          let feeders = prevEvents ? [prevEvents[2 * i] || null, prevEvents[2 * i + 1] || null] : null;

          if (isSemifinals && prevEvents && isEwcLeague(e.league)) {
            const ewcFeeders = ewcSemifinalFeeders(e, prevEvents);
            if (ewcFeeders) feeders = ewcFeeders;
          }

          const feederOutcome = g.name === "3rd Place Match" ? "loss" : "win";
          return bracketColumnMatchHtml(e, advanceInfo, feeders, feederOutcome);
        })
        .join("");
      return `<div class="bracket-column">
        <h4 class="bracket-column-title">${g.name}</h4>
        <div class="bracket-column-matches">${matchesHtml}</div>
      </div>`;
    })
    .join("")}</div>`;
}

function externalBracketFallbackHtml(league) {
  const name = league ? league.name : "";
  const liquipediaUrl = `https://liquipedia.net/leagueoflegends/Special:Search?search=${encodeURIComponent(name)}`;
  const leaguepediaUrl = `https://lol.fandom.com/wiki/Special:Search?search=${encodeURIComponent(name)}`;
  return `
    <p class="idle">Bracket isn't available from our data source yet - this usually fills in once playoffs start. Liquipedia and Leaguepedia tend to have it earlier:</p>
    <div class="watch-links-row">
      <a class="watch-link" href="${liquipediaUrl}" target="_blank" rel="noopener">Look it up on Liquipedia ↗</a>
      <a class="watch-link" href="${leaguepediaUrl}" target="_blank" rel="noopener">Look it up on Leaguepedia ↗</a>
    </div>
  `;
}

async function buildTournamentContentHtml(leagueId, tournament, league) {
  let standings = null;
  try {
    standings = await getStandings(tournament.id);
  } catch {
  }
  let teamLookup = new Map();
  if (standings) {
    try {
      teamLookup = await buildFullTeamLookup(standings);
    } catch {
    }
  }
  let recentGames = [];
  try {
    const rawRecentGames = await getCompletedEventsForTournament(tournament.id);
    recentGames = await getAllTournamentRecentGames(leagueId, tournament, league, rawRecentGames);
    recentGames = recentGames
      .slice()
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, 40);
  } catch {
  }
  const upcomingGames = await getUpcomingEventsForTournament(leagueId, tournament, league);
  const liveGames = await getLiveEventsForTournament(leagueId, tournament, league);
  const bracketEvents = await getAllTournamentBracketEvents(leagueId, tournament, league, recentGames, standings, teamLookup);
  const liveGamesHtml = liveGames.length
    ? `<h3>🔴 Live Now</h3><div class="games-list">${liveGames.map(tournamentLiveGameRowHtml).join("")}</div>`
    : "";
  const recentGamesHtml = recentGames.length
    ? paginatedBlocksHtml(recentGames.map((e) => tournamentGameRowHtml(e, "Watch VOD ↗")), 10, "games-list")
    : `<p class="idle">No completed games loaded yet for this tournament.</p>`;
  const upcomingGamesHtml = upcomingGames.length
    ? paginatedBlocksHtml(upcomingGames.map((e) => tournamentGameRowHtml(e, "View match ↗")), 10, "games-list")
    : `<p class="idle">No upcoming games loaded yet for this tournament.</p>`;
  const bracketByBlockHtml = tournamentBracketByBlockHtml(bracketEvents);

  const bracketSectionHtml = bracketByBlockHtml
    ? `<h3>Bracket</h3>${bracketByBlockHtml}`
    : `<h3>Bracket</h3>${externalBracketFallbackHtml(league)}`;
  const teams = extractTeamsFromStandings(standings, teamLookup);

  const standingsSectionHtml = isEwcLeague(league)
    ? ""
    : `<h3>Standings</h3>${standingsHtml(standings, teamLookup)}`;
  const officialStreamHtml = await officialStreamLinksHtml(league);
  return `
    <h3>Official Stream</h3>
    <p class="hint">Always-on official channel(s) this tournament airs on - these are always shown here, live or not. Per-match stream links (once a specific game goes live) show up on that match's own page instead.</p>
    ${officialStreamHtml}
    ${liveGamesHtml}
    <h3>Teams</h3>
    ${teamsGridHtml(teams)}
    <h3>Upcoming Games <span class="hint">(format and dates)</span></h3>
    ${upcomingGamesHtml}
    ${bracketSectionHtml}
    ${standingsSectionHtml}
    <h3>Recent Games <span class="hint">(VODs)</span></h3>
    ${recentGamesHtml}
  `;
}
let tournamentPagePollTimer = null;
function stopTournamentPagePolling() {
  if (tournamentPagePollTimer) {
    clearInterval(tournamentPagePollTimer);
    tournamentPagePollTimer = null;
  }
}

function tournamentStatus(t, league) {
  if (!t || !t.startDate) return "unknown";
  const now = Date.now();
  const override = liquipediaDateOverrideForLeague(league);
  if (override) {
    const s = startOfUtcDay(override.startDate);
    const e = endOfUtcDay(override.endDate);
    if (now < s) return "upcoming";
    if (now > e) return "completed";
    return "ongoing";
  }
  const start = startOfUtcDay(t.startDate);
  const end = t.endDate ? endOfUtcDay(t.endDate) : start;
  if (now < start) return "upcoming";
  if (now > end) return "completed";
  return "ongoing";
}
function tournamentSwitcherHtml(leagueId, tournaments, league, currentTournamentId) {
  const sorted = (tournaments || []).filter((t) => t.startDate).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  if (sorted.length < 2) return "";
  const items = sorted.map((t) => {
    const status = tournamentStatus(t, league);
    const isCurrent = String(t.id) === String(currentTournamentId);
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    return `<a class="tournament-switcher-pill ${status} ${isCurrent ? "active" : ""}" href="#/tournament/${encodeURIComponent(leagueId)}/${encodeURIComponent(t.id)}">${statusLabel}: ${tournamentDateRangeLabel(t)}</a>`;
  });
  return `<div class="tournament-switcher">${items.join("")}</div>`;
}
async function renderTournamentPage(leagueId, tournamentId) {
  stopMatchPagePolling();
  stopTournamentPagePolling();
  homeViewEl.classList.add("hidden");
  matchViewEl.classList.add("hidden");
  matchMainEl.innerHTML = "";
  teamViewEl.classList.add("hidden");
  tournamentViewEl.classList.remove("hidden");
  tournamentMainEl.innerHTML = `<a class="back-link" href="#/">&larr; Back to schedule</a><p class="loading">Loading tournament…</p>`;
  window.scrollTo(0, 0);
  const league = curatedLeagues.find((l) => l.id === leagueId) || allLeagues.find((l) => l.id === leagueId);

  if (league && !isMajorLeague(league)) {
    tournamentMainEl.innerHTML = `
      <a class="back-link" href="#/">&larr; Back to schedule</a>
      <p class="idle">This tournament isn't covered here.</p>
    `;
    return;
  }
  const liquipediaSearchUrl = `https://liquipedia.net/leagueoflegends/Special:Search?search=${encodeURIComponent(league ? league.name : "")}`;
  let tournaments = [];
  try {
    tournaments = await getTournamentsForLeague(leagueId);
  } catch {
  }
  const tournament = (tournamentId && tournaments.find((t) => String(t.id) === String(tournamentId))) || pickDisplayTournament(tournaments, league);
  if (!tournament) {
    tournamentMainEl.innerHTML = `
      <a class="back-link" href="#/">&larr; Back to schedule</a>
      <div class="modal-header">
        ${leagueLogoHtml(league, "modal-league-logo")}
        <div><div class="modal-league">${league?.name || "Tournament"}</div></div>
      </div>
      <p class="idle">No tournament data available right now.</p>
      <a class="watch-link" href="${liquipediaSearchUrl}" target="_blank" rel="noopener">Look it up on Liquipedia ↗</a>
    `;
    return;
  }
  const contentHtml = await buildTournamentContentHtml(leagueId, tournament, league);
  const switcherHtml = tournamentSwitcherHtml(leagueId, tournaments, league, tournament.id);
  tournamentMainEl.innerHTML = `
    <a class="back-link" href="#/">&larr; Back to schedule</a>
    <div class="modal-header">
      ${leagueLogoHtml(league, "modal-league-logo")}
      <div>
        <div class="modal-league">${league?.name || "Tournament"}</div>
        <div class="modal-state">${resolvedTournamentDateRangeLabel(league, tournament)}</div>
      </div>
    </div>
    ${switcherHtml}
    <div id="tournament-content-slot">${contentHtml}</div>
    <a class="watch-link" href="${liquipediaSearchUrl}" target="_blank" rel="noopener">Full tournament page on Liquipedia ↗</a>
  `;
  wirePagination(tournamentMainEl);

  tournamentPagePollTimer = setInterval(async () => {
    const r = getRoute();
    if (!(r.view === "tournament" && r.id === leagueId && (r.tournamentId || "") === (tournamentId || ""))) {
      stopTournamentPagePolling();
      return;
    }
    const slot = tournamentMainEl.querySelector("#tournament-content-slot");
    if (!slot) return;
    try {
      slot.innerHTML = await buildTournamentContentHtml(leagueId, tournament, league);
      wirePagination(tournamentMainEl);
    } catch {
    }
  }, 30 * 1000);
}
function recentGamesForTeam(teamCode, n = 60) {
  return scheduleCache
    .filter((e) => e.state === "completed" && e.teams.some((t) => t.code === teamCode))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, n)
    .map((e) => ({
      event: e,
      self: e.teams.find((t) => t.code === teamCode),
      opponent: e.teams.find((t) => t.code !== teamCode),
    }));
}
function teamRecentGamesHtml(teamCode) {
  const games = recentGamesForTeam(teamCode, 60);
  if (!games.length) return `<p class="idle">No completed games loaded yet for this team.</p>`;
  const rows = games.map(({ event, self, opponent }) => {
    const opponentTeam = opponent || { name: "TBD", code: null, image: null, gameWins: null, outcome: null };
    return `
    <a class="game-row recent-match-row" href="#/match/${encodeURIComponent(event.id)}">
      <span class="form-pip ${self.outcome === "win" ? "win" : "loss"}">${self.outcome === "win" ? "W" : "L"}</span>
      <div class="match-teams">${teamHtml(self)}<div class="vs">vs</div>${teamHtml(opponentTeam)}</div>
      <div class="match-meta">
        <span class="hint">${event.bestOf ? `Bo${event.bestOf}` : ""}</span>
        <span class="match-time">${localTimeLabel(event.startTime)}</span>
        <span class="watch-link">${vodLikelyAvailable(event.startTime) ? "Watch VOD ↗" : "View match ↗"}</span>
      </div>
    </a>`;
  });
  return paginatedBlocksHtml(rows, 10, "games-list");
}
async function renderTeamPage(teamCode) {
  stopMatchPagePolling();
  stopTournamentPagePolling();
  homeViewEl.classList.add("hidden");
  matchViewEl.classList.add("hidden");
  matchMainEl.innerHTML = "";
  tournamentViewEl.classList.add("hidden");
  teamViewEl.classList.remove("hidden");
  teamMainEl.innerHTML = `<a class="back-link" href="#/">&larr; Back to schedule</a><p class="loading">Loading team…</p>`;
  window.scrollTo(0, 0);

  try {
    await getSchedule(curatedLeagues.map((l) => l.id));
  } catch {
  }
  const fallbackTeam = (() => {
    for (const e of scheduleCache) {
      const t = (e.teams || []).find((t) => t.code === teamCode);
      if (t) return t;
    }
    return null;
  })();
  let details = null;
  if (fallbackTeam && fallbackTeam.id) {
    try {
      details = await getTeamByQuery(fallbackTeam.id);
    } catch {
    }
  }
  const homeLeagueId = findLeagueIdByName(details && details.homeLeague ? details.homeLeague.name : null);
  try {
    if (homeLeagueId) await getSchedule([homeLeagueId]);
  } catch {
  }
  const name = (details && details.name) || (fallbackTeam && fallbackTeam.name) || teamCode;
  const image = (details && details.image) || (fallbackTeam && fallbackTeam.image) || "";
  const teamForLogo = { name, image };
  const winRate = recentWinRate(teamCode, 20);
  const liquipediaSearchUrl = `https://liquipedia.net/leagueoflegends/Special:Search?search=${encodeURIComponent(name)}`;
  const socialLinks = [
    details?.homeLeague?.name ? `<span class="hint">${details.homeLeague.name}${details.homeLeague.region ? ` · ${details.homeLeague.region}` : ""}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  teamMainEl.innerHTML = `
    <a class="back-link" href="#/">&larr; Back to schedule</a>
    <div class="modal-header">
      ${teamLogoHtml(teamForLogo)}
      <div>
        <div class="modal-league">${name} ${favoriteStarHtml(teamCode, "team-header-star")}</div>
        ${socialLinks}
      </div>
    </div>
    <h3>Win Rate <span class="hint">(last ${winRate ? winRate.games : 0} completed games)</span></h3>
    ${
      winRate
        ? `<p class="prediction-basis">${winRate.winRatePct}% (${winRate.wins}W-${winRate.games - winRate.wins}L)</p>`
        : `<p class="idle">No completed match history loaded yet for this team.</p>`
    }
    <h3>Recent Form <span class="hint">(last 20 results)</span></h3>
    <div class="recent-form-grid">
      <div class="recent-form-row"><span class="form-team">${name}</span><span class="form-pips">${recentFormHtml(teamCode)}</span></div>
    </div>
    <h3>Game History <span class="hint">(scores and VODs)</span></h3>
    ${teamRecentGamesHtml(teamCode)}
    <a class="watch-link" href="${liquipediaSearchUrl}" target="_blank" rel="noopener">Full team page on Liquipedia ↗</a>
  `;
  wirePagination(teamMainEl);
}
function route() {
  const r = getRoute();
  if (r.view === "match") renderMatchPage(r.id);
  else if (r.view === "tournament") renderTournamentPage(r.id, r.tournamentId);
  else if (r.view === "team") renderTeamPage(r.id);
  else renderHome();
}
window.addEventListener("hashchange", route);

const MATCH_TAB_LABELS = { live: "Ongoing", unstarted: "Upcoming", completed: "Completed" };
const TOURNAMENT_STATUS_LABELS = { ongoing: "Ongoing", upcoming: "Upcoming", completed: "Completed" };

const MATCHES_TO_TOURNAMENT_STATUS = { live: "ongoing", unstarted: "upcoming", completed: "completed" };
const TOURNAMENT_STATUS_TO_MATCHES = { ongoing: "live", upcoming: "unstarted", completed: "completed" };

function updateNavLabels() {
  const matchesGroup = tabsEl.querySelector('[data-nav-group="matches"]');
  const tournamentsGroup = tabsEl.querySelector('[data-nav-group="tournaments"]');
  const isMatchesActive = activeTab !== "tournaments";
  if (matchesGroup) {
    const btn = matchesGroup.querySelector(".nav-dropdown-btn");
    if (btn) {
      btn.classList.toggle("active", isMatchesActive);
      btn.innerHTML = `Matches: ${MATCH_TAB_LABELS[matchesTab]} <span class="nav-caret">&#9662;</span>`;
    }
    matchesGroup.querySelectorAll(".nav-dropdown-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.tab === matchesTab);
    });
  }
  if (tournamentsGroup) {
    const isTournamentsActive = activeTab === "tournaments";
    const btn = tournamentsGroup.querySelector(".nav-dropdown-btn");
    if (btn) {
      btn.classList.toggle("active", isTournamentsActive);
      btn.innerHTML = `Tournaments: ${TOURNAMENT_STATUS_LABELS[tournamentsStatusFilter]} <span class="nav-caret">&#9662;</span>`;
    }
    tournamentsGroup.querySelectorAll(".nav-dropdown-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.status === tournamentsStatusFilter);
    });
  }
}
function closeAllNavDropdowns() {
  tabsEl.querySelectorAll(".nav-dropdown").forEach((d) => d.classList.remove("open"));
}
tabsEl.querySelectorAll(".nav-dropdown-btn").forEach((btn) => {
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const group = btn.closest(".nav-dropdown");
    const wasOpen = group.classList.contains("open");
    closeAllNavDropdowns();
    if (!wasOpen) group.classList.add("open");
  });
});
document.addEventListener("click", () => closeAllNavDropdowns());

tabsEl.querySelectorAll(".nav-dropdown-item").forEach((item) => {
  item.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeAllNavDropdowns();
    if (item.dataset.status) {

      tournamentsStatusFilter = item.dataset.status;
      matchesTab = TOURNAMENT_STATUS_TO_MATCHES[tournamentsStatusFilter] || matchesTab;
      activeTab = "tournaments";
    } else {

      matchesTab = item.dataset.tab;
      activeTab = matchesTab;
      tournamentsStatusFilter = MATCHES_TO_TOURNAMENT_STATUS[matchesTab] || tournamentsStatusFilter;
    }
    updateNavLabels();
    if (activeTab === "tournaments" && selectedLeagueIds.size === 1) {
      const onlyId = [...selectedLeagueIds][0];
      window.location.hash = `#/tournament/${encodeURIComponent(onlyId)}`;
      return;
    }
    const currentHash = window.location.hash.replace(/^#\/?/, "");
    if (currentHash !== "") {

      window.location.hash = "#/";
    } else {
      loadActiveTab();
    }
  });
});
updateNavLabels();

function updateLocalClock() {
  const tz = getActiveTimeZone();
  const now = new Date();
  const el = document.getElementById("local-clock");
  if (el) {
    el.textContent = now.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: tz || undefined,
    });
  }

  const cornerTime = document.getElementById("top-clock-time");
  const cornerDate = document.getElementById("top-clock-date");
  if (cornerTime) {
    cornerTime.textContent = now.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || undefined,
    });
  }
  if (cornerDate) {
    cornerDate.textContent = now.toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "2-digit",
      timeZone: tz || undefined,
    });
  }
}
let localClockTimer = null;
function startLocalClockTicker() {
  if (localClockTimer) clearInterval(localClockTimer);
  updateLocalClock();
  localClockTimer = setInterval(updateLocalClock, 1000);
}
function initTimezonePicker() {
  const el = document.getElementById("tz-select");
  if (!el) return;
  el.innerHTML = TIMEZONE_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  el.value = getStoredTimeZone();
  el.addEventListener("change", () => {
    setStoredTimeZone(el.value);
    updateLocalClock();
    route();
  });
}
async function init() {
  initTimezonePicker();
  initThemePicker();
  wireFavoriteStarDelegation();
  initSiteSearch();
  startLocalClockTicker();
  await loadLeagueFilter();
  await getSchedule(effectiveLeagueIds());
  route();

  setInterval(async () => {
    await getSchedule(effectiveLeagueIds());
    const r = getRoute();

    if (r.view === "home") loadActiveTab(true);
  }, 20 * 1000);
}
init();
