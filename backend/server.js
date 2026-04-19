const express = require('express');
const cors = require('cors');
const supabase = require('./database.js');

const app = express();
app.use(cors());
app.use(express.json());

// Logger simples
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

const PORT = 3001;
const DEFAULT_WORK_START = '09:00';
const DEFAULT_WORK_END = '18:00';
const DEFAULT_SLOT_INTERVAL = 30;
const DEFAULT_WORK_DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DAY_NAME_MAP = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };

function getProfessionalSettingKey(professionalId, suffix) {
    return `professional_${professionalId}_${suffix}`;
}

async function loadSettingsMap() {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;
    return Object.fromEntries((data || []).map(setting => [setting.key, setting.value]));
}

function parseWorkDays(value) {
    if (!value) return [...DEFAULT_WORK_DAYS];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_WORK_DAYS];
    } catch {
        return [...DEFAULT_WORK_DAYS];
    }
}

function buildProfessionalSchedule(settingsMap, professionalId) {
    return {
        work_start: settingsMap[getProfessionalSettingKey(professionalId, 'work_start')] || settingsMap.work_start || DEFAULT_WORK_START,
        work_end: settingsMap[getProfessionalSettingKey(professionalId, 'work_end')] || settingsMap.work_end || DEFAULT_WORK_END,
        slot_interval: Number(settingsMap[getProfessionalSettingKey(professionalId, 'slot_interval')] || settingsMap.slot_interval || DEFAULT_SLOT_INTERVAL),
        work_days: parseWorkDays(settingsMap[getProfessionalSettingKey(professionalId, 'work_days')] || settingsMap.work_days)
    };
}

function validateAppointmentAgainstSchedule({ date, time, duration, schedule }) {
    const appointmentDate = new Date(`${date}T00:00:00`);
    const dayKey = DAY_NAME_MAP[appointmentDate.getDay()];

    if (!schedule.work_days.includes(dayKey)) {
        return { valid: false, error: 'Este profissional não atende no dia selecionado.' };
    }

    const startMinutes = timeToMinutes(schedule.work_start);
    const endMinutes = timeToMinutes(schedule.work_end);
    const appointmentStart = timeToMinutes(time);
    const appointmentEnd = appointmentStart + duration;

    if (appointmentStart < startMinutes || appointmentEnd > endMinutes) {
        return { valid: false, error: 'O horário escolhido está fora do expediente configurado para este profissional.' };
    }

    if ((appointmentStart - startMinutes) % schedule.slot_interval !== 0) {
        return { valid: false, error: 'O horário escolhido não respeita o intervalo configurado para este profissional.' };
    }

    return { valid: true };
}

// --- ROTA DE LOGIN ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const { data, error } = await supabase
        .from('professionals')
        .select('id, name, role, avatar, username, specialty')
        .eq('username', username)
        .eq('password', password)
        .single();

    if (error) return res.status(401).json({"error": "Usuário ou senha incorretos."});
    res.json({"message": "success", "data": data});
});

// --- ROTAS DE SERVIÇOS ---
app.get('/api/services', async (req, res) => {
    const { data, error } = await supabase.from('services').select('*').order('name');
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success", "data": data });
});

app.post('/api/services', async (req, res) => {
    const { name, duration, price } = req.body;
    const { data, error } = await supabase
        .from('services')
        .insert([{ name, duration, price }])
        .select();
    
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success", "data": data[0] });
});

app.delete('/api/services/:id', async (req, res) => {
    const { error } = await supabase.from('services').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success" });
});

// --- ROTAS DE PROFISSIONAIS ---
app.get('/api/professionals', async (req, res) => {
    const { data, error } = await supabase
        .from('professionals')
        .select('id, name, role, avatar, specialty, username, status')
        .neq('role', 'admin')
        .eq('status', 'ativo')
        .order('name');
    
    if (error) return res.status(400).json({"error": error.message});

    try {
        const settingsMap = await loadSettingsMap();
        const withSchedule = (data || []).map(professional => ({
            ...professional,
            ...buildProfessionalSchedule(settingsMap, professional.id)
        }));

        res.json({ "message": "success", "data": withSchedule });
    } catch (settingsError) {
        res.status(400).json({ "error": settingsError.message });
    }
});

