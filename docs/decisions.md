# Decisions and open questions

Newest first. Each entry says what was decided, why, and what is still open.

## 2026-11-15 · Repository created as the source of truth

- Decided: this repository holds the challenge brief, decisions and code for our Planet X and SPHEREx
  entry.
- Relationship with ORBIT OS: Space Explorer (https://github.com/mmatrab/orbit-os) already has a
  working Aladin Lite sky viewer, survey fallbacks and provenance rules that this entry can reuse.
  Whether this entry becomes an ORBIT OS module or stays standalone is open.

### Open questions

1. SPHEREx data access from the browser: which IRSA services (image search by position, cutouts) can
   be called directly, and which need a small server? To check against the IRSA SPHEREx pages and
   tutorial notebooks.
2. Which data release(s) and how many epochs exist per position today (the sky is mapped every six
   months since May 2025)?
3. Test-target coordinates and epochs: resolve all five from SIMBAD or Gaia DR3, with proper motion,
   and record the source.
4. Network access for the build environment: IRSA, CDS (SIMBAD, Aladin HiPS) and Gaia hosts must be
   reachable for development and tests.
