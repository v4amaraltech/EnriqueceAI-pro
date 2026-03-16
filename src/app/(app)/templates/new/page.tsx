import { requireAuth } from '@/lib/auth/require-auth';

import { TemplateEditor } from '@/features/templates/components/TemplateEditor';

export default async function NewTemplatePage() {
  await requireAuth();

  return <TemplateEditor />;
}
