'use client';

import { useActionState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { updateOrganization } from '../actions/update-organization';
import { uploadOrgLogo, removeOrgLogo } from '../actions/upload-org-logo';
import type { OrganizationRow } from '../types';

type FormState = { error?: string; success?: boolean };

export function OrganizationSettings({ organization }: { organization: OrganizationRow }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUploadTransition] = useTransition();

  const [state, formAction, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await updateOrganization(formData);
      if (result.success) {
        return { success: true };
      }
      return { error: result.error };
    },
    {} as FormState,
  );

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    startUploadTransition(async () => {
      const result = await uploadOrgLogo(formData);
      if (result.success) {
        toast.success('Logo atualizado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
  }

  function handleRemoveLogo() {
    startUploadTransition(async () => {
      const result = await removeOrgLogo();
      if (result.success) {
        toast.success('Logo removido');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Configurações da Organização</h2>
        <p className="text-sm text-muted-foreground">Gerencie as informações da sua organização</p>
      </div>

      {state.success && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          Organização atualizada com sucesso.
        </div>
      )}

      {/* Logo upload */}
      <div className="space-y-2">
        <Label>Logo da organização</Label>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--muted)]">
            {organization.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={organization.logo_url}
                alt={organization.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Building2 className="h-6 w-6 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {isUploading ? 'Enviando...' : 'Alterar logo'}
            </Button>
            {organization.logo_url && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                onClick={handleRemoveLogo}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Remover
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleLogoSelect}
          />
        </div>
        <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP. Máximo 2MB.</p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome da organização</Label>
          <Input
            id="name"
            name="name"
            defaultValue={organization.name}
            placeholder="Nome da organização"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">Slug</Label>
          <Input id="slug" value={organization.slug} disabled />
          <p className="text-xs text-muted-foreground">O slug não pode ser alterado</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="created_at">Criada em</Label>
          <Input
            id="created_at"
            value={new Date(organization.created_at).toLocaleDateString('pt-BR')}
            disabled
          />
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando...' : 'Salvar alterações'}
        </Button>
      </form>
    </div>
  );
}
