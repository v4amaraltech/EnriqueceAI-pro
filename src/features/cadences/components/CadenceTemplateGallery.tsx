'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, Linkedin, Mail, MessageSquare, Phone, Zap } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

const TEMPLATES = [
  {
    id: 'email-5-touches',
    name: 'Email — 5 Toques',
    description: '5 emails automáticos em 14 dias. Ideal para prospecção outbound.',
    icon: Mail,
    color: 'text-blue-500 bg-blue-500/10',
    steps: [
      { day: 1, channel: 'email' },
      { day: 3, channel: 'email' },
      { day: 6, channel: 'email' },
      { day: 10, channel: 'email' },
      { day: 14, channel: 'email' },
    ],
    type: 'auto_email',
  },
  {
    id: 'multichannel-7',
    name: 'Multicanal — 7 Passos',
    description: 'Email + WhatsApp + Ligação em 10 dias. Máxima conversão.',
    icon: Zap,
    color: 'text-amber-500 bg-amber-500/10',
    steps: [
      { day: 1, channel: 'email' },
      { day: 2, channel: 'whatsapp' },
      { day: 4, channel: 'phone' },
      { day: 5, channel: 'email' },
      { day: 7, channel: 'whatsapp' },
      { day: 9, channel: 'phone' },
      { day: 10, channel: 'email' },
    ],
    type: 'standard',
  },
  {
    id: 'whatsapp-3',
    name: 'WhatsApp — 3 Toques',
    description: '3 mensagens WhatsApp em 5 dias. Para leads inbound quentes.',
    icon: MessageSquare,
    color: 'text-emerald-500 bg-emerald-500/10',
    steps: [
      { day: 1, channel: 'whatsapp' },
      { day: 3, channel: 'whatsapp' },
      { day: 5, channel: 'whatsapp' },
    ],
    type: 'standard',
  },
  {
    id: 'phone-research',
    name: 'Pesquisa + Ligação',
    description: 'Pesquisa no dia 1, ligação nos dias 2 e 4. Para ABM.',
    icon: Phone,
    color: 'text-violet-500 bg-violet-500/10',
    steps: [
      { day: 1, channel: 'research' },
      { day: 2, channel: 'phone' },
      { day: 4, channel: 'phone' },
    ],
    type: 'standard',
  },
  {
    id: 'linkedin-nurture',
    name: 'LinkedIn + Email',
    description: 'LinkedIn no dia 1, emails de follow-up nos dias 3, 5 e 8.',
    icon: Linkedin,
    color: 'text-sky-500 bg-sky-500/10',
    steps: [
      { day: 1, channel: 'linkedin' },
      { day: 3, channel: 'email' },
      { day: 5, channel: 'email' },
      { day: 8, channel: 'email' },
    ],
    type: 'standard',
  },
] as const;

const CHANNEL_ICONS: Record<string, string> = {
  email: '📧',
  whatsapp: '💬',
  phone: '📞',
  linkedin: '💼',
  research: '🔍',
};

export function CadenceTemplateGallery() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Escolha um modelo ou comece do zero</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Selecione um template para pré-configurar os passos da cadência.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => router.push(`/cadences/new?type=${t.type}&template=${t.id}`)}
              className="group flex flex-col items-start rounded-lg border border-[var(--border)] p-5 text-left transition-all hover:border-[var(--primary)] hover:shadow-sm"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${t.color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-sm font-semibold">{t.name}</h3>
              <p className="mt-1 text-xs text-[var(--muted-foreground)] leading-relaxed">{t.description}</p>
              <div className="mt-3 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                {t.steps.map((s, i) => (
                  <span key={i} title={`Dia ${s.day}: ${s.channel}`}>
                    {CHANNEL_ICONS[s.channel]}
                  </span>
                ))}
                <span className="ml-1">{t.steps.length} passos</span>
              </div>
              <span className="mt-auto pt-3 text-xs font-medium text-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                Usar template <ArrowRight className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Start from scratch */}
      <div className="flex items-center gap-4 pt-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs text-[var(--muted-foreground)]">ou</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="outline" onClick={() => router.push('/cadences/new?type=standard')}>
          <FileText className="mr-2 h-4 w-4" />
          Cadência multicanal do zero
        </Button>
        <Button variant="outline" onClick={() => router.push('/cadences/new?type=auto_email')}>
          <Mail className="mr-2 h-4 w-4" />
          Auto-email do zero
        </Button>
      </div>
    </div>
  );
}