app.get('/api/professionals/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('professionals')
        .select('id, name, role, avatar, specialty, username, status')
        .eq('id', id)
        .single();

    if (error) return res.status(404).json({ "error": "Profissional nÃ£o encontrado." });

    try {
        const settingsMap = await loadSettingsMap();
        res.json({
            "message": "success",
            "data": {
                ...data,
                ...buildProfessionalSchedule(settingsMap, data.id)
            }
        });
    } catch (settingsError) {
        res.status(400).json({ "error": settingsError.message });
    }
});

app.post('/api/professionals', async (req, res) => {
    const { name, avatar, specialty, username, password } = req.body;
    
    // Buscar o maior ID existente para evitar conflito de sequência
    const { data: maxRow } = await supabase
        .from('professionals')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
    const nextId = (maxRow && maxRow[0] ? maxRow[0].id : 0) + 1;

    const { data, error } = await supabase
        .from('professionals')
        .insert([{ id: nextId, name, avatar, specialty, status: "ativo", username, password, role: "professional" }])
        .select();
    
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success", "data": data[0] });
});

app.put('/api/professionals/:id', async (req, res) => {
    const { id } = req.params;
    const name = String(req.body.name || '').trim();
    const specialty = String(req.body.specialty || '').trim();
    const avatar = String(req.body.avatar || '').trim().slice(0, 2).toUpperCase();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();

    if (!name || !specialty || !avatar || !username) {
        return res.status(400).json({ "error": "Nome, especialidade, iniciais e usuÃ¡rio sÃ£o obrigatÃ³rios." });
    }

    const { data: existingUsername, error: usernameError } = await supabase
        .from('professionals')
        .select('id')
        .eq('username', username)
        .neq('id', id)
        .limit(1);

    if (usernameError) {
        return res.status(400).json({ "error": usernameError.message });
    }

    if (existingUsername && existingUsername.length > 0) {
        return res.status(400).json({ "error": "Este nome de usuÃ¡rio jÃ¡ estÃ¡ em uso." });
    }

    const updatePayload = { name, specialty, avatar, username };
    if (password) updatePayload.password = password;

    const { data, error } = await supabase
        .from('professionals')
        .update(updatePayload)
        .eq('id', id)
        .select('id, name, role, avatar, specialty, username, status')
        .single();

    if (error) return res.status(400).json({ "error": error.message });
    res.json({ "message": "success", "data": data });
});

app.delete('/api/professionals/:id', async (req, res) => {
    // Soft Delete: Apenas desativamos para não quebrar o histórico de faturamento
    const { error } = await supabase
        .from('professionals')
        .update({ status: 'inativo' })
        .eq('id', req.params.id);
        
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success" });
});

// --- ROTAS DE CLIENTES ---
app.get('/api/clients', async (req, res) => {
    const { data, error } = await supabase.from('clients').select('*').order('name');
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success", "data": data });
});

app.put('/api/clients/:id', async (req, res) => {
    const { id } = req.params;
    const { name, phone } = req.body;
    const { data, error } = await supabase
        .from('clients')
        .update({ name, phone })
        .eq('id', id)
        .select();
    
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success", "data": data[0] });
});

app.delete('/api/clients/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success" });
});

app.post('/api/clients', async (req, res) => {
    const { name, phone } = req.body;
    if (!phone) return res.status(400).json({ "error": "Telefone é obrigatório." });

    try {
        // Busca robusta: tenta pelo telefone exato OU pelo telefone limpo
        const cleanPhone = phone.replace(/\D/g, "");
        const { data: byExact } = await supabase.from('clients').select('id').eq('phone', phone).maybeSingle();
        const { data: byClean } = !byExact ? await supabase.from('clients').select('id').eq('phone', cleanPhone).maybeSingle() : { data: null };
        const existing = byExact || byClean;
        
        let result;
        if (existing) {
            // Se já existe, atualizamos o nome se fornecido
            if (name) {
                result = await supabase.from('clients').update({ name }).eq('id', existing.id).select();
            } else {
                result = await supabase.from('clients').select('*').eq('id', existing.id);
            }
        } else {
            // Se não existe, criamos novo
            result = await supabase.from('clients').insert([{ name: name || 'Cliente Novo', phone: cleanPhone }]).select();
        }

        if (result.error) return res.status(400).json({ "error": result.error.message });
        res.json({ "message": "success", "data": result.data[0] });
    } catch (err) {
        console.error('Erro na rota POST /api/clients:', err);
        res.status(500).json({ "error": "Erro interno ao processar cliente." });
    }
});

