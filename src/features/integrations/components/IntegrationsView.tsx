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

import type { Api4ComConnectionSafe, CalendarConnectionSafe, CrmConnectionSafe, GmailConnectionSafe, ThreeCPlusConnectionSafe, WhatsAppConnectionSafe, WhatsAppEvolutionInstanceSafe } from '../types';
import { disconnectGmail, getGmailAuthUrl } from '../actions/manage-gmail';
import { disconnectApi4Com } from '../actions/manage-api4com';
import { disconnectThreeCPlus } from '../actions/manage-threecplus';
import { disconnectEvolutionWhatsApp } from '../actions/manage-whatsapp';
import { useEvolutionWhatsApp } from '../hooks/useEvolutionWhatsApp';
import { Api4ComConfigModal } from './Api4ComConfigModal';
import { ThreeCPlusConfigModal } from './ThreeCPlusConfigModal';
import { SignatureEditor } from './SignatureEditor';
import { WhatsAppEvolutionModal } from './WhatsAppEvolutionModal';

interface IntegrationsViewProps {
  gmail: GmailConnectionSafe | null;
  whatsapp: WhatsAppConnectionSafe | null;
  crm: CrmConnectionSafe | null;
  calendar: CalendarConnectionSafe | null;
  api4com: Api4ComConnectionSafe | null;
  threecplus: ThreeCPlusConnectionSafe | null;
  evolutionInstance: WhatsAppEvolutionInstanceSafe | null;
}

const statusConfig = {
  connected: { label: 'Conectado', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  disconnected: { label: 'Desconectado', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  error: { label: 'Erro', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  syncing: { label: 'Sincronizando', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
} as const;

export function IntegrationsView({ gmail, whatsapp, crm: _crm, calendar, api4com, threecplus, evolutionInstance }: IntegrationsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDisconnect, setShowDisconnect] = useState<'google' | 'whatsapp' | null>(null);
  const [showEvolutionModal, setShowEvolutionModal] = useState(false);
  const [showApi4ComConfig, setShowApi4ComConfig] = useState(false);
  const [showDisconnectApi4Com, setShowDisconnectApi4Com] = useState(false);
  const [showThreeCPlusConfig, setShowThreeCPlusConfig] = useState(false);
  const [showDisconnectThreeCPlus, setShowDisconnectThreeCPlus] = useState(false);
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
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

        {/* 3CPlus VoIP Card */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <Image src="/logos/3cplus-logo.png" alt="3CPlus" width={48} height={48} className="rounded-lg" />
            <CardTitle className="mt-4 text-xl">3CPlus</CardTitle>
            <div className="min-h-[3.5rem] flex-1">
              {threecplus ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Extensão {threecplus.extension} &middot; Conectado em {new Date(threecplus.created_at).toLocaleDateString('pt-BR')}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Discador VoIP 3CPlus integrado. Realize chamadas click-to-call diretamente da plataforma.
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-[var(--border)] pt-4">
              {threecplus ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusConfig[threecplus.status].className}>
                      {threecplus.status === 'connected' && <Check className="mr-1 h-3 w-3" />}
                      {threecplus.status === 'error' && <X className="mr-1 h-3 w-3" />}
                      {statusConfig[threecplus.status].label}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => setShowThreeCPlusConfig(true)}>
                      Gerenciar
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnectThreeCPlus(true)}
                  >
                    <Unplug className="mr-1 h-3 w-3" />
                    Desconectar
                  </button>
                </div>
              ) : (
                <Button onClick={() => setShowThreeCPlusConfig(true)}>
                  Conectar 3CPlus
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Google Card (Gmail + Calendar) */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <Image src="/logos/google-logo.png" alt="Google" width={48} height={48} className="rounded-lg" />
            <CardTitle className="mt-4 text-xl">Google</CardTitle>
            <div className="min-h-[3.5rem] flex-1">
              {gmail || calendar ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {gmail?.email_address ?? calendar?.calendar_email} &middot; Conectado em {new Date((gmail?.created_at ?? calendar?.created_at)!).toLocaleDateString('pt-BR')}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Integre com sua conta Google para sincronizar e gerenciar seus compromissos na plataforma.
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

        {/* CRM Card — hidden until CRM integrations are configured */}
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

      {/* 3CPlus config modal */}
      <ThreeCPlusConfigModal
        open={showThreeCPlusConfig}
        onOpenChange={setShowThreeCPlusConfig}
        onSuccess={() => router.refresh()}
        defaultExtension={threecplus?.extension ?? ''}
        defaultBaseUrl={threecplus?.base_url ?? ''}
        hasExistingApiToken={threecplus?.has_api_token ?? false}
      />

      {/* Disconnect 3CPlus dialog */}
      <Dialog open={showDisconnectThreeCPlus} onOpenChange={setShowDisconnectThreeCPlus}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar 3CPlus</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja desconectar a 3CPlus? As configurações de extensão e token serão removidas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnectThreeCPlus(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await disconnectThreeCPlus();
                  if (result.success) {
                    toast.success('3CPlus desconectado');
                  } else {
                    toast.error(result.error);
                  }
                  setShowDisconnectThreeCPlus(false);
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
