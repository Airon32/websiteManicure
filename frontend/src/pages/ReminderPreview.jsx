/* eslint-disable react/prop-types */
import ReminderSettings from '../components/reminders/ReminderSettings';
import ReminderIndicator from '../components/reminders/ReminderIndicator';
import AppointmentReminderPanel from '../components/reminders/AppointmentReminderPanel';
import { ReminderProvider } from '../components/reminders/ReminderContext';

const professionals = [
  { id: 'owner-1', name: 'Mariana', role: 'owner', is_owner: true, status: 'ativo', whatsapp_phone_set: true, whatsapp_phone_masked: '+5511****4321' },
  { id: 'pro-2', name: 'Jécia', role: 'professional', status: 'ativo', whatsapp_phone_set: false, whatsapp_phone_masked: '' },
  { id: 'pro-3', name: 'Paula', role: 'professional', status: 'ativo', whatsapp_phone_set: true, whatsapp_phone_masked: '+5511****2233' }
];

const appointments = [
  { id: 'a1', status: 'agendado', date: '2026-08-20', time: '10:00', client_name: 'Ana Souza', client_phone: '11988887777', service_name: 'Alongamento', professional_name: 'Jécia' },
  { id: 'a2', status: 'agendado', date: '2026-08-20', time: '11:00', client_name: 'Bia Lima', client_phone: '11977776666', service_name: 'Esmaltação', professional_name: 'Paula' },
  { id: 'a3', status: 'agendado', date: '2026-08-20', time: '12:00', client_name: 'Carla Nunes', client_phone: '11966665555', service_name: 'Pedicure', professional_name: 'Jécia' },
  { id: 'a4', status: 'agendado', date: '2026-08-20', time: '14:00', client_name: 'Dora Alves', client_phone: '11955554444', service_name: 'Manicure', professional_name: 'Paula' },
  { id: 'a5', status: 'cancelado', date: '2026-08-20', time: '15:00', client_name: 'Eva Rocha', client_phone: '11944443333', service_name: 'Blindagem', professional_name: 'Jécia' }
];

export default function ReminderPreview() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-4 md:p-8">
      <ReminderProvider
        appointments={appointments}
        professionals={professionals}
        settingsData={[]}
        channelReady={false}
        allowDemoEvents
        user={{ id: 'owner-1', name: 'Mariana', role: 'owner' }}
      >
        <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-3">Painel ADM · Ajustes · Lembretes e notificações</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {appointments.map(app => (
            <div key={app.id} className="flex items-center gap-2 rounded-xl border border-primary/20 bg-card px-3 py-2">
              <span className="text-xs font-bold">{app.client_name}</span>
              <ReminderIndicator appointment={app} />
            </div>
          ))}
        </div>
        <ReminderSettings professionals={professionals} />
        <div className="mt-8 max-w-md bg-card border border-primary/20 rounded-[2rem] overflow-hidden">
          <AppointmentReminderPanel appointment={appointments[0]} />
        </div>
      </ReminderProvider>
    </div>
  );
}
