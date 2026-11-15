# Challenge brief: Planet X and SPHEREx

Copied from the challenge page on 15 November 2026:
https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=details

- Event: 2026 NASA Space Apps Challenge
- Difficulty: Advanced
- Subjects: Astrophysics · Planets & Moons · Software

## Summary

Since 2025, NASA's SPHEREx mission has been mapping the entire sky every six months in 102 bands of
near-infrared light, returning images of more than a billion objects. Comets, asteroids, stars, brown
dwarfs, and even new planets reveal themselves by shifting position between images, but no one person
can sift through all that data alone. The challenge is to create a public-facing web tool to display
images of the sky from the SPHEREx mission, making it easy for anyone to quickly see how they change
over time.

## Background (key points)

- Objects near us change apparent position: asteroids and comets orbit the Sun, nearby stars move
  across the sky as they orbit the Galaxy, and Earth's own orbit shifts nearby objects (parallax).
- Comparing images taken at different times is how Pluto was found, and how volunteers found most known
  comets and brown dwarfs (for example through backyardworlds.org).
- SPHEREx has returned data since May 2025. It maps the whole sky once every six months in 102
  near-infrared bands. It is especially sensitive to objects rich in hydrogen, water, carbon dioxide,
  carbon monoxide and other molecules.
- Its images cover more than a billion objects (brown dwarfs, quasars, comets, asteroids, stars,
  supernovae, galaxies) that often overlap or vary in brightness.

## Objective

Create a public-facing web tool to display images of the sky from the SPHEREx mission, making it easy
for anyone to quickly see how they change over time.

- The user enters the coordinates of a patch of sky (right ascension and declination).
- The tool displays a series of images of that patch like a little video, making it easy to spot
  moving objects.

## Test targets (required by the challenge)

| Target | What it is (per the challenge text) | Coordinates given by the challenge |
| --- | --- | --- |
| Barnard's Star | — | not given: resolve from SIMBAD or Gaia DR3 at build time |
| Epsilon Indi B | a pair of brown dwarfs orbiting a star | not given: resolve from SIMBAD or Gaia DR3 at build time |
| WISE 0855 | a fast-moving brown dwarf | RA 08h55m10.831s, Dec −7°14′42.53″ |
| RW Aurigae | variable star | not given: resolve from SIMBAD or Gaia DR3 at build time |
| R Draconis | variable star | not given: resolve from SIMBAD or Gaia DR3 at build time |

Fast movers (high proper motion) drift between epochs, so a fixed coordinate must state its epoch.
To be checked when the target list is resolved.

## Potential considerations (optional, from the brief)

1. New SPHEREx data arrives fast: make the tool easy to update with the latest data releases.
2. Display the 102 infrared bands creatively. For example, add together all data taken by each of the
   six detector arrays to improve signal-to-noise. Extra kudos for generating spectra on the fly.
3. Let users add together or subtract images taken at different times.
4. Let users choose the field of view. Larger fields help track faster sources but cost more transfer
   time.
5. Overlay data from other telescopes, such as Gaia or WISE.
6. Accept coordinates in the URL, so the tool can be embedded in other sites.
7. Display metadata, such as contamination flags.
8. Use public tools for astronomical data (Astropy) and for display (Aladin, from CDS Strasbourg).

## Resources (from the Resources tab)

NASA:

- NASA/IPAC Infrared Science Archive (IRSA), SPHEREx resources:
  https://irsa.ipac.caltech.edu/Missions/spherex.html
- SPHEREx tutorial notebooks (Python access to SPHEREx data):
  https://caltech-ipac.github.io/irsa-tutorials/spherex/
- WiseView, a similar tool for the earlier WISE mission, used by the public for hundreds of
  discoveries: http://byw.tools/wiseview
- Gaia mission data (use Data Release 3): https://archive.stsci.edu/missions-and-data/gaia

Canadian Space Agency:

- NEOSSat: https://www.asc-csa.gc.ca/eng/satellites/neossat/
- Canadian Astronomy Data Centre (CADC): https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/
- NEOSSat data tutorial: https://github.com/asc-csa/NEOSSAT_Tutorial
- NEOSSat dataset: https://data.asc-csa.gc.ca/dataset/neossat

NASA does not endorse any non-U.S. Government entity. For non-U.S. Government websites, participants
must comply with that website's data use terms.
