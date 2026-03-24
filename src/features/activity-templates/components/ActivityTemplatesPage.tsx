'use client';

import { useState } from 'react';

import { Card } from '@/shared/components/ui/card';

import type { ActivityTemplateRow } from '../types';
import {
  ActivityTemplateCategorySidebar,
  type CategoryKey,
} from './ActivityTemplateCategorySidebar';
import { ActivityTemplateTable } from './ActivityTemplateTable';

interface Props {
  initialTemplates: ActivityTemplateRow[];
}

export function ActivityTemplatesPage({ initialTemplates }: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('email');
  const [templates, setTemplates] = useState(initialTemplates);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Templates de Atividades</h1>
      <Card className="flex flex-row gap-0 p-0">
        <div className="border-r p-4">
          <ActivityTemplateCategorySidebar
            active={activeCategory}
            onSelect={setActiveCategory}
            templates={templates}
          />
        </div>
        <div className="flex-1 p-6">
          <ActivityTemplateTable
            activeCategory={activeCategory}
            templates={templates}
            onTemplatesChange={setTemplates}
          />
        </div>
      </Card>
    </div>
  );
}
