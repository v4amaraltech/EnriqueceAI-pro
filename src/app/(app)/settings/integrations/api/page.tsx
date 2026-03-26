import { requireManager } from '@/lib/auth/require-manager';
import { listApiKeysAction } from '@/features/inbound-api/actions/manage-api-keys';
import { ApiKeyManager } from '@/features/inbound-api/components/ApiKeyManager';

export default async function ApiKeysPage() {
  await requireManager();

  const result = await listApiKeysAction();
  const keys = result.success ? result.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API de Inbound Leads</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Receba leads automaticamente de plataformas externas como RD Station, landing pages, Zapier, Make e outros.
        </p>
      </div>
      <ApiKeyManager initialKeys={keys} />
    </div>
  );
}
