# Features: SPHEREx Sky Motion

For the team, the NASA Space Apps judges, and AI agents that need context on this project.
Last updated: 15 November 2026.

## The challenge, and our answer

**Asked:** a public web tool where users enter RA/Dec and see SPHEREx images of that patch played like
a little video, to spot moving objects. Test targets: Barnard's Star, Epsilon Indi B, WISE 0855,
RW Aurigae, R Draconis.

**Built:** a web app plus a small Node server. It lists every SPHEREx image covering a position,
downloads cutouts, puts them on one north-up sky grid, and plays them over time. It can also stack them,
subtract them, overlay Gaia, and build a spectrum when you click a pixel.

## Features and the challenge items they answer

| Challenge item | What we built | Status |
| --- | --- | --- |
| Enter RA/Dec, see a series of images like a video | One field for a name or RA Dec; three-step home page (choose, play, inspect); player with speed, step, slider, keyboard | Built and tested |
| Help people who do not know where to look | Five suggested targets with what each one is and what to look for | Built |
| Test targets | One-click buttons for the five targets; WISE 0855 uses the coordinates given in the brief | Built; image list waits on IRSA (see below) |
| Easy to update with new data releases | Image list queried live (TAP, SIA2 fallback); newest pipeline version kept when releases overlap; SIA2 collections listed in one place (`server/api.ts`) | Built |
| Display the 102 bands creatively | Per-pixel wavelength from each image's `WCS-WAVE` table; detector filter D1–D6 | Built and tested |
| Add frames from each detector array for signal-to-noise | "One frame per survey" mode averages all exposures of a visit | Built and tested |
| Generate spectra on the fly | Click a pixel: one point per exposure at its own wavelength, with error bars, coloured by survey epoch, plus a table | Built and tested |
| Add or subtract images taken at different times | Difference from the median sky or the first frame; **Compare** tab with two visits side by side, blinking, or subtracted | Built and tested |
| Choose the field of view | 1 to 8 arcminutes | Built |
| Overlay Gaia or WISE | Gaia DR3 stars propagated to each frame's date with their proper motion; fast movers highlighted | Built; Gaia unreachable from our build machine |
| Coordinates in the URL, embeddable | `?ra=&dec=&fov=&det=` restores the view | Built and tested |
| Display metadata such as contamination flags | Flags decoded per pixel (Explanatory Supplement Table 16); flagged pixels hidden or tinted; per-frame quality flag, observation ID, pipeline version, file link | Built and tested |
| Use public tools | Standard FITS, TAN-SIP and -TAB WCS implemented in TypeScript; data from IRSA, Gaia and CDS services | Built |

Extras:

- Zodiacal light removal using the archive's own model (`ZODI` extension).
- Save any frame as a captioned PNG, or the played sequence as a looping animated GIF (Explore), or a two-visit blink GIF (Compare). Encoder: `gifenc` (MIT, ~5 KB).
- Clear messages when an archive is down: IRSA's search answering 502 is explained as a server error on the archive's side; a CDS name-service failure asks for RA/Dec instead.
- Missing data is drawn in dark blue, never as empty sky.

## Data honesty

- Every pixel shown is an archive value or a stated operation on archive values (zodiacal subtraction,
  average, difference). Resampling uses the nearest real pixel; nothing is smoothed or invented.
- Wavelengths come from each image's own lookup table. Flags follow the SPHEREx Explanatory Supplement
  v2.1 (Table 16, and the mask list in Sect. 3.4.3).
- When an archive service fails, the app shows the archive's answer and nothing in its place.
- The tool makes no discovery claims.

## Verified on 15 November 2026

- **Real SPHEREx data:** a QR3 detector-1 cutout from IRSA, the example in the archive guide.
  - Read correctly: the five image/table HDUs, date `2026-05-21T12:09:39 UTC`, observation
    `2026W21_2A_0001_2`.
  - WCS round trip under 0.01″.
  - Wavelength at the centre: 0.8688 µm, inside detector 1's documented 0.75–1.09 µm range.
- **23 automated tests** (typecheck and build pass too); CI on every push.
- **In a real browser (Chromium):**
  - the archive outage message appears;
  - the real image loads through the server, north-up with a scale bar;
  - clicking a pixel gives its spectrum point at 0.87 µm;
  - the URL updates to a shareable link.
- **Production server:** serves the app; returns the real cutout at 109 KB instead of about 4 MB;
  refuses paths outside SPHEREx data.

## Not verified yet (and why)

- **Multi-epoch playback on the test targets.** On 15 November 2026, IRSA's search services (TAP and
  SIA2) answered 502 for every request, including non-SPHEREx ones, while image downloads worked.
  Without the image list, the five targets cannot be loaded yet. The code follows IRSA's documented
  query; to be checked as soon as IRSA is back.
- **Gaia overlay and name lookup.** The ESA Gaia archive and CDS were unreachable from our build
  machine. Parsers are tested on the documented formats.

## Where the code is (for AI agents)

| Need | File |
| --- | --- |
| FITS reader | `src/lib/fits.ts` |
| Sky WCS (TAN-SIP) and wavelength lookup (WCS-WAVE) | `src/lib/wcs.ts` |
| Flag bits and bad-pixel mask | `src/lib/flags.ts` |
| Frames, common grid, epochs, stack, median, difference, spectrum sampling | `src/lib/frames.ts` |
| Coordinates, proper motion | `src/lib/coords.ts` |
| Display stretch | `src/lib/render.ts` |
| Test targets | `src/lib/targets.ts` |
| UI | `src/App.tsx` (tabs), `src/pages/Explore.tsx`, `src/pages/Compare.tsx`, `src/pages/About.tsx`, `src/components/SkyCanvas.tsx`, `src/components/Spectrum.tsx` |
| Loading and survey visits | `src/useSky.ts` |
| API server (IRSA, Gaia, CDS) | `server/api.ts`, `server/index.ts` |
| Tests and real-data fixture | `tests/`, `tests/fixtures/spherex-qr3-d1-cutout.fits` |
| Challenge text | `docs/challenge-brief.md` |
| Decisions and open questions | `docs/decisions.md` |
