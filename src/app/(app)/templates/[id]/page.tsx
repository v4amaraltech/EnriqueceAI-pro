import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import { fetchGmailSignature } from '@/features/activities/actions/fetch-gmail-signature';
import { fetchTemplate } from '@/features/templates/actions/fetch-templates';
import { TemplateEditor } from '@/features/templates/components/TemplateEditor';

interface TemplateEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  await requireAuth();
  const { id } = await params;

  const [result, sigResult] = await Promise.all([
    fetchTemplate(id),
    fetchGmailSignature(),
  ]);

  if (!result.success) {
    notFound();
  }

  const signature = sigResult.success ? sigResult.data : '';

  return <TemplateEditor template={result.data} signature={signature} />;
}
