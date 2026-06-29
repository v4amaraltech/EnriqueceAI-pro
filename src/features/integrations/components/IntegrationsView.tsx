'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  Check,
  FileSignature,
  Key,
  Phone,
  RefreshCw,
  Settings2,
  Unplug,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
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
import type { Api4ComConnectionSafe, ApolloConnectionSafe, CalendarConnectionSafe, CrmConnectionSafe, CrmProvider, GmailConnectionSafe, WhatsAppConnectionSafe, WhatsAppEvolutionInstanceSafe } from '../types';
import { disconnectGmail, getGmailAuthUrl } from '../actions/manage-gmail';
import { getCrmAuthUrl, disconnectCrm, triggerCrmSync } from '../actions/manage-crm';
import { disconnectApi4Com } from '../actions/manage-api4com';
import { testGmailConnection, testApi4ComConnection } from '../actions/test-connections';
import { deleteApolloConnection } from '../actions/manage-apollo';
import { disconnectEvolutionWhatsApp } from '../actions/manage-whatsapp';
import { useEvolutionWhatsApp } from '../hooks/useEvolutionWhatsApp';
import { WebhookEndpointsManager } from '@/features/cadences/components/WebhookEndpointsManager';

import { Api4ComConfigModal } from './Api4ComConfigModal';
import { ApolloConfigModal } from './ApolloConfigModal';
import { CrmFieldMappingModal } from './CrmFieldMappingModal';
import { RdStationTokenModal } from './RdStationTokenModal';
import { SignatureEditor } from './SignatureEditor';
import { WhatsAppEvolutionModal } from './WhatsAppEvolutionModal';

interface IntegrationsViewProps {
  gmail: GmailConnectionSafe | null;
  whatsapp: WhatsAppConnectionSafe | null;
  crmConnections: CrmConnectionSafe[];
  calendar: CalendarConnectionSafe | null;
  api4com: Api4ComConnectionSafe | null;
  evolutionInstance: WhatsAppEvolutionInstanceSafe | null;
  apollo: ApolloConnectionSafe | null;
  planFeatures: PlanFeatures;
  isManager: boolean;
}

const CRM_PROVIDERS = [
  // HubSpot, Pipedrive e RD Station ocultados do frontend a pedido — backend,
  // tipos (CrmProvider) e actions permanecem intactos para reativação futura.
  { id: 'kommo' as const, name: 'KommoCRM', logo: '/logos/kommo-icon.png', description: 'Sincronize leads e negócios com o KommoCRM.' },
] as const;

