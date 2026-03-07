'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  Check,
  FileSignature,
  Unplug,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import type { PlanFeatures } from '@/features/billing/types';
import { checkFeature } from '@/features/billing/services/feature-flags';
import type { Api4ComConnectionSafe, ApolloConnectionSafe, CalendarConnectionSafe, CrmConnectionSafe, GmailConnectionSafe, WhatsAppConnectionSafe, WhatsAppEvolutionInstanceSafe } from '../types';
import { disconnectGmail, getGmailAuthUrl } from '../actions/manage-gmail';
import { disconnectApi4Com } from '../actions/manage-api4com';
import { deleteApolloConnection } from '../actions/manage-apollo';
import { disconnectEvolutionWhatsApp } from '../actions/manage-whatsapp';
import { useEvolutionWhatsApp } from '../hooks/useEvolutionWhatsApp';
import { WebhookEndpointsManager } from '@/features/cadences/components/WebhookEndpointsManager';

import { Api4ComConfigModal } from './Api4ComConfigModal';
import { ApolloConfigModal } from './ApolloConfigModal';
import { SignatureEditor } from './SignatureEditor';
import { WhatsAppEvolutionModal } from './WhatsAppEvolutionModal';

interface IntegrationsViewProps {
  gmail: GmailConnectionSafe | null;
  whatsapp: WhatsAppConnectionSafe | null;
  crm: CrmConnectionSafe | null;
  calendar: CalendarConnectionSafe | null;
  api4com: Api4ComConnectionSafe | null;
  evolutionInstance: WhatsAppEvolutionInstanceSafe | null;
  apollo: ApolloConnectionSafe | null;
  planFeatures: PlanFeatures;
}

