require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function restore() {
    console.log('--- Restaurando Agendamento do Airon ---');

    // 1. Garantir que o serviço/profissional existem (ou usar IDs que já migramos)
    // No SQLite, o agendamento do Airon era: service_id: 4, professional_id: 2
    
    const aironApp = {
        client_name: "Airon Cavalcante do Nascimento ",
        client_phone: "11988853773",
        service_id: 4,
        professional_id: 2,
        date: "2026-04-17",
        time: "11:30",
        status: "agendado",
        notes: "Restaurado manualmente"
    };

    const { data, error } = await supabase
        .from('appointments')
        .insert([aironApp])
        .select();

    if (error) {
        console.error('Erro ao restaurar:', error.message);
    } else {
        console.log('Agendamento restaurado com sucesso:', data[0]);
    }
}

restore().catch(console.error);
