# lolgg

Everything happening in LoL esports, in one place.

**[hle0110.github.io/lolgg](https://hle0110.github.io/lolgg/)**

* Live scores, schedules, and VODs
* Tournament brackets, standings, and teams
* Official streams and costreams, embedded
* Search and favorite teams, with head to head history

No ads, no logins, no tracking. Data comes from lolesports.com's public API ([credits](https://hle0110.github.io/lolgg/credits.html)).

© 2026 lolgg. All rights reserved.
[Terms](https://hle0110.github.io/lolgg/terms.html) ·
[Privacy](https://hle0110.github.io/lolgg/privacy.html) ·
[Contact](https://hle0110.github.io/lolgg/contact.html)

## Development

Static site served by GitHub Pages from `main`. No build step.

Every push runs `.github/workflows/test.yml`: the jsdom regression suite in `.github/tests`, a zero-comments check on `app.js` and `sw.js`, and a check that changed `app.js` / `esports.css` / `style.css` got a new `?v=` in `index.html` and a new `CACHE_NAME` in `sw.js`. Run locally with `bash .github/run-tests.sh` (needs Node 22).

Not affiliated with or endorsed by Riot Games. League of Legends and related names are trademarks of Riot Games, Inc.
