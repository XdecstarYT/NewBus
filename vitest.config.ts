import { defineConfig } from 'vitest/config';

// Delegate to the server project so tests always use its in-memory database config.
export default defineConfig({
  test: { projects: ['apps/server'] },
});
