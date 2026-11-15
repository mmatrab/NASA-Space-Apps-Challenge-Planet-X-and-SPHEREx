# Pitch script: SPHEREx Sky Motion (about 2 min 30 s)

Read this over the demo video `docs/pitch/spherex-sky-motion-demo.mp4`. Each section matches a part of
the video; the times are where that part starts. About 130 words per minute; pauses are marked “…”.

---

**[0:00] Title**

Hi! This is SPHEREx Sky Motion, our answer to the “Planet X and SPHEREx” challenge.

**[0:08] The idea**

Since 2025, NASA's SPHEREx telescope has photographed the whole sky every six months, in 102 colours of
infrared light. Compare those photos over time, and some things move: nearby stars, brown dwarfs,
asteroids. Others change brightness. But this data is huge, and hard to use. So we built a website
where anyone can watch the sky change. … No astronomy needed: start from one of five suggested targets.

**[0:38] Watch the sky move**

Let's pick Barnard's Star, the star that crosses our sky the fastest. The site collects every SPHEREx
image of that spot and plays one picture per six-month visit, like a short video. … Every pixel is real
NASA data, placed north-up, with its date.

**[1:00] Compare two visits**

In the Compare tab, we put August 2025 next to August 2026. … We can blink between them … or subtract
them. White means brighter now, black means fainter now. This pair is the star moving north: about ten
arc-seconds in one year, as its known motion predicts.

**[1:24] Read the light**

SPHEREx sees each spot at a different wavelength in every image. So when you click a star, we collect
all those measurements into a spectrum, on the fly. … Here is RW Aurigae, a young star whose brightness
changes. Each colour is a different visit: when the visits disagree, the star has changed.

**[1:54] Share and trust**

You can save a frame or an animated GIF, and share a link to the same view. … The “About the data” page
says where every number comes from: NASA's SPHEREx archive, Gaia, and the official quality flags. We
never fill in missing data.

**[2:18] Closing**

SPHEREx Sky Motion: watch the infrared sky move. Thank you!

---

## Words that are easy to stumble on

- SPHEREx: “sfear-ex”
- IRSA: “ir-sa”
- RW Aurigae: “R-W or-EYE-ghee”
- arc-second: a tiny angle, 1/3600 of a degree

## If the jury asks

- **Why not show every image?** By default we load 90 images spread over time, so the page opens
  quickly. “Load all” shows every image.
- **Why your own index?** IRSA's image search was down while we built this (error 502 on their side).
  So we scanned NASA's public SPHEREx archive on AWS and kept only images that really contain each
  target. When IRSA is back, the site uses it directly.
- **Is the motion real?** Yes: it matches the star's proper motion from SIMBAD. Gaia stars can be
  drawn where they should be on each date.
