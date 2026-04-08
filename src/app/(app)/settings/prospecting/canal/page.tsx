import { AlertTriangle } from 'lucide-react';

import { requireManager } from '@/lib/auth/require-manager';
import { EmptyState } from '@/shared/components/EmptyState';

import { listCanalOptions } from '@/features/settings-prospecting/actions/canal-crud';
import { CanalSettings } from '@/features/settings-prospecting/components/CanalSettings';

export default async function CanalSettingsPage() {
  await requireManager();

  const result = await listCanalOptions();

  if (!result.success) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Erro ao carregar canais"
        description={result.error}
      />
    );
  }

  return <CanalSettings initial={result.data} />;
}
