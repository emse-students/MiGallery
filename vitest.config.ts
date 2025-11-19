import { defineConfig } from "vitest/config";
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    testTimeout: 30000, // 30 secondes pour les tests d'API
    hookTimeout: 30000, // 30 secondes pour les hooks (setup/teardown)
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    }
  }
});