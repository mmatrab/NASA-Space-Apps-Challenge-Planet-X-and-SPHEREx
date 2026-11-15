/**
 * Minimal FITS reader for SPHEREx Level 2 spectral-image cutouts (multi-extension FITS).
 * Supports image HDUs (BITPIX 8/16/32/-32/-64, BSCALE/BZERO) and binary tables with
 * fixed-size array columns (TFORM nJ / nE / nD / nI / nK), which is what the WCS-WAVE
 * extension uses. Spec: FITS Standard 4.0 (big-endian, 2880-byte blocks, 80-char cards).
 */

export type HeaderValue = string | number | boolean | null;
export type Header = Map<string, HeaderValue>;

export interface ImageHDU {
  kind: 'image';
  name: string;
  header: Header;
  width: number;
  height: number;
  /** Row-major, row 0 = FITS pixel row 1 (bottom of the image when displayed north-up). */
  data: Float32Array;
}

export interface TableHDU {
  kind: 'table';
  name: string;
  header: Header;
  rows: number;
  /** Column name -> per-row arrays of numbers. */
  columns: Map<string, number[][]>;
}

export interface EmptyHDU {
  kind: 'empty';
  name: string;
  header: Header;
}

export type HDU = ImageHDU | TableHDU | EmptyHDU;

const BLOCK = 2880;
const CARD = 80;

function parseValue(raw: string): HeaderValue {
  const s = raw.trim();
  if (s.startsWith("'")) {
    // String: '' is an escaped quote; trailing spaces are not significant.
    const m = s.match(/^'((?:[^']|'')*)'/);
    return m ? m[1].replace(/''/g, "'").trimEnd() : s;
  }
  const value = s.split('/')[0].trim();
  if (value === 'T') return true;
  if (value === 'F') return false;
  if (value === '') return null;
  const n = Number(value.replace(/D/i, 'E'));
  return Number.isFinite(n) ? n : value;
}

export function parseHeader(bytes: Uint8Array, offset: number): { header: Header; dataOffset: number } {
  const header: Header = new Map();
  let pos = offset;
  const decoder = new TextDecoder('ascii');
  for (;;) {
    if (pos + BLOCK > bytes.length) throw new Error('FITS header is truncated');
    const block = decoder.decode(bytes.subarray(pos, pos + BLOCK));
    pos += BLOCK;
    for (let i = 0; i < BLOCK; i += CARD) {
      const card = block.slice(i, i + CARD);
      const key = card.slice(0, 8).trim();
      if (key === 'END') return { header, dataOffset: pos };
      if (card.slice(8, 10) === '= ' && key) header.set(key, parseValue(card.slice(10)));
    }
  }
}

export const num = (h: Header, key: string, fallback?: number): number => {
  const v = h.get(key);
  if (typeof v === 'number') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`FITS keyword ${key} is missing`);
};

export const str = (h: Header, key: string): string | null => {
  const v = h.get(key);
  return typeof v === 'string' ? v : v === undefined || v === null ? null : String(v);
};

function readImage(view: DataView, offset: number, header: Header, name: string): ImageHDU {
  const bitpix = num(header, 'BITPIX');
  const width = num(header, 'NAXIS1');
  const height = num(header, 'NAXIS2');
  const n = width * height;
  const bscale = num(header, 'BSCALE', 1);
  const bzero = num(header, 'BZERO', 0);
  const blank = header.get('BLANK');
  const data = new Float32Array(n);
  const step = Math.abs(bitpix) / 8;
  for (let i = 0; i < n; i++) {
    const p = offset + i * step;
    let v: number;
    switch (bitpix) {
      case 8: v = view.getUint8(p); break;
      case 16: v = view.getInt16(p, false); break;
      case 32: v = view.getInt32(p, false); break;
      case -32: v = view.getFloat32(p, false); break;
      case -64: v = view.getFloat64(p, false); break;
      default: throw new Error(`Unsupported BITPIX ${bitpix}`);
    }
    data[i] = bitpix > 0 && typeof blank === 'number' && v === blank ? NaN : v * bscale + bzero;
  }
  return { kind: 'image', name, header, width, height, data };
}

