'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { enrollLeads } from '@/features/cadences/actions/manage-cadences';

import { fetchCadencesWithAvailability } from '../actions/fetch-cadences-with-availability';
import type { AvailableCadence, ForecastDay } from '../types/start-new-leads';

interface UseStartNewLeadsReturn {
  cadences: AvailableCadence[];
  isLoading: boolean;
  totalAvailable: number;
  availableLeadIds: string[];
  forecast: ForecastDay[];
  selectedIds: Set<string>;
  toggleCadence: (id: string) => void;
  quantity: number;
  setQuantity: (n: number) => void;
  startLeads: () => void;
  isStarting: boolean;
}

function buildForecast(
  quantity: number,
  selectedCadences: AvailableCadence[],
): ForecastDay[] {
  const avgSteps =
    selectedCadences.length > 0
      ? selectedCadences.reduce((sum, c) => sum + c.totalSteps, 0) /
        selectedCadences.length
      : 6;

  return Array.from({ length: 14 }, (_, i) => {
    const decay = Math.exp(-i / 6);
    const peak = i >= 8 && i <= 10 ? 1.3 : 1;
    const base = (quantity / 10) * decay * peak;
    return {
      day: i,
      label: i === 0 ? 'hoje' : `+${i}`,
      calls: Math.round(base * avgSteps * 0.4),
      messages: Math.round(base * avgSteps * 0.6),
    };
  });
}

export function useStartNewLeads(open: boolean): UseStartNewLeadsReturn {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cadences, setCadences] = useState<AvailableCadence[]>([]);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [availableLeadIds, setAvailableLeadIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(10);
  const [isStarting, setIsStarting] = useState(false);

  // Load data when modal opens
  useEffect(() => {
    if (open && !loaded) {
      startTransition(async () => {
        const result = await fetchCadencesWithAvailability();
        if (result.success) {
          setCadences(result.data.cadences);
          setTotalAvailable(result.data.totalAvailable);
          setAvailableLeadIds(result.data.availableLeadIds);
          // Select all cadences with available leads by default
          const ids = new Set(
            result.data.cadences
              .filter((c) => result.data.totalAvailable > 0)
              .map((c) => c.id),
          );
          setSelectedIds(ids);
        }
        setLoaded(true);
      });
    }
    if (!open) {
      setLoaded(false);
      setCadences([]);
      setSelectedIds(new Set());
      setQuantity(10);
      setTotalAvailable(0);
      setAvailableLeadIds([]);
    }
  }, [open, loaded]);

  const toggleCadence = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedCadences = useMemo(
    () => cadences.filter((c) => selectedIds.has(c.id)),
    [cadences, selectedIds],
  );

  const forecast = useMemo(
    () => buildForecast(quantity, selectedCadences),
    [quantity, selectedCadences],
  );

  const startLeads = useCallback(() => {
    if (selectedIds.size === 0 || availableLeadIds.length === 0) return;

    setIsStarting(true);
    const leadsToEnroll = availableLeadIds.slice(0, quantity);
    const cadenceIds = [...selectedIds];

    // Enroll leads in each selected cadence
    startTransition(async () => {
      let totalEnrolled = 0;
      let totalErrors = 0;

      for (const cadenceId of cadenceIds) {
        const result = await enrollLeads(cadenceId, leadsToEnroll);
        if (result.success) {
          totalEnrolled += result.data.enrolled;
          totalErrors += result.data.errors.length;
        } else {
          totalErrors += leadsToEnroll.length;
        }
      }

      if (totalEnrolled > 0) {
        toast.success(
          `${totalEnrolled} lead${totalEnrolled > 1 ? 's' : ''} inscrito${totalEnrolled > 1 ? 's' : ''} com sucesso`,
        );
        if (totalErrors > 0) {
          toast.warning(`${totalErrors} erro(s) ao inscrever`);
        }
      } else {
        toast.error('Erro ao inscrever leads nas cadências');
      }

      setIsStarting(false);
      router.refresh();
    });
  }, [selectedIds, availableLeadIds, quantity, router]);

  return {
    cadences,
    isLoading: isPending && !loaded,
    totalAvailable,
    availableLeadIds,
    forecast,
    selectedIds,
    toggleCadence,
    quantity,
    setQuantity,
    startLeads,
    isStarting,
  };
}
