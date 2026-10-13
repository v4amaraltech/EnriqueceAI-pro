import { notFound } from 'next/navigation';

import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';

import { fetchTemplate } from '@/features/templates/actions/fetch-templates';
import { TemplateEditor } from '@/features/templates/components/TemplateEditor';
import { canEditTemplate } from '@/features/templates/template-permissions';

interface TemplateEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { userId, role } = await requireAuthWithMember();
  const { id } = await params;

  const result = await fetchTemplate(id);

  if (!result.success) {
    notFound();
  }

  return (
    <TemplateEditor
      template={result.data}
      readOnly={!canEditTemplate(result.data, userId, role)}
    />
  );
}
