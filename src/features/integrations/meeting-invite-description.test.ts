import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEETING_INVITE_DESCRIPTION,
  descriptionFromMeetingRecord,
  meetingInviteDescription,
} from './meeting-invite-description';

describe('descrição padrão do convite', () => {
  it('é o texto oficial, com emojis, aspas e as quatro instruções', () => {
    expect(DEFAULT_MEETING_INVITE_DESCRIPTION).toBe(`✅ Para acessar a reunião basta clicar no link abaixo e depois no botão azul de "Entrar com Google Meet" ou se estiver em inglês "Login with Google Meet". Algumas informações sobre a nossa reunião:

💻 1) É fundamental acessar de um computador ou notebook com câmera, para visualizar melhor as informações;

🎥 2) Não é obrigatório, mas é melhor usar uma webcam;

🎧 3) Fundamental você ter microfone e de preferência um fone de ouvido, também;

📶 4) É importante ter uma boa conexão de 'internet'. Se possível, com cabo.`);
    expect(DEFAULT_MEETING_INVITE_DESCRIPTION).not.toMatch(/—/);
  });

  it('omissão usa o padrão e texto vazio ou editado permanece', () => {
    expect(meetingInviteDescription(undefined)).toBe(DEFAULT_MEETING_INVITE_DESCRIPTION);
    expect(meetingInviteDescription(null)).toBe(DEFAULT_MEETING_INVITE_DESCRIPTION);
    expect(meetingInviteDescription('')).toBe('');
    expect(meetingInviteDescription('Trazer o contrato.')).toBe('Trazer o contrato.');
  });

  it('separa a descrição gravada do título, do Meet e do horário', () => {
    const stored = [
      'V4 Company + Mercante Net',
      DEFAULT_MEETING_INVITE_DESCRIPTION,
      'Google Meet: https://meet.google.com/abc-defg-hij',
      'Horário: 10/11/2026, 11:00:00 - 10/11/2026, 12:00:00',
    ].join('\n');
    expect(descriptionFromMeetingRecord(stored)).toBe(DEFAULT_MEETING_INVITE_DESCRIPTION);
    expect(descriptionFromMeetingRecord('Só o título')).toBeNull();
    expect(descriptionFromMeetingRecord(null)).toBeNull();
  });
});
