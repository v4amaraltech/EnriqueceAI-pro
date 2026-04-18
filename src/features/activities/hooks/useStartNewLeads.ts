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
  todayActivities: number;
  newActivitiesPerDay: (dayOffset: number) => number;
}

const DAY_MULTIPLIERS = [1.0, 0.3, 0.2, 0.15, 0.1];

function getBusinessDayLabels(count: number): string[] {
  const labels: string[] = [];
  const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const now = new Date();
  const current = new Date(now);

  for (let i = 0; labels.length < count; i++) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      labels.push(labels.length === 0 ? 'hoje' : dayNames[day]!);
    }
    current.setDate(current.getDate() + 1);
  }
  return labels;
}

function buildForecast(
  _quantity: number,
  _selectedCadences: AvailableCadence[],
): ForecastDay[] {
  const dayLabels = getBusinessDayLabels(5);

  return dayLabels.map((dayLabel, i) => {
    // Mock existing activities (will be replaced by RPC later)
    const existingActivities = Math.floor(Math.random() * 21) + 20;

    return {
      dayOffset: i,
      dayLabel,
      existingActivities,
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
              .filter(() => result.data.totalAvailable > 0)
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

  const leadsPerCadence = useCallback(
    (_c: AvailableCadence) => {
      if (selectedCadences.length === 0) return 0;
      return Math.ceil(quantity / selectedCadences.length);
    },
    [quantity, selectedCadences.length],
  );

  const todayActivities = useMemo(
    () =>
      selectedCadences.reduce(
        (sum, c) => sum + leadsPerCadence(c) * c.firstDayActivities,
        0,
      ),
    [selectedCadences, leadsPerCadence],
  );

  const newActivitiesPerDay = useCallback(
    (dayOffset: number) => {
      const multiplier = DAY_MULTIPLIERS[dayOffset] ?? 0.1;
      return Math.round(todayActivities * multiplier);
    },
    [todayActivities],
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
    todayActivities,
    newActivitiesPerDay,
  };
}
