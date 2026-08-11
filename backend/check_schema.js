require('dotenv').config({ path: './backend/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Erro ao buscar appointments:', error.message);
  } else {
    console.log('Colunas em appointments:', Object.keys(data[0] || {}));
  }
}

checkSchema();
