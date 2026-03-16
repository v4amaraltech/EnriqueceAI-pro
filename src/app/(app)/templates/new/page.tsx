import { requireAuth } from '@/lib/auth/require-auth';

import { fetchGmailSignature } from '@/features/activities/actions/fetch-gmail-signature';
import { TemplateEditor } from '@/features/templates/components/TemplateEditor';

export default async function NewTemplatePage() {
  await requireAuth();

  const sigResult = await fetchGmailSignature();
  const signature = sigResult.success ? sigResult.data : '';

  return <TemplateEditor signature={signature} />;
}
