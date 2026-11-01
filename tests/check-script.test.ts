/**
 * Pins the type-check gate's shape: `svelte-check --tsgo` does not resolve identifiers inside
 * Svelte templates, which let an undeclared `targetUserName` ship in v2.18.0. See
 * docs/wiki/type-checking.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;

describe('type-check scripts', () => {
  for (const name of ['check', 'check:watch']) {
    it(`${name} runs svelte-check without --tsgo`, () => {
      expect(scripts[name]).toContain('svelte-check');
      expect(scripts[name]).not.toContain('--tsgo');
    });
  }
});
