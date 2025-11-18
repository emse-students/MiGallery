import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    testTimeout: 30000, // 30 secondes pour les tests d'API
    hookTimeout: 30000, // 30 secondes pour les hooks (setup/teardown)
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  }
});