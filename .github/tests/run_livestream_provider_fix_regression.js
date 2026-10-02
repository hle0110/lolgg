const fs = require("fs");
const vm = require("vm");

(async () => {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });

  const app = fs.readFileSync("/tmp/jsdomtest/app.js", "utf8");

  check("No leftover twitch/YouTube mislabeling ternary remains anywhere in app.js", !/===\s*"twitch"\s*\?\s*"Twitch"\s*:\s*"YouTube"/.test(app));
  check("A providerDisplayName helper exists to label streams by their real provider", /function providerDisplayName\(provider\)/.test(app));
  check("An isPlayableStream helper exists to filter out unplayable live-stream locale entries", /function isPlayableStream\(s\)/.test(app));
  check("Live stream items are filtered through isPlayableStream before being handed to the UI", /let liveStreamItems = streams\.filter\(isPlayableStream\);/.test(app));
  check("The EWC live-stream fallback now triggers off the filtered list, not the raw unplayable one", /if \(!liveStreamItems\.length && isEwcLeague\(league\) && state === "inProgress"\)/.test(app));

  const context = { window: { location: { hostname: "hle0110.github.io" } }, encodeURIComponent };
  vm.createContext(context);
  vm.runInContext(
    `
    ${app.match(/function providerName\(provider\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function providerDisplayName\(provider\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function extractYoutubeId\(param\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function isPlayableStream\(s\) {[\s\S]*?\n}/)[0]}
    ${app.match(/function embedUrlForStream\(stream\) {[\s\S]*?\n}/)[0]}
    `,
    context
  );

  check("A stream whose real provider is neither twitch nor youtube (e.g. afreecatv) is correctly labeled by its own name, not mislabeled YouTube", context.providerDisplayName("afreecatv") === "Afreecatv");
  check("Twitch streams still label as Twitch", context.providerDisplayName("Twitch") === "Twitch");
  check("YouTube streams still label as YouTube", context.providerDisplayName("youtube") === "YouTube");
  check("An empty/unknown provider falls back to a generic 'Stream' label instead of falsely claiming YouTube", context.providerDisplayName("") === "Stream");

  check("isPlayableStream rejects a non-twitch/non-youtube provider (the actual bug: it used to render as a broken YouTube tab)", context.isPlayableStream({ provider: "afreecatv", parameter: "somechannel" }) === false);
  check("isPlayableStream rejects a youtube entry with no usable video id", context.isPlayableStream({ provider: "youtube", parameter: "" }) === false);
  check("isPlayableStream accepts a real youtube entry", context.isPlayableStream({ provider: "youtube", parameter: "dQw4w9WgXcQ" }) === true);
  check("isPlayableStream accepts a real twitch entry", context.isPlayableStream({ provider: "twitch", parameter: "riotgames" }) === true);

  check("embedUrlForStream still returns null for unsupported providers (mountStreamPlayer's fallback message is only reachable this way)", context.embedUrlForStream({ provider: "afreecatv", parameter: "x" }) === null);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})();
