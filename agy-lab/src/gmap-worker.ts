// The Gmap Local Worker: a download that turns a Windows PC into a gmap.scan
// worker. The package (../local-worker) is one PowerShell script that claims a
// Maps job from this hub, reads the businesses from Google Maps' own result-list
// pages on the PC's internet line (no browser), and posts them back like any
// other worker. How and why: the header of local-worker/worker.ps1.
//
// THE KEY. A worker PC must not hold LAB_TOKEN: that is a shell on this
// container. It holds GMAP_WORKER_KEY, an HMAC of LAB_TOKEN, which server.ts
// lets through to the claim, heartbeat and result routes (for JOB_TYPES only,
// see jobs.ts `scope`) and to the strategy route below. Rotating LAB_TOKEN
// rotates it; the PCs then need a fresh package.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { AREA_MATCH_FLOOR, DEFAULT_MAX, FAMILIES, STREET_FORMS } from './maps-worker.ts';

/**
 * The only job types a worker key may claim or answer. `fetch.pages` is the
 * Local Fetch Worker (../local-fetch-worker) on the same PCs: page reads for a
 * company dive, read on the PC's home line instead of bought from Tavily.
 */
export const JOB_TYPES = ['gmap.scan', 'fetch.pages'];
export const PACKAGE_NAME = 'GmapWorker.zip';
const DIR = path.resolve(import.meta.dirname, '../local-worker');
const KEY_LABEL = 'gmap-local-worker-v1';

/** Files of the package, as [path in the folder, path in the zip]. */
const FILES: Array<[string, string]> = [
  ['Start Gmap Worker.cmd', 'Start Gmap Worker.cmd'],
  ['Enable autostart.cmd', 'Enable autostart.cmd'],
  ['Disable autostart.cmd', 'Disable autostart.cmd'],
  ['README.txt', 'README.txt'],
  ['worker.ps1', 'app/worker.ps1'],
];

type Ctx = { json: (res: http.ServerResponse, status: number, body: unknown) => void };

export function workerKey(token = process.env.LAB_TOKEN ?? ''): string {
  return crypto.createHmac('sha256', token).update(KEY_LABEL).digest('hex');
}

/** Hash both sides first, so timingSafeEqual never sees mismatched lengths. */
export function isWorkerKey(supplied: string, token = process.env.LAB_TOKEN ?? ''): boolean {
  if (token.length < 16 || !supplied) return false;
  const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(supplied), digest(workerKey(token)));
}

/** The broker routes a worker key reaches. */
export function isJobRoute(method: string, p: string): boolean {
  return (method === 'GET' && p === '/api/jobs/next')
    || (method === 'POST' && p === '/api/jobs/heartbeat')
    || (method === 'POST' && /^\/api\/jobs\/[a-f0-9]{12}\/result$/.test(p));
}

/** What the bridge sweeps, read on every job so the words stay the hub's. */
export function strategy(): Record<string, unknown> {
  return { families: FAMILIES, streetForms: STREET_FORMS, areaMatchFloor: AREA_MATCH_FLOOR, defaultMax: DEFAULT_MAX };
}

const DOS_EPOCH = { time: 0, date: (2026 - 1980) << 9 | 1 << 5 | 1 };

/** A plain deflate zip. UTF-8 names, no extras, no comment. */
export function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_EPOCH.time, 10);
    local.writeUInt16LE(DOS_EPOCH.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_EPOCH.time, 12);
    central.writeUInt16LE(DOS_EPOCH.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Windows line endings, and a BOM on the script: PowerShell 5.1 reads a BOM-less file as ANSI. */
function forWindows(name: string, data: Buffer): Buffer {
  const text = data.toString('utf8').replace(/\r?\n/g, '\r\n');
  return Buffer.from((name.endsWith('.ps1') ? '﻿' : '') + text, 'utf8');
}

export function packageZip(labUrl: string, token = process.env.LAB_TOKEN ?? '', dir = DIR): Buffer {
  const env = [
    '# Gmap Local Worker settings. Keep this file private: the key lets a PC take Maps jobs from the hub.',
    'LAB_URL=' + labUrl.replace(/\/+$/, ''),
    'GMAP_WORKER_KEY=' + workerKey(token),
    '# WORKER_NAME=pc-office-1',
    '# GMAP_CONCURRENCY=2',
    '',
  ].join('\n');
  const entries = FILES.map(([from, to]) => ({ name: 'GmapWorker/' + to, data: forWindows(to, fs.readFileSync(path.join(dir, from))) }));
  entries.push({ name: 'GmapWorker/worker.env', data: forWindows('worker.env', Buffer.from(env, 'utf8')) });
  return zip(entries);
}

/** The hub's own address as the caller reached it, for the package's LAB_URL. */
export function publicUrl(req: http.IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] ?? (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0]!;
  return `${proto}://${host}`;
}

/**
 * /api/gmap-worker/*. `who` is what the caller authenticated as: the package
 * needs LAB_TOKEN (it embeds the worker key), the rest takes either.
 */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx, who: 'operator' | 'worker'): Promise<boolean> {
  const p = url.pathname;
  if ((req.method ?? 'GET') !== 'GET') return false;
  if (p === '/api/gmap-worker/package') {
    if (who !== 'operator') { ctx.json(res, 403, { error: 'the package is downloaded with LAB_TOKEN, from the Workers page' }); return true; }
    const body = packageZip(publicUrl(req));
    res.writeHead(200, {
      'content-type': 'application/zip', 'content-length': body.length, 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${PACKAGE_NAME}"`,
    });
    res.end(body);
    return true;
  }
  if (p === '/api/gmap-worker/strategy') { ctx.json(res, 200, strategy()); return true; }
  return false;
}
