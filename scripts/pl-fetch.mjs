// Download PixelLab results in bulk (no auth: the URLs carry their own ids).
//
// Usage:
//   node scripts/pl-fetch.mjs frames <frame_0 url> <count> <outdir>
//       review candidates of a create_1_direction_object batch: get_object lists
//       .../rotations/frame_0.png … frame_<n-1>.png; saves <outdir>/0.png … <n-1>.png
//   node scripts/pl-fetch.mjs tileset <tileset id> <outdir>
//       a create_topdown_tileset result: <outdir>/tileset.png + tileset.json (per-tile corners)
//   node scripts/pl-fetch.mjs url <url> <file>
//       any single file
import fs from 'node:fs';
import path from 'node:path';

const [cmd, a, b, c] = process.argv.slice(2);

async function get(url, file, tries = 4) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status === 423 || res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 3000 * (t + 1))); continue; }
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error(`${url}: still not ready after ${tries} tries`);
}

if (cmd === 'frames') {
  const n = +b;
  if (!/frame_0\.png/.test(a) || !n) { console.error('frames needs the frame_0.png URL and a count'); process.exit(2); }
  const jobs = [];
  for (let i = 0; i < n; i++) jobs.push(get(a.replace(/frame_0\.png/, `frame_${i}.png`), path.join(c, `${i}.png`)));
  await Promise.all(jobs);
  console.log(`saved ${n} frames to ${c}`);
} else if (cmd === 'tileset') {
  const api = 'https://api.pixellab.ai/mcp/tilesets/' + a;
  await get(api + '/image?inline=true', path.join(b, 'tileset.png'));
  await get(api + '/metadata', path.join(b, 'tileset.json'));
  console.log(`saved ${b}/tileset.png + tileset.json`);
} else if (cmd === 'url') {
  await get(a, b);
  console.log(`saved ${b}`);
} else {
  console.error('usage: node scripts/pl-fetch.mjs frames <frame_0 url> <count> <outdir> | tileset <id> <outdir> | url <url> <file>');
  process.exit(2);
}
