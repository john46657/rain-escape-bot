import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**', 'modules/**/src/**'],
    },
  },
  resolve: {
    alias: {
      '@nexus/shared': resolve('./packages/shared/src/index.ts'),
      '@nexus/logger': resolve('./packages/logger/src/index.ts'),
      '@nexus/config': resolve('./packages/config/src/index.ts'),
      '@nexus/cache': resolve('./packages/cache/src/index.ts'),
      '@nexus/database': resolve('./packages/database/src/index.ts'),
      '@nexus/permissions': resolve('./packages/permissions/src/index.ts'),
      '@nexus/security': resolve('./packages/security/src/index.ts'),
      '@nexus/roblox-sdk': resolve('./packages/roblox-sdk/src/index.ts'),
      '@nexus/bot-core': resolve('./apps/bot/src/core/index.ts'),
    },
  },
});
