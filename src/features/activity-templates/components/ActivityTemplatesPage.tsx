'use client';

import { useState } from 'react';

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
    <div className="flex gap-6 p-6">
      <ActivityTemplateCategorySidebar
        active={activeCategory}
        onSelect={setActiveCategory}
        templates={templates}
      />
      <ActivityTemplateTable
        activeCategory={activeCategory}
        templates={templates}
        onTemplatesChange={setTemplates}
      />
    </div>
  );
}