app.get('/api/clients/appointments', async (req, res) => {
    const { phone, name } = req.query;
    if (!phone && !name) return res.status(400).json({"error": "Telefone ou Nome obrigatório."});
    
    let query = supabase
        .from('appointments')
        .select(`
            *,
            service:services(*),
            professional:professionals(*)
        `)
        .order('date', { ascending: false })
        .order('time', { ascending: false });

    // Busca híbrida robusta
    const cleanPhone = (phone || "").trim();
    const cleanName = (name || "").trim();

    if (cleanPhone && cleanName) {
        query = query.or(`client_phone.ilike.%${cleanPhone}%,client_name.ilike.%${cleanName}%`);
    } else if (cleanPhone) {
        query = query.ilike('client_phone', `%${cleanPhone}%`);
    } else if (cleanName) {
        query = query.ilike('client_name', `%${cleanName}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({"error": error.message});
    
    // Formatar para manter compatibilidade com o frontend
    const formatted = data.map(app => ({
        ...app,
        service_name: app.service?.name,
        service_price: app.service?.price,
        service_duration: app.service?.duration,
        professional_name: app.professional?.name
    }));

    let client_name_res = name || "";
    if (!client_name_res && formatted.length > 0) {
        client_name_res = formatted[0].client_name;
    }

    res.json({ "message": "success", "data": { appointments: formatted, client_name: client_name_res } });
});

// Busca consolidada e robusta de histórico (Novo Endpoint Blindado)
app.get('/api/clients/my-history', async (req, res) => {
    const { phone, name, type } = req.query; // type can be 'future' or 'all'
    if (!phone && !name) return res.status(400).json({"error": "Telefone ou Nome obrigatório."});
    
    // LIMPEZA DE TELEFONE: Remove tudo que não é número
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const cleanName = (name || "").trim();
    const today = new Date().toISOString().split('T')[0];

    console.log(`[Busca Histórico] Phone: ${cleanPhone}, Name: ${cleanName}, Type: ${type}`);

    let query = supabase
        .from('appointments')
        .select(`
            *,
            service:services(*),
            professional:professionals(*)
        `);

    // Filtro de telefone ou nome
    if (cleanPhone && cleanName) {
        // Tenta achar pelo telefone OU pelo nome
        query = query.or(`client_phone.ilike.%${cleanPhone}%,client_name.ilike.%${cleanName}%`);
    } else if (cleanPhone) {
        query = query.ilike('client_phone', `%${cleanPhone}%`);
    } else {
        query = query.ilike('client_name', `%${cleanName}%`);
    }

    // Filtro de tipo (futuros ou todos)
    if (type === 'future') {
        query = query.gte('date', today).neq('status', 'cancelado');
    }

    query = query.order('date', { ascending: type === 'future' }).order('time', { ascending: type === 'future' });

    const { data, error } = await query;

    if (error) {
        console.error('[Erro Supabase Histórico]:', error.message);
        return res.status(400).json({"error": error.message});
    }
    
    const formatted = data.map(app => ({
        ...app,
        service_name: app.service?.name,
        service_price: app.service?.price,
        service_duration: app.service?.duration,
        professional_name: app.professional?.name
    }));

    res.json({ "message": "success", "data": formatted });
});

// Busca apenas agendamentos futuros (Legado/Compatibilidade)
app.get('/api/clients/future-appointments', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({"error": "Telefone obrigatório."});
    
    const cleanPhone = phone.replace(/\D/g, "");
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('appointments')
        .select(`
            *,
            service:services(*),
            professional:professionals(*)
        `)
        .ilike('client_phone', `%${cleanPhone}%`)
        .gte('date', today)
        .neq('status', 'cancelado')
        .order('date', { ascending: true })
        .order('time', { ascending: true });

    if (error) return res.status(400).json({"error": error.message});
    
    const formatted = data.map(app => ({
        ...app,
        service_name: app.service?.name,
        service_price: app.service?.price,
        service_duration: app.service?.duration,
        professional_name: app.professional?.name
    }));

    res.json({ "message": "success", "data": formatted });
});

// --- ROTAS DE AGENDAMENTOS ---
app.get('/api/appointments', async (req, res) => {
    const { date, professional_id, client_phone } = req.query;
    let query = supabase.from('appointments').select(`
        *,
        service:services(*),
        professional:professionals(*)
    `);

    if (date) query = query.eq('date', date);
    if (professional_id) query = query.eq('professional_id', professional_id);
    if (client_phone) {
        const cleanPhone = client_phone.replace(/\D/g, "");
        query = query.ilike('client_phone', `%${cleanPhone}%`);
    }
    
    // Ordenar por data e hora (mais recentes em cima se for busca de cliente)
    query = query.order('date', { ascending: false }).order('time', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(400).json({"error": error.message});
    
    const formatted = data.map(app => {
        let duration = app.service?.duration;
        let sName = app.service?.name;
        
        if (!duration && app.notes && typeof app.notes === 'string' && app.notes.startsWith('BLOCK:')) {
            duration = parseInt(app.notes.split(':')[1], 10);
            sName = "⏳ Agenda Fechada";
        }
        
        return {
            ...app,
            service_name: sName,
            service_price: app.service?.price,
            service_duration: duration,
            professional_name: app.professional?.name
        };
    });

    res.json({ "message": "success", "data": formatted });
});

app.post('/api/appointments', async (req, res) => {
    const { client_name, client_phone, service_id, professional_id, date, time, notes } = req.body;
    
    // 1. Buscar a duração do serviço
    const { data: service, error: sErr } = await supabase
        .from('services')
        .select('duration')
        .eq('id', service_id)
        .single();
    
    if (sErr || !service) return res.status(400).json({"error": "Serviço inválido."});
    
    const newDuration = service.duration;
    const newStart = timeToMinutes(time);
    const newEnd = newStart + newDuration;

    try {
        const settingsMap = await loadSettingsMap();
        const professionalSchedule = buildProfessionalSchedule(settingsMap, professional_id);
        const scheduleValidation = validateAppointmentAgainstSchedule({
            date,
            time,
            duration: newDuration,
            schedule: professionalSchedule
        });

        if (!scheduleValidation.valid) {
            return res.status(400).json({ "error": scheduleValidation.error });
        }
    } catch (settingsError) {
        return res.status(400).json({ "error": settingsError.message });
    }

    // 2. Buscar agendamentos existentes para o profissional no dia
    // Nota: Mudamos para 'services!inner' ou aliasing se necessário, 
    // mas aqui buscamos o objeto service completo para garantir.
    const { data: existing, error: eErr } = await supabase
        .from('appointments')
        .select(`
            time,
            service:services(duration)
        `)
        .eq('professional_id', professional_id)
        .eq('date', date)
        .neq('status', 'cancelado');
    
    if (eErr) return res.status(500).json({"error": eErr.message});

    // 3. Verificar sobreposição
    // (InícioA < FimB) && (FimA > InícioB)
    const conflict = existing.some(app => {
        const exStart = timeToMinutes(app.time);
        const exDuration = app.service?.duration || 30;
        const exEnd = exStart + exDuration;

        const isOverlapping = (newStart < exEnd && newEnd > exStart);
        return isOverlapping;
    });

    if (conflict) {
        return res.status(400).json({"error": "Ops! Esse horário ou parte dele já está ocupado por outro atendimento. Por favor, escolha outro horário."});
    }

    // 4. Inserir Agendamento
    const { data, error } = await supabase
        .from('appointments')
        .insert([{ client_name, client_phone, service_id, professional_id, date, time, status: 'agendado', notes }])
        .select();

    if (error) return res.status(400).json({ "error": error.message });

    // 5. SINCRONIZAÇÃO DE CLIENTE (Upsert)
    // Usa telefone limpo (só números) para busca e inserção, evitando duplicatas
    try {
        const cleanPhone = client_phone.replace(/\D/g, "");
        // Busca pelo telefone limpo OU pelo formato original para cobrir registros antigos
        const { data: byClean } = await supabase.from('clients').select('id').eq('phone', cleanPhone).maybeSingle();
        const { data: byOriginal } = !byClean ? await supabase.from('clients').select('id').eq('phone', client_phone).maybeSingle() : { data: null };
        const existingClient = byClean || byOriginal;
        
        if (existingClient) {
            // Atualiza nome e normaliza o telefone para o formato limpo
            await supabase.from('clients').update({ name: client_name, phone: cleanPhone }).eq('id', existingClient.id);
        } else {
            // Insere com telefone limpo (sem formatação)
            await supabase.from('clients').insert([{ name: client_name, phone: cleanPhone }]);
        }
    } catch (clientErr) {
        console.error('Erro ao sincronizar cliente:', clientErr);
        // Não bloqueia o agendamento se der erro aqui
    }

    res.json({ "message": "success", "data": data[0] });
});

// Criar um bloqueio de horário (Horário Fechado)
app.post('/api/appointments/block', async (req, res) => {
    const { professional_id, date, time, duration, description } = req.body;
    
    try {
        // Validação básica do horário (não cruzar o expediente)
        const settingsMap = await loadSettingsMap();
        const professionalSchedule = buildProfessionalSchedule(settingsMap, professional_id);
        
        const newStart = timeToMinutes(time);
        const newEnd = newStart + Number(duration);
        const schedEnd = timeToMinutes(professionalSchedule.work_end);
        
        if (newEnd > schedEnd) {
            return res.status(400).json({"error": "O bloqueio excede o horário de expediente."});
        }
        
        // Regra de Conflitos
        const { data: existing, error: eErr } = await supabase
            .from('appointments')
            .select(`
                time, 
                notes,
                services!left(duration)
            `)
            .eq('professional_id', professional_id)
            .eq('date', date)
            .neq('status', 'cancelado');
            
        if (!eErr && existing) {
            const hasConflict = existing.some(app => {
                const exStart = timeToMinutes(app.time);
                
                let exDuration = 30;
                if (app.services && app.services.duration) {
                    exDuration = Number(app.services.duration);
                } else if (app.notes && typeof app.notes === 'string' && app.notes.startsWith('BLOCK:')) {
                    exDuration = parseInt(app.notes.split(':')[1], 10);
                }
                
                const exEnd = exStart + exDuration;
                return (newStart < exEnd && newEnd > exStart);
            });
            if (hasConflict) {
                return res.status(400).json({"error": "Já existe um agendamento ou bloqueio neste horário."});
            }
        }
        
        // Inserir o Bloqueio
        const { data: insertData, error: insertError } = await supabase.from('appointments').insert([{
            client_name: description ? `Bloqueio: ${description}` : 'Bloqueio de Agenda',
            client_phone: '00000000000',
            professional_id,
            date,
            time,
            status: 'confirmado',
            notes: description ? `BLOCK:${duration}|${description}` : `BLOCK:${duration}`
        }]).select();
        
        if (insertError) return res.status(400).json({"error": insertError.message});
        
        res.json({ "message": "success", "data": insertData[0] });
    } catch (e) {
         res.status(400).json({"error": e.message});
    }
});

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

app.delete('/api/appointments/:id', async (req, res) => {
    const { error } = await supabase.from('appointments').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success" });
});

app.post('/api/appointments/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .eq('id', id);

    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success" });
});

// --- ROTAS DE CONFIGURAÇÃO ---
app.get('/api/settings', async (req, res) => {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success", "data": data });
});

app.put('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    const { error } = await supabase
        .from('settings')
        .upsert([{ key, value }]);
    
    if (error) return res.status(400).json({"error": error.message});
    res.json({ "message": "success" });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} com Supabase`);
});
