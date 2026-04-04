'use client';

import Image from 'next/image';
import { Loader2, RefreshCw, X, CheckCircle2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

interface WhatsAppEvolutionModalProps {
  qrBase64: string | null;
  step: 'creating' | 'waiting_scan' | 'connected' | 'error';
  phone: string | null;
  error: string | null;
  onRefreshQr: () => void;
  onClose: () => void;
}

export function WhatsAppEvolutionModal({
  qrBase64,
  step,
  phone,
  error,
  onRefreshQr,
  onClose,
}: WhatsAppEvolutionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex rounded-2xl overflow-hidden border border-[var(--border)] m-4">
      {/* Left panel */}
      <div className="relative flex w-full flex-col items-center justify-center bg-[#18181a] px-10 py-10 md:w-1/2 overflow-y-auto">
        {step === 'connected' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">WhatsApp Conectado!</h2>
              {phone && (
                <p className="mt-2 text-zinc-400">
                  Número: {phone}
                </p>
              )}
            </div>
            <Button onClick={onClose}>Fechar</Button>
          </div>
        ) : (
          <>
            {/* Title + subtitle */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white">Conecte seu WhatsApp</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Vincule seu número para enviar mensagens de cadência via WhatsApp Web.
              </p>
            </div>

            {/* Instructions BEFORE QR for visibility */}
            <div className="mb-6 rounded-lg bg-zinc-800/50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Como conectar</p>
              <ol className="space-y-2 text-sm text-zinc-400">
                <li className="flex gap-2">
                  <span className="font-semibold text-green-500 shrink-0">1.</span>
                  <span>Abra o <strong className="text-white">WhatsApp</strong> no seu celular</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-green-500 shrink-0">2.</span>
                  <span>Vá em <strong className="text-white">Configurações</strong> → <strong className="text-white">Dispositivos conectados</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-green-500 shrink-0">3.</span>
                  <span>Toque em <strong className="text-white">Conectar dispositivo</strong> e escaneie o QR abaixo</span>
                </li>
              </ol>
            </div>

            {/* QR Code */}
            <div className="mb-6 flex h-64 w-64 items-center justify-center rounded-lg border border-[var(--border)] bg-white p-1">
              {step === 'creating' ? (
                <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
              ) : step === 'error' ? (
                <div className="text-center">
                  <p className="text-sm text-red-600">{error ?? 'Erro ao gerar QR Code'}</p>
                </div>
              ) : qrBase64 ? (
                /* eslint-disable-next-line @next/next/no-img-element -- base64 data URI, next/image incompatible */
                <img
                  src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code WhatsApp"
                  className="h-full w-full object-contain"
                />
              ) : (
                <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
              )}
            </div>

            {/* Waiting indicator */}
            {step === 'waiting_scan' && (
              <div className="mb-6 flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Aguardando você escanear...
              </div>
            )}

            {/* Tip */}
            <p className="mb-6 text-xs text-zinc-500">
              A conexão usa WhatsApp Web. Seu celular precisa estar conectado à internet.
            </p>

            {/* Refresh button */}
            {(step === 'waiting_scan' || step === 'error') && (
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={onRefreshQr}
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar QR Code
              </button>
            )}
          </>
        )}
      </div>

      {/* Right panel — WhatsApp branding */}
      <div className="hidden flex-col items-center justify-center bg-black md:flex md:w-1/2 relative">
        <button
          type="button"
          aria-label="Fechar"
          className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/60 hover:text-white transition-colors"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>
        <Image
          src="/logos/whatsapp-logo-full.svg"
          alt="WhatsApp"
          width={320}
          height={76}
          className="opacity-80"
          style={{ filter: 'brightness(0) saturate(100%) invert(56%) sepia(53%) saturate(652%) hue-rotate(93deg) brightness(97%) contrast(87%)' }}
        />
      </div>
    </div>
  );
}
