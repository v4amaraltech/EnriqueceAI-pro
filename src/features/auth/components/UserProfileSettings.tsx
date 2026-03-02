'use client';

import { useRef, useState, useTransition } from 'react';

import { Camera, Loader2, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { uploadAvatar } from '../actions/upload-avatar';
import { changePassword, updateProfile } from '../actions/update-profile';

interface UserProfileSettingsProps {
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

export function UserProfileSettings({ initialName, email, avatarUrl }: UserProfileSettingsProps) {
  const [name, setName] = useState(initialName);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(avatarUrl);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingProfile, startProfileTransition] = useTransition();
  const [isSavingPassword, startPasswordTransition] = useTransition();

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
      // Reset input so the same file can be re-selected
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

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }

    startPasswordTransition(async () => {
      const result = await changePassword({
        currentPassword,
        newPassword,
      });
      if (result.success) {
        toast.success('Senha alterada com sucesso');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <section>
        <h2 className="text-lg font-semibold">Perfil</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Atualize suas informações pessoais.
        </p>

        <div className="mt-4 space-y-4">
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
            <div className="text-sm text-[var(--muted-foreground)]">
              Clique para alterar a foto. JPEG, PNG ou WebP, até 2MB.
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
      </section>

      {/* Separator */}
      <div className="border-t border-[var(--border)]" />

      {/* Password Section */}
      <section>
        <h2 className="text-lg font-semibold">Alterar Senha</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Mantenha sua conta segura atualizando sua senha periodicamente.
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Senha Atual</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Digite sua senha atual"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">Nova Senha</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar Nova Senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha"
            />
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
          >
            {isSavingPassword ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Alterar Senha
          </Button>
        </div>
      </section>
    </div>
  );
}
