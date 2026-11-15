# Live pitch: SPHEREx Sky Motion (5 minutes)

Team AstroSeekers · presenter Mohamed Matrab. About 600 words at a calm pace, plus demo time.
Followed by the 2-minute Space Explorer pitch (it starts with “Now, let me introduce another module…”).

**Before you start:** run the site (`npm run dev`), open Barnard's Star, RW Aurigae and R Draconis
once so their images are cached, then go back to the home page. Keep the 30-second video ready as a
backup.

---

**[0:00–0:40 — THE PROBLEM]**

Hi, I'm Mohamed Matrab, from team AstroSeekers. We chose the **“Planet X and SPHEREx”** challenge.

Almost a hundred years ago, Pluto was found by comparing two photos of the sky taken at different
times, and noticing one dot that had moved.

Today, NASA's **SPHEREx** telescope does this at a much bigger scale. Since 2025, it has photographed
the whole sky every six months, in 102 colours of infrared light, more than a billion objects.

Nearby stars, brown dwarfs, asteroids and comets all move between those photos. Volunteers have
already found many brown dwarfs this way. But SPHEREx data comes as huge technical files, and **no
one can look through it alone.**

**[0:40–1:10 — OUR SOLUTION]**

So we built **SPHEREx Sky Motion**: a website where anyone can watch the infrared sky change.

You choose a spot in the sky. The site finds every SPHEREx image of that spot, lines them up, and
plays them like a short video.

And just like our other projects: **we never invent data. Every pixel comes from NASA's archive, with
its source.**

**[1:10–3:40 — LIVE DEMONSTRATION]**

Let me show you.

**[Home page]**

The page follows three steps: choose a target, play the visits, inspect a pixel. If you don't know
where to look, we suggest five targets, the ones named in the challenge, with what to look for.

**[Click Barnard's Star]**

Let's take Barnard's Star, the star that crosses our sky the fastest.

The site has found 325 SPHEREx images of it. Here they are, one frame per visit, about six months
apart, from August 2025 to August 2026. North is up, and every frame shows its date.

**[Compare tab → Side by side]**

In the Compare tab, we put August 2025 next to August 2026.

**[Blink]**

If we blink between them, you can already see the star jump.

**[Difference]**

And if we subtract them: **white means brighter now, black means fainter now.** This white-and-black
pair is the star moving north, about ten arc-seconds in one year. That is exactly the speed astronomers
have measured for this star.

**[Point to the circles]**

These circles are stars from ESA's Gaia catalogue, drawn where Gaia predicts them on each date. The
gold one is Barnard's Star, and it follows the moving star.

**[Explore → click next to the star → scroll to the spectrum]**

SPHEREx has another trick: each image sees a spot at a different colour. So when you click a star,
we collect all those measurements and build its **spectrum, on the fly.** Each colour of dot is a
different visit. If the visits disagree, the star has changed.

**[Click R Draconis]**

R Draconis is a star that pulses. It sits near the pole of the sky, where SPHEREx looks almost every
month, so here we get thirteen visits instead of three. You can follow it month by month.

**[Save GIF → About the data]**

Finally, you can save an image or an animated GIF, and share a link that reopens the same view. And
this page explains where every number comes from.

**[3:40–4:20 — HOW WE MADE IT RELIABLE]**

A short behind-the-scenes story. During the whole hackathon, **NASA's SPHEREx search service was
down.** We could not ask which images contain a star.

So we went to the source: NASA's public SPHEREx archive on Amazon's cloud. We read the headers of the
files and checked, with each image's own coordinates, whether our five targets were inside. We found
more than **3,300 real images.**

When the search service is back, the site uses it automatically. When something is down, the page
says so. **We never fill the gap with fake data.**

**[4:20–5:00 — IMPACT AND CONCLUSION]**

With SPHEREx Sky Motion, a student, a teacher or an amateur astronomer can open a link and watch a
star move, in real NASA data, in a few seconds.

Every new SPHEREx release adds new frames. Next, we want to let volunteers flag moving objects, add
WISE images for a longer timeline, and embed the viewer in other websites.

Our goal is simple: **make SPHEREx's moving sky something everyone can see, understand, and trust.**

And SPHEREx is not the only thing we built…

*(continue with the 2-minute Space Explorer pitch)*

---

## Words that are easy to stumble on

- SPHEREx: “sfear-ex” · Barnard: “BAR-nard” · R Draconis: “R dra-KOH-nis” · Gaia: “GUY-ah”
- arc-second: a tiny angle, 1/3600 of a degree

## If something goes wrong during the demo

- **Images load slowly:** say “it's downloading real NASA files”, and keep talking about the next step.
- **The site does not open:** play the 30-second video, then talk over the screenshots.
- **A juror asks if the motion is real:** Barnard's Star moves 10.4 arc-seconds per year (SIMBAD/Gaia);
  between August 2025 and August 2026 we expect about 10 arc-seconds, which is what the difference
  image shows.
