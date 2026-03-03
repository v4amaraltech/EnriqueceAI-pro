'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

export function StripeReturnToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const success = searchParams.get('success');
    const canceled = searchParams.get('canceled');

    if (success === 'true') {
      handled.current = true;
      toast.success('Assinatura atualizada com sucesso!');
      router.replace('/settings/billing');
    } else if (canceled === 'true') {
      handled.current = true;
      toast.info('Checkout cancelado. Nenhuma alteração foi feita.');
      router.replace('/settings/billing');
    }
  }, [searchParams, router]);

  return null;
}
