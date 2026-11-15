export function About() {
  return (
    <div className="wrap py-8 max-w-[860px]">
      <h1 className="text-[34px] tracking-tight m-0">About the data</h1>
      <p className="text-[18px] mt-3">
        SPHEREx images the whole sky every six months in 102 near-infrared colours (0.75–5.0 µm). Comparing visits shows what moves
        and what changes.
      </p>
      <table className="t mt-6">
        <thead><tr><th>What</th><th>Where it comes from</th></tr></thead>
        <tbody>
          <tr><td>Which images cover a spot</td><td>NASA/IPAC Infrared Science Archive (IRSA): TAP, with SIA2 as fallback</td></tr>
          <tr><td>The images</td><td>IRSA cutout service, SPHEREx Level 2 spectral images (DR1 and Quick Releases)</td></tr>
          <tr><td>Wavelength of each pixel</td><td>The image's own WCS-WAVE table</td></tr>
          <tr><td>Bad pixels</td><td>SPHEREx Explanatory Supplement v2.1, Table 16</td></tr>
          <tr><td>Zodiacal glow</td><td>The archive's model (ZODI layer), subtracted on request</td></tr>
          <tr><td>Star positions and motions</td><td>Gaia DR3, ESA</td></tr>
          <tr><td>Names to positions</td><td>CDS Sesame, Strasbourg</td></tr>
        </tbody>
      </table>
      <h2 className="text-[22px] mt-8 mb-2">How we show it</h2>
      <ul className="pl-5 m-0 leading-7">
        <li>Real pixel values only. Images are placed north-up using each file's own sky coordinates.</li>
        <li>A visit is the average of all images taken within 30 days.</li>
        <li>Dark blue pixels mean no data.</li>
        <li>If an archive does not answer, the page says so and shows nothing in its place.</li>
        <li>This tool helps people look. It does not claim discoveries.</li>
      </ul>
      <p className="mut mt-8 text-[13px]">
        SPHEREx: NASA / JPL-Caltech / IPAC, data served by IRSA. Gaia DR3: ESA/Gaia/DPAC. CDS, Strasbourg. Built for NASA Space
        Apps 2026, “Planet X and SPHEREx”.
      </p>
    </div>
  );
}
