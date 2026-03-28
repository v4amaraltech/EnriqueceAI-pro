'use client';

import { useCallback, useState } from 'react';

import { FileUp, Upload, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { cn } from '@/lib/utils';

interface CsvDropzoneProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export function CsvDropzone({ onFileSelect, disabled }: CsvDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        setSelectedFile(file);
        onFileSelect(file);
      }
    },
    [onFileSelect, disabled],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setSelectedFile(file);
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  const clearFile = useCallback(() => {
    setSelectedFile(null);
  }, []);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'relative flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
        isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {selectedFile ? (
        <div className="flex items-center gap-3">
          <FileUp className="h-8 w-8 text-primary" />
          <div>
            <p className="font-medium">{selectedFile.name}</p>
            <p className="text-sm text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
          </div>
          <Button variant="ghost" size="icon" onClick={clearFile} disabled={disabled} aria-label="Remover arquivo">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
          <p className="mb-2 text-sm font-medium">Arraste um arquivo CSV aqui</p>
          <p className="mb-4 text-xs text-muted-foreground">ou clique para selecionar</p>
          <label className="cursor-pointer">
            <input type="file" accept=".csv" onChange={handleFileInput} className="hidden" disabled={disabled} />
            <Button variant="outline" size="sm" asChild disabled={disabled}>
              <span>Selecionar arquivo</span>
            </Button>
          </label>
        </>
      )}
    </div>
  );
}
