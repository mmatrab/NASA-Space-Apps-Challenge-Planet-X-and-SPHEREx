/** Browser-side calls to our API (server/api.ts). */
export interface ImageRecord {
  path: string;
  obsId: string | null;
  detector: number | null;
  mjd: number | null;
  bandpass: string | null;
  release: string | null;
  version: number | null;
}

export interface GaiaStar {
  id: string;
  ra: number;
  dec: number;
  pmra: number | null;
  pmdec: number | null;
  parallax: number | null;
  g: number | null;
  refEpoch: number;
}

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(body.details) ? ` (${body.details.join('; ')})` : '';
    throw new Error(`${body.error ?? `HTTP ${res.status}`}${details}`);
  }
  return body as T;
}

export const listImages = (ra: number, dec: number, signal?: AbortSignal) =>
  json<{ via: string; count: number; images: ImageRecord[]; retrievedAtUtc: string }>(`api/images?ra=${ra}&dec=${dec}`, signal);

export const resolveName = (name: string, signal?: AbortSignal) =>
  json<{ name: string; ra: number; dec: number; pmra: number | null; pmdec: number | null; source: string }>(
    `api/resolve?name=${encodeURIComponent(name)}`,
    signal
  );

export const gaiaStars = (ra: number, dec: number, radius: number, signal?: AbortSignal) =>
  json<{ count: number; stars: GaiaStar[]; source: string }>(`api/gaia?ra=${ra}&dec=${dec}&radius=${radius}`, signal);

export async function fetchCutout(path: string, ra: number, dec: number, sizeDeg: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(`api/cutout?path=${encodeURIComponent(path)}&ra=${ra}&dec=${dec}&size=${sizeDeg}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

export const irsaFileUrl = (path: string) => `https://irsa.ipac.caltech.edu/${path}`;
