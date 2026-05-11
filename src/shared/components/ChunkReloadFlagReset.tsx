'use client';

import { useEffect } from 'react';

export function ChunkReloadFlagReset() {
  useEffect(() => {
    sessionStorage.removeItem('chunk-reload-attempted');
  }, []);
  return null;
}
