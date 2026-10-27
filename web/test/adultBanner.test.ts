import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdultStatusBadge } from '../components/AdultToggle';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
(globalThis as { React?: unknown }).React = React;
test('18+ badge reflects permission and reveal without needing adult tags', () => {
  const render = (shown: boolean, allowed: boolean) => renderToStaticMarkup(React.createElement(AdultStatusBadge, { shown, allowed }));
  assert.match(render(true, true), /data-adult-badge/);
  assert.equal(render(false, true), '');
  assert.equal(render(true, false), '');
  assert.equal(render(false, false), '');
});
test('desktop and mobile avatars carry the indicator instead of a page banner', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  assert.doesNotMatch(read('components/AppShell.tsx'), /AdultBanner/);
  assert.ok(read('components/ProfileMenu.tsx').includes('<AdultBadge />'));
  assert.ok(read('app/page.tsx').includes('<AdultBadge />'));
});
