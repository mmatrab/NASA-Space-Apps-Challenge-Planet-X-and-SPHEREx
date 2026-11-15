# SPHEREx Sky Motion

Our entry to the NASA Space Apps Challenge 2026,
[Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=details).

**Enter the coordinates of a patch of sky and watch NASA SPHEREx images of it play one after another,
like a short video, so anyone can spot what moves or changes.**

SPHEREx maps the whole sky every six months in 102 near-infrared colours. Nearby stars, brown dwarfs,
asteroids and comets shift between visits; variable stars change brightness. This tool puts those
visits side by side.

## Run it

Requires Node.js 22.18 or newer.

```bash
npm ci
npm run dev
```

Open http://localhost:5173. For a production build served by one Node process:

```bash
npm run build
npm start
```

That serves the app and its API on http://localhost:8080 (set `PORT` to change it).

## What you can do

| Feature | How |
| --- | --- |
| Choose a patch of sky | RA/Dec in sexagesimal (`08h55m10.831s`, `-7d14m42.53s`) or degrees, or an object name (CDS Sesame) |
| Challenge test targets | One click: Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis |
| Field of view | 1, 2, 3, 5 or 8 arcminutes |
| Choose wavelengths | Detectors D1–D6 (0.75–5.00 µm), each covering part of the 102 bands |
| Play the sky over time | One stacked frame per six-month survey (best for motion), or every exposure in time order; speed, step, slider, keyboard |
| Make motion stand out | Show the images, the difference from the median sky, or the difference from the first frame |
| Add frames for signal-to-noise | Survey frames average all exposures of that visit |
| Spectrum on the fly | Click a pixel: one point per exposure, at its own wavelength, coloured by survey epoch |
| Compare with Gaia | Gaia DR3 stars drawn where their proper motion puts them on each frame's date; fast movers in gold |
| Data quality | Zodiacal light model subtracted (optional); flagged pixels hidden or tinted red; quality flags listed per pixel |
| Provenance | Each frame lists date, detector, wavelength, observation ID, exposure, quality flag, pipeline version and a link to the full file |
| Share and embed | The URL holds `ra`, `dec`, `fov` and `det`, e.g. `/?ra=133.795129&dec=-7.245147&fov=3` |
| Save | Any frame as a PNG with a caption (target, date, detector, processing, credit) |

## Where the data comes from

| Data | Service |
| --- | --- |
| SPHEREx image list per position | IRSA TAP (`spherex.artifact` ⨝ `spherex.plane`, query from IRSA's tutorial), with IRSA SIA2 (`spherex_dr1`, `spherex_qr3`) as fallback |
| SPHEREx images | IRSA cutout service on the Level 2 spectral images (DR1 and Quick Releases) |
| Wavelength of each pixel | The image's own `WCS-WAVE` lookup table |
| Pixel flags | SPHEREx Explanatory Supplement v2.1, Table 16 |
| Star positions and motions | Gaia DR3 (ESA Gaia archive) |
| Names to positions | CDS Sesame |

New SPHEREx releases appear automatically: the image list is queried live, and when the same exposure
exists in several releases, the newest pipeline version is used.

**Rules we follow:** archive data only, shown as it is. Missing data is drawn in dark blue, never as
empty sky. When a service is down the app says so and shows nothing in its place. The tool helps people
look; it makes no discovery claims.

## How it works

```
browser (React)                          server (Node, server/api.ts)              archives
---------------------------------------  ----------------------------------------  -------------------
coordinates / name  ─────────────────▶   /api/resolve ─────────────────────────▶  CDS Sesame
                    ─────────────────▶   /api/images  ─────────────────────────▶  IRSA TAP (SIA2 fallback)
for each image      ─────────────────▶   /api/cutout  (PSF table stripped) ────▶  IRSA cutout service
                    ─────────────────▶   /api/gaia    ─────────────────────────▶  ESA Gaia DR3 TAP
FITS parsed in the browser (src/lib/fits.ts)
→ TAN-SIP WCS + wavelength lookup (src/lib/wcs.ts)
→ resampled onto one north-up grid, grouped into epochs, stacked or differenced (src/lib/frames.ts)
→ painted on a canvas with one shared stretch (src/lib/render.ts)
```

The server exists because IRSA's cutout service sends no CORS header, so browsers cannot fetch it
directly. It also drops each cutout's PSF table, about 4 MB, which the viewer does not use.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

The tests run on a real SPHEREx cutout (`tests/fixtures/`, the example image from the SPHEREx archive
guide). They check the WCS round trip (under 0.01″), the 6.2″ pixel size, the per-pixel wavelength,
flag decoding, the grid, epochs and stacking, the archive response parsers, and path validation. CI
runs the same checks on every push.

## Status

See [FEATURES.md](FEATURES.md) for what is built and verified, and [docs/decisions.md](docs/decisions.md)
for open questions. The challenge brief is in [docs/challenge-brief.md](docs/challenge-brief.md).

## Credits

SPHEREx data: NASA / JPL-Caltech / IPAC, served by the NASA/IPAC Infrared Science Archive (IRSA).
Gaia DR3: ESA/Gaia/DPAC. Name resolution: CDS, Strasbourg.
