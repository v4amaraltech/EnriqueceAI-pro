'use client';

import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { ThreeCPlusCampaign } from '@/features/integrations/types/threecplus';

interface ThreeCPlusCampaignSelectProps {
  campaigns: ThreeCPlusCampaign[];
  selectedCampaignId: number | null;
  onSelect: (campaignId: number) => void;
  disabled?: boolean;
}

export function ThreeCPlusCampaignSelect({
  campaigns,
  selectedCampaignId,
  onSelect,
  disabled = false,
}: ThreeCPlusCampaignSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Campanha 3CPlus
      </Label>
      <Select
        value={selectedCampaignId?.toString() ?? ''}
        onValueChange={(val) => onSelect(Number(val))}
        disabled={disabled || campaigns.length === 0}
      >
        <SelectTrigger>
          <SelectValue placeholder={campaigns.length === 0 ? 'Nenhuma campanha disponível' : 'Selecione uma campanha...'} />
        </SelectTrigger>
        <SelectContent>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id.toString()}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
