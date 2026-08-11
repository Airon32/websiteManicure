// Script de diagnóstico - verificar estado dos profissionais no Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function diagnose() {
    console.log('\n=== DIAGNÓSTICO: Tabela professionals ===\n');
    
    // 1. Buscar TODOS os profissionais sem filtro
    const { data: allPros, error: err1 } = await supabase
        .from('professionals')
        .select('id, name, username, password, status, role');
    
    if (err1) {
        console.error('ERRO ao buscar profissionais:', err1.message);
        return;
    }
    
    console.log(`Total de profissionais encontrados: ${allPros.length}\n`);
    
    allPros.forEach(p => {
        console.log(`  ID: ${p.id}`);
        console.log(`    name:     "${p.name}"`);
        console.log(`    username: "${p.username}" (length: ${p.username?.length})`);
        console.log(`    password: "${p.password}"`);
        console.log(`    status:   "${p.status}" (type: ${typeof p.status})`);
        console.log(`    role:     "${p.role}"`);
        console.log('');
    });

    // 2. Testar login da Mariana especificamente
    console.log('=== TESTE: Login "Mariana Oliveira" ===\n');
    
    const { data: mariana, error: err2 } = await supabase
        .from('professionals')
        .select('*')
        .ilike('username', 'Mariana Oliveira')
        .maybeSingle();
    
    if (err2) {
        console.error('ERRO na busca ilike:', err2.message);
    } else if (!mariana) {
        console.log('RESULTADO: Nenhum profissional encontrado com username "Mariana Oliveira"');
    } else {
        console.log('RESULTADO ENCONTRADO:');
        console.log(`  status: "${mariana.status}"`);
        console.log(`  senha no banco: "${mariana.password}"`);
        console.log(`  senha digitada: "123456"`);
        console.log(`  match: ${mariana.password === '123456'}`);
    }

    // 3. Testar com filtro de status
    console.log('\n=== TESTE: Com filtro status="ativo" ===\n');
    
    const { data: marianaAtivo, error: err3 } = await supabase
        .from('professionals')
        .select('*')
        .ilike('username', 'Mariana Oliveira')
        .eq('status', 'ativo')
        .maybeSingle();
    
    if (err3) {
        console.error('ERRO:', err3.message);
    } else if (!marianaAtivo) {
        console.log('RESULTADO: FALHOU - status nao bate com "ativo"!');
        console.log('>>> ESTA É A CAUSA DO BUG <<<');
    } else {
        console.log('RESULTADO: OK - encontrada com status ativo');
    }
}

diagnose().catch(console.error);
