import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import { fetchTemplate } from '@/features/templates/actions/fetch-templates';
import { TemplateEditor } from '@/features/templates/components/TemplateEditor';

interface TemplateEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  await requireAuth();
  const { id } = await params;

  const result = await fetchTemplate(id);

  if (!result.success) {
    notFound();
  }

  return <TemplateEditor template={result.data} />;
}
