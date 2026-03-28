'use client';

import { useEffect, useState } from 'react';

import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

import { signOut as signOutAction } from '../actions/sign-out';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser()
      .then(({ data: { user: currentUser } }) => {
        setUser(currentUser);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await signOutAction();
    setUser(null);
  }

  return { user, loading, signOut: handleSignOut };
}
