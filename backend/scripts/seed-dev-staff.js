#!/usr/bin/env node
/**
 * DEV-only: cria (ou atualiza senha de) um profissional staff para login no painel.
 *
 * Uso (DEV SERVER, com backend/.env real — nunca commitar):
 *   DEV_SEED_PASSWORD='sua-senha-forte' npm run seed:dev-staff
 *
 * Variáveis opcionais:
 *   DEV_SEED_USERNAME  (default: dev-owner)
 *   DEV_SEED_NAME      (default: Dev Owner)
 *   DEV_SEED_ROLE      owner | admin  (default: owner)
 *   DEV_SEED_FORCE=1   redefine a senha se o username já existir
 *
 * Não imprime a senha. Só username, id e role.
 */
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { hashPassword } = require('../security');

const ALLOWED_ROLES = new Set(['owner', 'admin', 'professional']);

function fail(message) {
    console.error(`[seed-dev-staff] ${message}`);
    process.exit(1);
}

async function main() {
    if (process.env.NODE_ENV === 'production') {
        fail('Recusado em NODE_ENV=production.');
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        fail('Configure SUPABASE_URL e SUPABASE_SECRET_KEY (backend/.env).');
    }

    const username = String(process.env.DEV_SEED_USERNAME || 'dev-owner').trim().toLowerCase();
    const name = String(process.env.DEV_SEED_NAME || 'Dev Owner').trim();
    const role = String(process.env.DEV_SEED_ROLE || 'owner').trim().toLowerCase();
    const password = String(process.env.DEV_SEED_PASSWORD || '').trim();
    const force = ['1', 'true', 'yes'].includes(String(process.env.DEV_SEED_FORCE || '').toLowerCase());

    if (!/^[\p{L}\p{N}._-]{3,50}$/u.test(username)) {
        fail('DEV_SEED_USERNAME inválido (3–50 chars, letras/números/._-).');
    }
    if (!ALLOWED_ROLES.has(role)) {
        fail(`DEV_SEED_ROLE inválido. Use: ${[...ALLOWED_ROLES].join(', ')}.`);
    }
    if (password.length < 8) {
        fail('Defina DEV_SEED_PASSWORD com pelo menos 8 caracteres (não commitar).');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { data: existing, error: lookupError } = await supabase
        .from('professionals')
        .select('id, username, role, status')
        .ilike('username', username)
        .maybeSingle();

    if (lookupError) {
        console.error('[seed-dev-staff] Supabase lookup error:', {
            code: lookupError.code || null,
            message: lookupError.message || null,
            details: lookupError.details || null
        });
        fail('Falha ao consultar professionals.');
    }

    const passwordHash = await hashPassword(password);

    if (existing) {
        if (!force) {
            console.log(JSON.stringify({
                status: 'exists',
                id: existing.id,
                username: existing.username,
                role: existing.role,
                hint: 'Use DEV_SEED_FORCE=1 para redefinir a senha.'
            }, null, 2));
            return;
        }
        const { data: updated, error: updateError } = await supabase
            .from('professionals')
            .update({
                password: passwordHash,
                role,
                status: 'ativo',
                name
            })
            .eq('id', existing.id)
            .select('id, username, role, status')
            .single();
        if (updateError) {
            console.error('[seed-dev-staff] Supabase update error:', {
                code: updateError.code || null,
                message: updateError.message || null,
                details: updateError.details || null
            });
            fail('Falha ao atualizar profissional.');
        }
        console.log(JSON.stringify({
            status: 'updated',
            id: updated.id,
            username: updated.username,
            role: updated.role
        }, null, 2));
        return;
    }

    const { data: maxRow } = await supabase
        .from('professionals')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
    const nextId = (maxRow && maxRow[0] ? Number(maxRow[0].id) : 0) + 1;

    const { data: created, error: insertError } = await supabase
        .from('professionals')
        .insert([{
            id: nextId,
            name,
            avatar: name.slice(0, 2).toUpperCase() || 'DO',
            specialty: role === 'owner' ? 'Proprietária' : 'Administração',
            username,
            password: passwordHash,
            role,
            status: 'ativo'
        }])
        .select('id, username, role, status')
        .single();

    if (insertError) {
        console.error('[seed-dev-staff] Supabase insert error:', {
            code: insertError.code || null,
            message: insertError.message || null,
            details: insertError.details || null
        });
        fail('Falha ao inserir profissional.');
    }

    console.log(JSON.stringify({
        status: 'created',
        id: created.id,
        username: created.username,
        role: created.role
    }, null, 2));
}

main().catch(error => {
    console.error('[seed-dev-staff] Exceção:', error.message);
    process.exit(1);
});