const statusConfig = {
  connected: { label: 'Conectado', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  disconnected: { label: 'Desconectado', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  error: { label: 'Erro', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  syncing: { label: 'Sincronizando', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
} as const;

export function IntegrationsView({ gmail, whatsapp, crm: _crm, calendar, api4com, evolutionInstance, apollo, planFeatures }: IntegrationsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDisconnect, setShowDisconnect] = useState<'google' | 'whatsapp' | 'apollo' | null>(null);
  const [showEvolutionModal, setShowEvolutionModal] = useState(false);
  const [showApi4ComConfig, setShowApi4ComConfig] = useState(false);
  const [showDisconnectApi4Com, setShowDisconnectApi4Com] = useState(false);
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const [showApolloConfig, setShowApolloConfig] = useState(false);
  const evolution = useEvolutionWhatsApp();

  function handleConnectGoogle() {
    startTransition(async () => {
      const result = await getGmailAuthUrl();
      if (result.success) {
        window.location.href = result.data.url;
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDisconnectGoogle() {
    startTransition(async () => {
      const result = await disconnectGmail();
      if (result.success) {
        toast.success('Google desconectado');
      } else {
        toast.error('Erro ao desconectar conta Google');
      }
      setShowDisconnect(null);
      router.refresh();
    });
  }



  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrações</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Conecte suas contas para enviar mensagens e sincronizar dados automaticamente.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* WhatsApp Card */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <Image src="/logos/whatsapp-logo.png" alt="WhatsApp" width={48} height={48} className="rounded-lg" />
            <CardTitle className="mt-4 text-xl">WhatsApp</CardTitle>
            <div className="min-h-[3.5rem] flex-1">
              {(evolution.step === 'connected' || evolutionInstance?.status === 'connected') ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {(evolution.phone || evolutionInstance?.phone)
                    ? `Conectado: ${evolution.phone || evolutionInstance?.phone}`
                    : 'WhatsApp conectado'}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Integre o WhatsApp para acessar e explorar suas conversas diretamente pela plataforma.
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-[var(--border)] pt-4">
              {(evolution.step === 'connected' || evolutionInstance?.status === 'connected') ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusConfig.connected.className}>
                      <Check className="mr-1 h-3 w-3" />Conectado
                    </Badge>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnect('whatsapp')}
                  >
                    <Unplug className="mr-1 h-3 w-3" />
                    Desconectar
                  </button>
                </div>
              ) : whatsapp?.status === 'connected' ? (
                <Badge variant="outline" className={statusConfig.connected.className}>
                  <Check className="mr-1 h-3 w-3" />Conectado
                </Badge>
              ) : (
                <Button
                  onClick={() => {
                    setShowEvolutionModal(true);
                    evolution.connect();
                  }}
                  disabled={evolution.step === 'creating' || evolution.step === 'waiting_scan'}
                >
                  Conectar WhatsApp
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* API4Com VoIP Card */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <Image src="/logos/api4com-logo.png" alt="API4Com" width={48} height={48} className="rounded-lg" />
            <CardTitle className="mt-4 text-xl">API4Com</CardTitle>
            <div className="min-h-[3.5rem] flex-1">
              {api4com ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Ramal {api4com.ramal} &middot; Conectado em {new Date(api4com.created_at).toLocaleDateString('pt-BR')}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Integração automática com sistema de ligações da API4Com.
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-[var(--border)] pt-4">
              {api4com ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusConfig[api4com.status].className}>
                      {api4com.status === 'connected' && <Check className="mr-1 h-3 w-3" />}
                      {api4com.status === 'error' && <X className="mr-1 h-3 w-3" />}
                      {statusConfig[api4com.status].label}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => setShowApi4ComConfig(true)}>
                      Gerenciar
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnectApi4Com(true)}
                  >
                    <Unplug className="mr-1 h-3 w-3" />
                    Desconectar
                  </button>
                </div>
              ) : (
                <Button onClick={() => setShowApi4ComConfig(true)}>
                  Conectar API4Com
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Google Card (Gmail + Calendar) */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <Image src="/logos/google-logo.png" alt="Google" width={48} height={48} className="rounded-lg" />
            <div className="mt-4 flex items-center gap-2">
              <CardTitle className="text-xl">Google</CardTitle>
              {!checkFeature(planFeatures, 'calendar') && (
                <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                  Calendar: Pro
                </Badge>
              )}
            </div>
            <div className="min-h-[3.5rem] flex-1">
              {gmail || calendar ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {gmail?.email_address ?? calendar?.calendar_email} &middot; Conectado em {new Date((gmail?.created_at ?? calendar?.created_at)!).toLocaleDateString('pt-BR')}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {checkFeature(planFeatures, 'calendar')
                    ? 'Integre com sua conta Google para sincronizar e gerenciar seus compromissos na plataforma.'
                    : 'Integre com sua conta Google para enviar e-mails. Sincronização de Calendar disponível no plano Pro.'}
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-[var(--border)] pt-4">
              {gmail || calendar ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusConfig[(gmail?.status === 'error' || calendar?.status === 'error') ? 'error' : 'connected'].className}>
                      {(gmail?.status === 'error' || calendar?.status === 'error')
                        ? <><X className="mr-1 h-3 w-3" />Erro</>
                        : <><Check className="mr-1 h-3 w-3" />Conectado</>}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => setShowSignatureEditor(true)}>
                      <FileSignature className="mr-1.5 h-3.5 w-3.5" />
                      Assinatura
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnect('google')}
                  >
                    <Unplug className="mr-1 h-3 w-3" />
                    Desconectar
                  </button>
                </div>
              ) : (
                <Button onClick={handleConnectGoogle} disabled={isPending}>
                  {isPending ? 'Conectando...' : 'Conectar Google'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Apollo Card */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--muted)]">
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-[var(--foreground)]" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <CardTitle className="mt-4 text-xl">Apollo.io</CardTitle>
            <div className="min-h-[3.5rem] flex-1">
              {apollo ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Conectado em {new Date(apollo.created_at).toLocaleDateString('pt-BR')}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Conecte sua conta Apollo.io para buscar e importar leads qualificados.
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-[var(--border)] pt-4">
              {apollo ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusConfig[apollo.status].className}>
                      {apollo.status === 'connected' && <Check className="mr-1 h-3 w-3" />}
                      {apollo.status === 'error' && <X className="mr-1 h-3 w-3" />}
                      {statusConfig[apollo.status].label}
                    </Badge>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnect('apollo')}
                  >
                    <Unplug className="mr-1 h-3 w-3" />
                    Desconectar
                  </button>
                </div>
              ) : (
                <Button onClick={() => setShowApolloConfig(true)}>
                  Conectar Apollo
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Disconnect Google dialog */}
      <Dialog open={showDisconnect === 'google'} onOpenChange={() => setShowDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar Google</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja desconectar sua conta Google? Cadências com passos de email não poderão ser executadas e não será possível agendar reuniões pela plataforma.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnect(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={isPending} onClick={handleDisconnectGoogle}>
              {isPending ? 'Desconectando...' : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect WhatsApp dialog */}
      <Dialog open={showDisconnect === 'whatsapp'} onOpenChange={() => setShowDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar WhatsApp</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja desconectar o WhatsApp? Cadências com passos de WhatsApp não poderão ser executadas automaticamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnect(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await disconnectEvolutionWhatsApp();
                  if (result.success) {
                    evolution.disconnect();
                    toast.success('WhatsApp desconectado');
                  } else {
                    toast.error(result.error);
                  }
                  setShowDisconnect(null);
                  router.refresh();
                });
              }}
            >
              {isPending ? 'Desconectando...' : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API4Com config modal */}
      <Api4ComConfigModal
        open={showApi4ComConfig}
        onOpenChange={setShowApi4ComConfig}
        onSuccess={() => router.refresh()}
        defaultRamal={api4com?.ramal ?? ''}
        defaultBaseUrl={api4com?.base_url ?? ''}
        hasExistingApiKey={api4com?.has_api_key ?? false}
      />

      {/* Disconnect API4Com dialog */}
      <Dialog open={showDisconnectApi4Com} onOpenChange={setShowDisconnectApi4Com}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar API4Com</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja desconectar a API4Com? As configurações de ramal e token serão removidas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnectApi4Com(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await disconnectApi4Com();
                  if (result.success) {
                    toast.success('API4Com desconectado');
                  } else {
                    toast.error(result.error);
                  }
                  setShowDisconnectApi4Com(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? 'Desconectando...' : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature editor modal */}
      <SignatureEditor
        open={showSignatureEditor}
        onOpenChange={setShowSignatureEditor}
        currentSignature={gmail?.custom_signature ?? null}
        onSaved={() => router.refresh()}
      />

      {/* Apollo config modal */}
      <ApolloConfigModal
        open={showApolloConfig}
        onOpenChange={setShowApolloConfig}
        onSuccess={() => router.refresh()}
      />

      {/* Disconnect Apollo dialog */}
      <Dialog open={showDisconnect === 'apollo'} onOpenChange={() => setShowDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar Apollo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja desconectar o Apollo? A busca e importação de leads do Apollo ficarão indisponíveis.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnect(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteApolloConnection();
                  if (result.success) {
                    toast.success('Apollo desconectado');
                  } else {
                    toast.error(result.error);
                  }
                  setShowDisconnect(null);
                  router.refresh();
                });
              }}
            >
              {isPending ? 'Desconectando...' : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WebhookEndpointsManager />

      {/* WhatsApp Evolution QR Code modal */}
      {showEvolutionModal && evolution.step !== 'idle' && (
        <WhatsAppEvolutionModal
          qrBase64={evolution.qrBase64}
          step={evolution.step}
          phone={evolution.phone}
          error={evolution.error}
          onRefreshQr={evolution.refreshQr}
          onClose={() => {
            setShowEvolutionModal(false);
            if (evolution.step === 'connected') {
              router.refresh();
            }
          }}
        />
      )}

    </div>
  );
}
