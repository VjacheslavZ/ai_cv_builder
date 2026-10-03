'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { signOut } from '@/lib/auth';

export function LogOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function logOut() {
    setPending(true);
    try {
      await signOut();
      // The next user of this tab must not see the previous user's cached data.
      queryClient.clear();
      router.replace('/login');
      router.refresh();
    } catch {
      setPending(false);
      toast.add({ title: 'Could not log out. Try again.', type: 'error' });
    }
  }

  return (
    <Button variant="outline" onClick={logOut} disabled={pending}>
      {pending ? 'Logging out…' : 'Log out'}
    </Button>
  );
}
