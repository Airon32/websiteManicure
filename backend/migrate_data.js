require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

async function migrate() {
    console.log('--- Iniciando Migração para Supabase ---');

    // 1. Migrar Serviços
    console.log('Migrando Serviços...');
    const services = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM services", (err, rows) => err ? reject(err) : resolve(rows));
    });
    for (const s of services) {
        const { error } = await supabase.from('services').insert([s]);
        if (error) console.error('Erro ao migrar serviço:', error.message);
    }

    // 2. Migrar Profissionais
    console.log('Migrando Profissionais...');
    const pros = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM professionals", (err, rows) => err ? reject(err) : resolve(rows));
    });
    for (const p of pros) {
        const { error } = await supabase.from('professionals').insert([p]);
        if (error) console.error('Erro ao migrar profissional:', error.message);
    }

    // 3. Migrar Clientes
    console.log('Migrando Clientes...');
    const clients = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM clients", (err, rows) => err ? reject(err) : resolve(rows));
    });
    for (const c of clients) {
        const { error } = await supabase.from('clients').insert([c]);
        if (error) console.error('Erro ao migrar cliente:', error.message);
    }

    // 4. Migrar Settings
    console.log('Migrando Settings...');
    const settings = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM settings", (err, rows) => err ? reject(err) : resolve(rows));
    });
    for (const s of settings) {
        const { error } = await supabase.from('settings').upsert([s]);
        if (error) console.error('Erro ao migrar setting:', error.message);
    }

    // 5. Migrar Agendamentos
    console.log('Migrando Agendamentos...');
    const appointments = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM appointments", (err, rows) => err ? reject(err) : resolve(rows));
    });
    for (const a of appointments) {
        const { error } = await supabase.from('appointments').insert([a]);
        if (error) console.error('Erro ao migrar agendamento:', error.message);
    }

    console.log('--- Migração Concluída com Sucesso! ---');
    db.close();
}

migrate().catch(console.error);
