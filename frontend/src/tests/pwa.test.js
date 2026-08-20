import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isIosDevice, isStandaloneDisplay } from '../utils/iosDisplay.js';

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('iPhone app shell / PWA', () => {
  it('detects iPhone user agents and standalone display', () => {
    assert.equal(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)'), true);
    assert.equal(isIosDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
    assert.equal(isIosDevice('Macintosh', { platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: true }), navigator: {} }), true);
    assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
    assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
  });

  it('ships a standalone manifest that opens the staff agenda', async () => {
    const manifest = JSON.parse(await readFile(join(frontendRoot, 'public/manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/admin');
    assert.ok(manifest.icons.some(icon => icon.src.endsWith('.png') && icon.sizes === '180x180'));
    assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  });

  it('enables iOS home-screen meta and PNG touch icon', async () => {
    const html = await readFile(join(frontendRoot, 'index.html'), 'utf8');
    assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /apple-touch-icon\.png/);
    assert.match(html, /manifest\.webmanifest/);
    assert.equal(existsSync(join(frontendRoot, 'public/apple-touch-icon.png')), true);
    assert.equal(existsSync(join(frontendRoot, 'public/icon-192.png')), true);
    assert.equal(existsSync(join(frontendRoot, 'public/icon-512.png')), true);
  });

  it('keeps Fechar Horário actions in a sticky sheet footer', async () => {
    const dashboard = await readFile(join(frontendRoot, 'src/pages/AdminDashboard.jsx'), 'utf8');
    assert.match(dashboard, /id="block-slot-title"/);
    assert.match(dashboard, /className="app-sheet-actions"/);
    assert.match(dashboard, /Bloquear/);
  });
});