const TFORM_SIZES: Record<string, number> = { B: 1, I: 2, J: 4, K: 8, E: 4, D: 8 };

function readTable(view: DataView, offset: number, header: Header, name: string): TableHDU {
  const rowBytes = num(header, 'NAXIS1');
  const rows = num(header, 'NAXIS2');
  const fields = num(header, 'TFIELDS');
  const columns = new Map<string, number[][]>();
  let colOffset = 0;
  for (let c = 1; c <= fields; c++) {
    const form = str(header, `TFORM${c}`) ?? '';
    const m = form.trim().match(/^(\d*)([A-Z])/);
    if (!m) throw new Error(`Unsupported TFORM ${form}`);
    const repeat = m[1] ? Number(m[1]) : 1;
    const type = m[2];
    const size = TFORM_SIZES[type];
    const colName = (str(header, `TTYPE${c}`) ?? `COL${c}`).trim();
    if (size === undefined) {
      // Unsupported column types (e.g. strings, variable-length arrays) are skipped, not guessed.
      colOffset += type === 'A' ? repeat : type === 'P' ? 8 : type === 'Q' ? 16 : 0;
      continue;
    }
    const perRow: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const values: number[] = [];
      for (let k = 0; k < repeat; k++) {
        const p = offset + r * rowBytes + colOffset + k * size;
        switch (type) {
          case 'B': values.push(view.getUint8(p)); break;
          case 'I': values.push(view.getInt16(p, false)); break;
          case 'J': values.push(view.getInt32(p, false)); break;
          case 'K': values.push(Number(view.getBigInt64(p, false))); break;
          case 'E': values.push(view.getFloat32(p, false)); break;
          case 'D': values.push(view.getFloat64(p, false)); break;
        }
      }
      perRow.push(values);
    }
    columns.set(colName, perRow);
    colOffset += repeat * size;
  }
  return { kind: 'table', name, header, rows, columns };
}

/** Byte length of an HDU's data section (before padding), per the FITS standard. */
export function dataLength(header: Header): number {
  const naxis = num(header, 'NAXIS', 0);
  if (naxis === 0) return 0;
  let n = 1;
  for (let i = 1; i <= naxis; i++) n *= num(header, `NAXIS${i}`);
  const gcount = num(header, 'GCOUNT', 1);
  const pcount = num(header, 'PCOUNT', 0);
  return (Math.abs(num(header, 'BITPIX')) / 8) * gcount * (pcount + n);
}

export function parseFits(buffer: ArrayBuffer, options: { skip?: string[] } = {}): HDU[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const hdus: HDU[] = [];
  let offset = 0;
  while (offset + BLOCK <= bytes.length) {
    const { header, dataOffset } = parseHeader(bytes, offset);
    const name = (str(header, 'EXTNAME') ?? (hdus.length === 0 ? 'PRIMARY' : `HDU${hdus.length}`)).trim();
    const len = dataLength(header);
    const xt = (str(header, 'XTENSION') ?? '').trim();
    if (len === 0 || options.skip?.includes(name)) hdus.push({ kind: 'empty', name, header });
    else if (xt === 'BINTABLE') hdus.push(readTable(view, dataOffset, header, name));
    else hdus.push(readImage(view, dataOffset, header, name));
    offset = dataOffset + Math.ceil(len / BLOCK) * BLOCK;
  }
  return hdus;
}

/** Byte ranges of each HDU (header start to padded data end), used by the server to drop large HDUs. */
export function hduRanges(buffer: ArrayBuffer): { name: string; start: number; end: number }[] {
  const bytes = new Uint8Array(buffer);
  const out: { name: string; start: number; end: number }[] = [];
  let offset = 0;
  while (offset + BLOCK <= bytes.length) {
    const { header, dataOffset } = parseHeader(bytes, offset);
    const name = (str(header, 'EXTNAME') ?? (out.length === 0 ? 'PRIMARY' : `HDU${out.length}`)).trim();
    const end = dataOffset + Math.ceil(dataLength(header) / BLOCK) * BLOCK;
    out.push({ name, start: offset, end });
    offset = end;
  }
  return out;
}
