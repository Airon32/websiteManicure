const supabase = require('./database');

async function sanitizeProfessionals() {
    console.log("--- Iniciando Saneamento de Profissionais ---");
    
    // 1. Buscar todos os profissionais
    const { data, error } = await supabase.from('professionals').select('id, name, status');
    
    if (error) {
        console.error("Erro ao carregar profissionais:", error);
        return;
    }

    console.log(`Total encontrados: ${data.length}`);

    // 2. Identificar os que estão com status nulo ou vazio
    const toFix = data.filter(p => !p.status);
    console.log(`Profissionais para corrigir (sem status): ${toFix.length}`);

    if (toFix.length === 0) {
        console.log("Todos os profissionais já possuem status definido. Nada a fazer.");
        return;
    }

    // 3. Atualizar um por um (mais seguro para evitar erros globais)
    for (const pro of toFix) {
        process.stdout.write(`Corrigindo ${pro.name}... `);
        const { error: upErr } = await supabase
            .from('professionals')
            .update({ status: 'ativo' })
            .eq('id', pro.id);
        
        if (upErr) {
            console.log("ERRO: " + upErr.message);
        } else {
            console.log("OK!");
        }
    }

    console.log("--- Saneamento Concluído ---");
}

sanitizeProfessionals();
