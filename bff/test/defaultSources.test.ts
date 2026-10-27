import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultExtensionSources } from '../src/lib/sources/suwayomi/defaultSources';

const sources = [{ id: 'fr', lang: 'fr' }, { id: 'main', lang: 'all' }, { id: 'en', lang: 'en' }, { id: 'en2', lang: 'en' }];
test('one English source by default, irrespective of listing order', () => {
  assert.deepEqual([...defaultExtensionSources(sources, new Set())], ['en']);
});
test('main source if there is no English source, otherwise one deterministic fallback', () => {
  assert.deepEqual([...defaultExtensionSources(sources.slice(0, 2), new Set())], ['main']);
  assert.deepEqual([...defaultExtensionSources([{ id: 'fr', lang: 'fr' }, { id: 'de', lang: 'de' }], new Set())], ['fr']);
  assert.deepEqual([...defaultExtensionSources([], new Set())], []);
});
test('only explicit preferred languages expand the default; hidden languages still win', () => {
  assert.deepEqual([...defaultExtensionSources(sources, new Set(), ['fr'])], ['en', 'fr']);
  assert.deepEqual([...defaultExtensionSources(sources, new Set(['fr']), ['fr'])], ['en']);
  assert.deepEqual([...defaultExtensionSources(sources, new Set(['en', 'fr', 'all']))], []);
});
