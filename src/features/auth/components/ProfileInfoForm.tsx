'use client';

import { useRef, useState, useTransition } from 'react';

import { Camera, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { uploadAvatar } from '../actions/upload-avatar';
import { updateProfile } from '../actions/update-profile';

interface ProfileInfoFormProps {
  initialName: string;
  email: string;
  avatarUrl?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function ProfileInfoForm({ initialName, email, avatarUrl }: ProfileInfoFormProps) {
  const [name, setName] = useState(initialName);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(avatarUrl);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSavingProfile, startProfileTransition] = useTransition();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const result = await uploadAvatar(formData);
      if (result.success) {
        setCurrentAvatarUrl(result.data.avatarUrl);
        toast.success('Foto atualizada');
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveProfile = () => {
    startProfileTransition(async () => {
      const result = await updateProfile({ fullName: name });
      if (result.success) {
        toast.success('Perfil atualizado');
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Informações Pessoais</h2>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Atualize suas informações pessoais.
        </p>
      </div>

      <div className="space-y-4">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingAvatar}
            className="group relative cursor-pointer rounded-full"
          >
            <Avatar className="h-20 w-20">
              <AvatarImage src={currentAvatarUrl} alt={name} />
              <AvatarFallback className="text-lg">
                {getInitials(name || email)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              {isUploadingAvatar ? (
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              ) : (
                <Camera className="h-5 w-5 text-white" />
              )}
            </div>
            {isUploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAvatarChange}
            className="hidden"
          />
          <div className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Clique para alterar a foto. JPEG, PNG ou WebP, até 5MB.
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} readOnly className="bg-[var(--muted)]" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fullName">Nome Completo</Label>
          <Input
            id="fullName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome completo"
          />
        </div>

        <Button onClick={handleSaveProfile} disabled={isSavingProfile}>
          {isSavingProfile ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar Perfil
        </Button>
      </div>
    </div>
  );
}
