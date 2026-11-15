# Decisions and open questions

Newest first. Each entry says what was decided, why, and what is still open.

## 2026-11-15 · First working version: SPHEREx Sky Motion

- **Stack.** React and TypeScript in the browser, one small Node server (no framework), Vite to build.
  FITS, TAN-SIP and `-TAB` wavelength WCS are written in TypeScript; there is no Python dependency.
- **Server needed.** IRSA's cutout service sends no CORS header. The server also strips the ~4 MB PSF
  table from each cutout and reports archive outages.
- **Image list.** IRSA TAP query from IRSA's cutouts tutorial (covers DR1 and QR3, available right after
  ingestion), with SIA2 (`spherex_dr1`, `spherex_qr3`) as fallback. When the same exposure exists in
  several releases, the newest pipeline version is kept.
- **Display.** Nearest-pixel resampling onto a north-up grid (real values only). One stretch shared by
  all frames so blinking does not flicker. Epochs are split on gaps longer than 30 days.
- **Flags.** Masked bits follow the Explanatory Supplement's own mosaic tool (Sect. 3.4.3).

### Open questions

1. IRSA TAP and SIA2 answered 502 all day on 15 November 2026, so multi-epoch playback of the test
   targets is not yet verified. Retest the five targets when IRSA is back.
2. Gaia (gea.esac.esa.int) and CDS were unreachable from the build machine; check the overlay and the
   name lookup from a normal network.
3. Survey frames average different wavelengths. A single-detector view is available; a
   wavelength-matched comparison between epochs would be better for variable stars.
4. Possible next steps: an Aladin Lite context view using the SPHEREx DR1 HiPS cube (reachable, with
   CORS), a WISE overlay, and an animated GIF export.

## 2026-11-15 · Repository created as the source of truth

- Decided: this repository holds the challenge brief, decisions and code for our Planet X and SPHEREx
  entry.
- This is a standalone project, separate from any other repository.

### Open questions

1. ~~SPHEREx data access from the browser~~: answered on 2026-11-15 (see above): cutouts need a server.
2. Which data release(s) and how many epochs exist per position today (the sky is mapped every six
   months since May 2025)?
3. Test-target coordinates and epochs: resolve all five from SIMBAD or Gaia DR3, with proper motion,
   and record the source.
4. Network access for the build environment: IRSA, CDS (SIMBAD, Aladin HiPS) and Gaia hosts must be
   reachable for development and tests.
