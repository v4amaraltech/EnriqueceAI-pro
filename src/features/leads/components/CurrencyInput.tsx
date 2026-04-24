'use client';

import { useCallback } from 'react';

import { Input } from '@/shared/components/ui/input';

const valueFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a raw value (cents as string OR reais as number) to "123.000,00" */
export function formatBRL(raw: string | number | undefined | null): string {
  if (raw == null || raw === '') return '—';
  // If it's a number (reais from API) — display directly
  if (typeof raw === 'number') {
    return valueFormatter.format(raw);
  }
  // If string contains a dot (reais like "1094.4") — display directly
  if (raw.includes('.')) {
    const reais = parseFloat(raw);
    if (!Number.isNaN(reais)) return valueFormatter.format(reais);
  }
  // Otherwise treat as centavos string (from UI input)
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
