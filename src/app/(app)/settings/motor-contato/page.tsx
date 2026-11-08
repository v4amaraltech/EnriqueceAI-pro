import {
  PAUSE_ORDER,
  type PilotFlagState,
  loadPilotStatus,
} from '@/features/contact-engine/services/pilot-status.service';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { Badge } from '@/shared/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { NumberHealthRecoveryButton } from '@/features/contact-engine/components/number-health-recovery-button';

export const dynamic = 'force-dynamic';

function flagLabel(f: PilotFlagState): string {
  if (!f.present) return 'Ausente';
  if (f.globalEnabled) return 'Ligada (global)';
  if (f.orgListed) return f.userRestricted ? 'Ligada (org, usuários restritos)' : 'Ligada (org)';
  return 'Desligada';
}

const GATEWAY_LABEL = {
  off: 'Desligado',
  shadow: 'Shadow (compara, não envia)',
  enforced: 'Obrigatório',
} as const;

export default async function ContactEnginePilotPage() {
  const { orgId } = await getManagerOrgId();
  const status = await loadPilotStatus(orgId);
  const order = new Map(PAUSE_ORDER.map((k, i) => [k as string, i]));
  const flags = [...status.flags].sort(
    (a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99),
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Motor de contato: piloto</h1>
        <p className="text-sm text-muted-foreground">
          Somente leitura. Nenhuma ação de envio, e nenhuma flag é alterada por aqui. Pausa e
          rollback seguem o runbook docs/runbooks/motor-contato-piloto.md.
        </p>
      </div>

      {status.unavailable.length > 0 && (
        <Card>
          <CardContent className="pt-6 text-sm">
            Leitura indisponível (não é zero): {status.unavailable.join(', ')}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Flags desta organização</CardTitle>
          <CardDescription>
            Gateway: {GATEWAY_LABEL[status.gatewayMode]}.{' '}
            {status.scopeColumnsAvailable
              ? ''
              : 'Colunas de escopo ainda não aplicadas: vale só o escopo global.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flag</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="font-mono text-xs">{f.key}</TableCell>
                  <TableCell>
                    <Badge variant={f.effectiveForOrg ? 'default' : 'secondary'}>
                      {flagLabel(f)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Eventos de decisão</CardTitle>
            <CardDescription>Últimos {status.counts.windowDays} dias</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {Object.entries(status.counts.decisionEvents).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="text-right">{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outbox por status</CardTitle>
            <CardDescription>
              Total da organização. Comparações do gateway em shadow ficam só nos logs estruturados
              (send_gateway_shadow), sem contagem no banco.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {Object.entries(status.counts.outbox).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="text-right">{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saúde dos números</CardTitle>
          <CardDescription>
            Estado e tetos por instância. Sem telefone nem mensagens. Botão Recuperar número disponível
            somente para gestores, com flag ligada, estado paused/review e WhatsApp reconectado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instância</TableHead>
                <TableHead>Conexão</TableHead>
                <TableHead>Saúde</TableHead>
                <TableHead>Teto total / novos</TableHead>
                <TableHead>Rampa</TableHead>
                <TableHead>Motivo da pausa</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.numbers.map((n) => (
                <TableRow key={n.instanceId}>
                  <TableCell>{n.instanceName}</TableCell>
                  <TableCell>{n.connection}</TableCell>
                  <TableCell>{n.healthState}</TableCell>
                  <TableCell>
                    {n.totalDailyCap} / {n.newContactsDailyCap}
                  </TableCell>
                  <TableCell>{n.rampStage}</TableCell>
                  <TableCell>{n.pauseReason ?? ''}</TableCell>
                  <TableCell>
                    <NumberHealthRecoveryButton
                      instanceId={n.instanceId}
                      instanceName={n.instanceName}
                      healthState={n.healthState as any}
                      pauseReason={n.pauseReason}
                      connectionStatus={n.connection}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
