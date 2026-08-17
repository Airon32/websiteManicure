const test = require('node:test');
const assert = require('node:assert/strict');

test('seed script refuses to run without DEV_SEED_PASSWORD', async () => {
    const { spawnSync } = require('node:child_process');
    const path = require('node:path');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'seed-dev-staff.js')], {
        env: {
            ...process.env,
            NODE_ENV: 'development',
            SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_SECRET_KEY: '0123456789012345678901234567890123456789012345',
            DEV_SEED_PASSWORD: ''
        },
        encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /DEV_SEED_PASSWORD/);
});

test('seed script refuses production', async () => {
    const { spawnSync } = require('node:child_process');
    const path = require('node:path');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'seed-dev-staff.js')], {
        env: {
            ...process.env,
            NODE_ENV: 'production',
            SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_SECRET_KEY: '0123456789012345678901234567890123456789012345',
            DEV_SEED_PASSWORD: 'senha-forte-dev'
        },
        encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /production/i);
});
