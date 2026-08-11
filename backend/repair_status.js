// Script de reparo - garantir que todos os profissionais estão com status 'ativo' correto
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function repair() {
    console.log('=== REPARO: Sincronizando Status dos Profissionais ===');
    
    const { data: pros, error } = await supabase
        .from('professionals')
        .select('id, name, username, status');
    
    if (error) {
        console.error('Erro ao buscar profissionais:', error.message);
        return;
    }

    for (const pro of pros) {
        if (pro.status !== 'ativo' && pro.username !== 'ricardo' && pro.username !== 'anapaula') { // Manter inativos quem já estava, exceto quem o usuário quer usar
             console.log(`Pulando ${pro.name} (inativo proposital)`);
             continue;
        }
        
        console.log(`Garantindo status 'ativo' para: ${pro.name} (${pro.username})`);
        const { error: updateErr } = await supabase
            .from('professionals')
            .update({ status: 'ativo' })
            .eq('id', pro.id);
            
        if (updateErr) console.error(`Erro ao atualizar ${pro.name}:`, updateErr.message);
    }
    
    console.log('=== REPARO CONCLUÍDO ===');
}

repair().catch(console.error);
