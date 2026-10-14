import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/<repo>/ without knowing the repo name.
  base: './',
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 120000 },
});