const statusConfig = {
  connected: { label: 'Conectado', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  disconnected: { label: 'Desconectado', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  error: { label: 'Erro', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  syncing: { label: 'Sincronizando', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
} as const;

function StatusBadge({ status }: { status: keyof typeof statusConfig }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      {status === 'connected' && <Check className="mr-1 h-3 w-3" />}
      {status === 'error' && <X className="mr-1 h-3 w-3" />}
      {status === 'syncing' && <RefreshCw className="mr-1 h-3 w-3 animate-spin" />}
      {config.label}
    </Badge>
  );
}

export function IntegrationsView({ gmail, whatsapp, crmConnections, calendar, api4com, evolutionInstance, apollo, planFeatures, isManager }: IntegrationsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [showDisconnect, setShowDisconnect] = useState<'google' | 'whatsapp' | 'apollo' | CrmProvider | null>(null);

  // Show toast for OAuth callback results
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    if (success) {
      toast.success('Integração conectada com sucesso!');
      router.replace('/settings/integrations');
    } else if (error) {
      toast.error(`Erro na conexão: ${decodeURIComponent(error)}`);
      router.replace('/settings/integrations');
    }
  }, [searchParams, router]);
  const [showEvolutionModal, setShowEvolutionModal] = useState(false);
  const [showApi4ComConfig, setShowApi4ComConfig] = useState(false);
  const [showDisconnectApi4Com, setShowDisconnectApi4Com] = useState(false);
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const [showApolloConfig, setShowApolloConfig] = useState(false);
  const [showRdStationConfig, setShowRdStationConfig] = useState(false);
  const [fieldMappingProvider, setFieldMappingProvider] = useState<CrmProvider | null>(null);
  const [crmPending, startCrmTransition] = useTransition();
  const [activeCrmAction, setActiveCrmAction] = useState<CrmProvider | null>(null);
  const evolution = useEvolutionWhatsApp();

  function findCrm(provider: CrmProvider): CrmConnectionSafe | undefined {
    return crmConnections.find(c => c.crm_provider === provider);
  }

  function handleConnectCrm(provider: CrmProvider) {
    if (provider === 'rdstation') {
      setShowRdStationConfig(true);
      return;
    }

    setActiveCrmAction(provider);
    startCrmTransition(async () => {
      const result = await getCrmAuthUrl(provider);
      if (result.success) {
        window.location.href = result.data.url;
      } else {
        toast.error(result.error);
        setActiveCrmAction(null);
      }
    });
  }

  function handleDisconnectCrm(provider: CrmProvider) {
    setActiveCrmAction(provider);
    startCrmTransition(async () => {
      const result = await disconnectCrm(provider);
      if (result.success) {
        toast.success(`${CRM_PROVIDERS.find(p => p.id === provider)?.name ?? 'CRM'} desconectado`);
      } else {
        toast.error(result.error);
      }
      setActiveCrmAction(null);
      setShowDisconnect(null);
      router.refresh();
    });
  }

  function handleSyncCrm(provider: CrmProvider) {
    setActiveCrmAction(provider);
    startCrmTransition(async () => {
      const result = await triggerCrmSync(provider);
      if (result.success) {
        toast.success('Sincronização iniciada');
      } else {
        toast.error(result.error);
      }
      setActiveCrmAction(null);
      router.refresh();
    });
  }

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

  const whatsappConnected = evolution.step === 'connected' || evolutionInstance?.status === 'connected';
  const googleConnected = !!(gmail || calendar);
  const googleError = gmail?.status === 'error' || calendar?.status === 'error';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrações</h1>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Conecte suas contas para enviar mensagens e sincronizar dados automaticamente.
        </p>
      </div>

      {/* Comunicação */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Comunicação</h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {/* WhatsApp */}
          <div className="group flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--muted)]/30">
            <div className="w-10 shrink-0">
              <Image src="/logos/whatsapp-logo.png" alt="WhatsApp" width={32} height={32} className="rounded-lg" />
            </div>
            <div className="w-32 shrink-0 font-medium">WhatsApp</div>
            <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {whatsappConnected
                ? (evolution.phone || evolutionInstance?.phone)
                  ? `Conectado: ${evolution.phone || evolutionInstance?.phone}`
                  : 'WhatsApp conectado'
                : 'Integre o WhatsApp para enviar mensagens pela plataforma'}
            </div>
            {(whatsappConnected || whatsapp?.status === 'connected') && (
              <StatusBadge status="connected" />
            )}
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {whatsappConnected ? (
                <>
                  {/* Reconectar: dispara o mesmo connect(), que no Evolution varre
                      TODAS as instâncias do usuário (inclui sessões órfãs) e recria
                      uma limpa com QR novo — resolve "Connection Closed" sem o
                      vai-e-volta de Desconectar→Conectar. */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowEvolutionModal(true);
                      evolution.connect();
                    }}
                    disabled={evolution.step === 'creating' || evolution.step === 'waiting_scan'}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Reconectar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnect('whatsapp')}
                  >
                    <Unplug className="mr-1.5 h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                </>
              ) : whatsapp?.status === 'connected' ? null : (
                <Button
                  size="sm"
                  onClick={() => {
                    setShowEvolutionModal(true);
                    evolution.connect();
                  }}
                  disabled={evolution.step === 'creating' || evolution.step === 'waiting_scan'}
                >
                  Conectar
                </Button>
              )}
            </div>
          </div>

          {/* API4Com */}
          <div className="group flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--muted)]/30">
            <div className="w-10 shrink-0">
              <Image src="/logos/api4com-logo.png" alt="API4Com" width={32} height={32} className="rounded-lg" />
            </div>
            <div className="w-32 shrink-0 font-medium">API4Com</div>
            <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {api4com
                ? `Ramal ${api4com.ramal} \u00b7 Conectado em ${new Date(api4com.created_at).toLocaleDateString('pt-BR')}`
                : 'Integração automática com sistema de ligações'}
            </div>
            {api4com && <StatusBadge status={api4com.status} />}
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {api4com ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      startTransition(async () => {
                        const r = await testApi4ComConnection();
                        if (r.success && r.data.ok) toast.success(`API4Com conectado (ramal ${r.data.ramal})`);
                        else toast.error('Conexão com API4Com falhou — verifique o token');
                      });
                    }}
                    disabled={isPending}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Testar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => setShowApi4ComConfig(true)}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Gerenciar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnectApi4Com(true)}
                  >
                    <Unplug className="mr-1.5 h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setShowApi4ComConfig(true)}>
                  Conectar
                </Button>
              )}
            </div>
          </div>

          {/* Ligação via WhatsApp (discador WhatsApp-nativo, Epic 7) */}
          {isManager && (
            <div className="group flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--muted)]/30">
              <div className="flex w-10 shrink-0 justify-center">
                <Phone className="h-7 w-7 text-emerald-600" />
              </div>
              <div className="w-32 shrink-0 font-medium">Ligação via WhatsApp</div>
              <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Discador WhatsApp-nativo — pareie um número dedicado por SDR
              </div>
              <div className="ml-auto shrink-0 flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/whatsapp-numbers">
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Gerenciar números
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Google */}
          <div className="group flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--muted)]/30">
            <div className="w-10 shrink-0">
              <Image src="/logos/google-logo.png" alt="Google" width={32} height={32} className="rounded-lg" />
            </div>
            <div className="w-32 shrink-0 flex items-center gap-2">
              <span className="font-medium">Google</span>
              {!checkFeature(planFeatures, 'calendar') && (
                <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 text-[10px] px-1.5">
                  Cal: Pro
                </Badge>
              )}
            </div>
            <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {googleConnected
                ? `${gmail?.email_address ?? calendar?.calendar_email} \u00b7 Conectado em ${new Date((gmail?.created_at ?? calendar?.created_at)!).toLocaleDateString('pt-BR')}`
                : checkFeature(planFeatures, 'calendar')
                  ? 'Sincronize e-mails e compromissos com sua conta Google'
                  : 'Integre com sua conta Google para enviar e-mails'}
            </div>
            {googleConnected && <StatusBadge status={googleError ? 'error' : 'connected'} />}
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {googleConnected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      startTransition(async () => {
                        const r = await testGmailConnection();
                        if (r.success && r.data.ok) toast.success(`Gmail conectado (${r.data.email})`);
                        else toast.error('Conexão com Gmail falhou — reconecte');
                      });
                    }}
                    disabled={isPending}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Testar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => setShowSignatureEditor(true)}
                  >
                    <FileSignature className="mr-1.5 h-3.5 w-3.5" />
                    Assinatura
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnect('google')}
                  >
                    <Unplug className="mr-1.5 h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={handleConnectGoogle} disabled={isPending}>
                  {isPending ? 'Conectando...' : 'Conectar'}
                </Button>
              )}
            </div>
          </div>

          {/* Apollo */}
          <div className="group flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted)]/30">
            <div className="w-10 shrink-0">
              <Image src="/logos/apollo-logo.webp" alt="Apollo.io" width={32} height={32} className="rounded-lg" />
            </div>
            <div className="w-32 shrink-0 font-medium">Apollo.io</div>
            <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {apollo
                ? `Conectado em ${new Date(apollo.created_at).toLocaleDateString('pt-BR')}`
                : 'Busque e importe leads qualificados do Apollo.io'}
            </div>
            {apollo && <StatusBadge status={apollo.status} />}
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {apollo ? (
                isManager ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-600"
                    onClick={() => setShowDisconnect('apollo')}
                  >
                    <Unplug className="mr-1.5 h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    Conectado pela organização
                  </span>
                )
              ) : isManager ? (
                <Button size="sm" onClick={() => setShowApolloConfig(true)}>
                  Conectar
                </Button>
              ) : (
                <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Apenas o gestor pode conectar
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CRM */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">CRM</h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {CRM_PROVIDERS.map((provider, index) => {
            const connection = findCrm(provider.id);
            const isLast = index === CRM_PROVIDERS.length - 1;
            return (
              <div
                key={provider.id}
                className={`group flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted)]/30 ${!isLast ? 'border-b border-[var(--border)]' : ''}`}
              >
                <div className="w-10 shrink-0">
                  <Image src={provider.logo} alt={provider.name} width={32} height={32} className="rounded-lg" />
                </div>
                <div className="w-32 shrink-0 font-medium">{provider.name}</div>
                <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  {connection ? (
                    <>
                      Conectado em {new Date(connection.created_at).toLocaleDateString('pt-BR')}
                      {connection.last_sync_at && (
                        <> &middot; Último sync: {new Date(connection.last_sync_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </>
                  ) : (
                    provider.description
                  )}
                </div>
                {connection && <StatusBadge status={connection.status} />}
                <div className="ml-auto shrink-0 flex items-center gap-2">
                  {connection ? (
                    isManager && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100"
                          disabled={activeCrmAction === provider.id || connection.status === 'syncing'}
                          onClick={() => handleSyncCrm(provider.id)}
                        >
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                          Sincronizar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() => setFieldMappingProvider(provider.id)}
                        >
                          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                          Campos
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-600"
                          onClick={() => setShowDisconnect(provider.id)}
                        >
                          <Unplug className="mr-1.5 h-3.5 w-3.5" />
                          Desconectar
                        </Button>
                      </>
                    )
                  ) : isManager ? (
                    <Button
                      size="sm"
                      onClick={() => handleConnectCrm(provider.id)}
                      disabled={activeCrmAction === provider.id}
                    >
                      {activeCrmAction === provider.id ? 'Conectando...' : 'Conectar'}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
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
        defaultSipDomain={api4com?.sip_domain ?? api4com?.org_sip_domain ?? ''}
        hasExistingSipPassword={api4com?.has_sip_password ?? false}
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

      {/* CRM Field Mapping modal */}
      {fieldMappingProvider && (
        <CrmFieldMappingModal
          open={!!fieldMappingProvider}
          onOpenChange={(isOpen) => { if (!isOpen) setFieldMappingProvider(null); }}
          provider={fieldMappingProvider}
          currentMapping={findCrm(fieldMappingProvider)?.field_mapping ?? null}
          onSaved={() => router.refresh()}
        />
      )}

      {/* RD Station CRM token modal */}
      <RdStationTokenModal
        open={showRdStationConfig}
        onOpenChange={setShowRdStationConfig}
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

      {/* Disconnect CRM dialogs */}
      {CRM_PROVIDERS.map((provider) => (
        <Dialog key={provider.id} open={showDisconnect === provider.id} onOpenChange={() => setShowDisconnect(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Desconectar {provider.name}</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja desconectar o {provider.name}? A sincronização de leads e atividades será interrompida.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDisconnect(null)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={crmPending}
                onClick={() => handleDisconnectCrm(provider.id)}
              >
                {crmPending ? 'Desconectando...' : 'Desconectar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}

      {/* API & Webhooks */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">API & Webhooks</h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {/* API Enriquece AI */}
          <div className="group flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--muted)]/30">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]">
              <Key className="h-5 w-5 text-[var(--muted-foreground)]" />
            </div>
            <div className="w-32 shrink-0 font-medium">API Enriquece AI</div>
            <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Receba leads de plataformas externas via API REST e webhooks
            </div>
            <div className="ml-auto shrink-0">
              <Link href="/settings/integrations/api">
                <Button size="sm" variant="outline">
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                  Configurar
                </Button>
              </Link>
            </div>
          </div>
          {/* Webhooks */}
          <WebhookEndpointsManager />
        </div>
      </div>

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
