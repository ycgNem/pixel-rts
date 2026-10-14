// Run a TypeScript dev script through Vite (no extra dependencies): the script's `main(args)` is
// called with the remaining command-line arguments.
//   node scripts/run.mjs scripts/mapshot.ts --seed 42 --type pangaea
import path from 'node:path';
import { createServer } from 'vite';

const [file, ...args] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/run.mjs <script.ts> [args…]'); process.exit(2); }
const server = await createServer({
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});
let code = 0;
try {
  const mod = await server.ssrLoadModule(path.resolve(file));
  await mod.main(args);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
