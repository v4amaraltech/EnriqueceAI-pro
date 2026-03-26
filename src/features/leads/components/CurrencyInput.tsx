'use client';

import { useCallback } from 'react';

import { Input } from '@/shared/components/ui/input';

const valueFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a raw numeric string (cents stored as string) to "123.000,00" */
export function formatBRL(raw: string | undefined | null): string {
  if (!raw) return '—';
  const cents = parseInt(raw, 10);
  if (Number.isNaN(cents)) return raw;
  return valueFormatter.format(cents / 100);
}

interface CurrencyInputProps {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  className?: string;
}

export function CurrencyInput({ value, onChange, placeholder, className }: CurrencyInputProps) {
  const displayValue = value
    ? valueFormatter.format(parseInt(value, 10) / 100)
    : '';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = e.target.value.replace(/\D/g, '');
      onChange(digits || '');
    },
    [onChange],
  );

  return (
    <Input
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder ?? '0,00'}
      className={className}
      inputMode="numeric"
    />
  );
}
