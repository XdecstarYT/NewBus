import { defineConfig } from 'vitest/config';

// Tests live in the API package (they run on an in-process Postgres).
export default defineConfig({
  test: { projects: ['apps/api'] },
});
