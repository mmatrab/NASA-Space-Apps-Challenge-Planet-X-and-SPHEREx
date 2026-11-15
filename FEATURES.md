# Features we built

For the team, the NASA Space Apps judges, and AI agents that need context on this work.
Last updated: 15 November 2026.

## Read this first

- **Two codebases.** Our team's science platform is **ORBIT OS**. Its first module, **Space Explorer**,
  lives in [mmatrab/orbit-os](https://github.com/mmatrab/orbit-os). This repository is the source of
  truth for our **Planet X and SPHEREx** challenge entry.
- **What exists today.** Space Explorer is working software (exoplanets from the NASA Exoplanet Archive,
  shown on real sky images). The SPHEREx time-lapse tool the challenge asks for is **not built yet**:
  see [`docs/challenge-brief.md`](docs/challenge-brief.md) and [`docs/decisions.md`](docs/decisions.md).
- **Why Space Explorer matters for the challenge.** It already solves several pieces the SPHEREx tool
  needs: a sky viewer by coordinates (Aladin Lite), survey fallbacks when an image server is blocked,
  coordinates in the URL, captioned image export, and strict data-provenance rules.

## Rules every feature follows

1. Only real archive values, or figures labelled as derived. Nothing is invented, filled in or simulated.
2. Every value keeps its marking: **measured**, **derived** (calculated by the archive), or **limit**
   (direction not verified). Missing stays "Not measured".
3. Every chart shows its source (NASA Exoplanet Archive, table `pscomppars`), the snapshot date and the
   number of planets used.
4. No habitability score, no ranking of planets for life, no discovery claims made by the app or by AI.
5. Plain language first; technical terms go in brackets or tooltips.

## Space Explorer: features (repository mmatrab/orbit-os)

### Already in place before 15 November 2026

| Feature | What the user gets |
| --- | --- |
| Planet search | Search any confirmed planet or star from the NASA Exoplanet Archive (live, through the app's server) |
| Real sky image | The host star in real survey images (DSS2, 2MASS, AllWISE, Pan-STARRS via CDS, ESA mirror as backup); says so when servers are unreachable |
| Captioned PNG export | Saved sky image with planet, coordinates, survey, credit and capture time printed on it |
| Key facts | Radius, mass, orbital period in plain words, each with its paper |
| All data & references | Every value with its uncertainty, status and reference (ADS links) |
| 3D system view | Star, orbit and planet; scale and artistic choices labelled |
| Evidence export | JSON, CSV or Markdown, with a status column (measured / derived / limit) |
| Private notes | Notes kept in the visitor's browser by default |
| Embedding | iframe, web component, REST API, Express mount; `?target=` deep link |

### Added on 15 November 2026 (storytelling views)

Brief: [`docs/product/storytelling-enthusiast-path.md`](https://github.com/mmatrab/orbit-os/blob/main/docs/product/storytelling-enthusiast-path.md).
Built in parallel by two contributors (ChatGPT track and Claude), then merged and reviewed on `main`.

#### 1. Dated NASA snapshot (data layer)

- `npm run snapshot` runs **one** query on the archive's TAP service (table `pscomppars`) and writes
  `data/snapshots/planets-YYYY-MM-DD.json`. It replaces looping over the 100-rows-per-page search API
  from the browser.
- Current file: **`planets-2026-11-15.json`**, **6,470 planets**, 625 KB, retrieved
  2026-11-15T11:50:09Z. The file records the query, the source table, the retrieval time and the
  archive's citation text.
- Per value: `m` measured, `d` derived (the archive's reference says "Calculated Value"), `l` limit.
  About 1,500 radii in the archive are derived, so this marking matters.
- Each planet keeps its discovery paper (ADS bibcode), which lets milestones be checked against the data.
- Loaded only when needed (separate lazy chunk). The newest dated file wins.
- Manual GitHub Action "Refresh NASA exoplanet snapshot": regenerates the file, runs typecheck, tests
  and build, then commits.

#### 2. Guided path "Find a world" (under the search box)

Three questions about the selected planet, each with one picture and one sentence, then **Next**:

1. **How big is it?** Earth and the planet drawn to the same scale.
2. **How far is it?** Distance in light-years (1 parsec = 3.26156 light-years) on a ruler where each
   mark is ten times farther.
3. **How long is its year?** The planet's year in Earth days, next to Earth's 365.25-day year.

- A derived value says "Not measured, but estimated by the archive" in the sentence itself.
- A limit or a missing value is stated in words and never drawn.
- End screen: **Share this world** (saves the captioned sky PNG), **Copy link** (opens this planet
  directly), **Explore its sky** (brings the sky image to the front).
- Keyboard and screen-reader friendly: focus moves to each new question.
- Checked in a real browser (Chromium): the path ends in about 4 seconds; no horizontal scroll at phone
  width (390 px).

#### 3. Discovery timeline: "How did we find the planets we know?"

- One stacked bar per year from 1992 to 2026, stacked by method: Transit, Radial Velocity ("star
  wobble"), Imaging, Microlensing, Transit Timing Variations, Astrometry, Other.
- Empty years keep their slot, so the time axis is even.
- Hover shows year, method and count. Legend buttons hide or show a method and show its total.
- Colour-blind-checked palette (validated for contrast and colour-vision deficiency on the app's dark
  background).
- Three milestones, each checked against the archive's discovery reference **and** re-checked against the
  snapshot before display (a milestone the data no longer supports is hidden automatically):

  | Year | Milestone (as shown) | Published source |
  | --- | --- | --- |
  | 1992 | Earliest discoveries in the archive: 2 planets around the pulsar PSR B1257+12 | Wolszczan et al. 1992, *Nature* 355, 145 |
  | 1995 | 51 Pegasi b, found by the wobble of a Sun-type star, year of 4.2 days | Mayor & Queloz 1995, *Nature* 378, 355 |
  | 2016 | 1,269 Kepler planets confirmed in a single paper, the tallest bar | Morton et al. 2016, *ApJ* 822, 86 |

- Caption with source, table, snapshot date, file name and counts. A totals line confirms the bars add up
  to the snapshot's 6,470 planets.
- Table view with every number, including an all-years total row.

#### 4. Radius against orbital period: "Where are the Earth-sized planets, and how close are they to their stars?"

- Scatter plot with both axes logarithmic, points coloured by method, Earth marked as a reference, the
  1.5–2 Earth-radii region shaded as a gap researchers are still studying (no cause stated).
- Planets with a missing, non-positive or limit-flagged value are left out, and the number left out is
  shown. A paginated table gives every plotted planet.
- **In progress:** measured and archive-derived radii are not yet told apart on this chart. Fix under
  way: measured radii only by default, derived ones on request as hollow points, with the excluded count
  broken down by reason.

## How it was verified

- `npm run typecheck`, `npm test` (95 tests passing on 15 November 2026), `npm run build` before each
  push; CI runs the same plus an offline smoke test.
- Tests cover unit conversion (parsecs to light-years, period to Earth years), binning by year and method,
  axis rounding, logarithmic-plot filtering, and the committed snapshot itself (source, size, totals,
  milestones).
- Live NASA Exoplanet Archive queries were run from the development environment on 15 November 2026.
- **Not verified from the development environment:** sky images (CDS and ESA image servers were blocked
  by its network) and the external milestone web pages (only the archive's own references were
  reachable).

## For AI agents: where to look

| Need | File (in mmatrab/orbit-os) |
| --- | --- |
| Data contracts (fields, statuses) | `src/api/contracts.ts` |
| Live archive queries, measured/derived/limit rules | `server/nasaTap.ts` (`buildMeasurement`) |
| Snapshot generation | `scripts/build-planet-snapshot.ts` |
| Snapshot decoding, binning, log filter, milestones, unit conversion | `src/stories/planetSnapshot.ts` |
| Guided path | `src/components/FindAWorld.tsx` |
| Timeline | `src/components/DiscoveryTimeline.tsx` |
| Radius–period chart | `src/components/StoryCharts.tsx` |
| Sky viewer and PNG export | `src/components/SkyViewerPanel.tsx` |
| Product rules and brief | `docs/product/storytelling-enthusiast-path.md` |

Commits on `mmatrab/orbit-os` main for this work: `cf85e05` (snapshot), `c01ad8e` (guided path),
`a2f1753` (timeline). Search the log for "Part 1", "Part 2", "Snapshot" to find them.
