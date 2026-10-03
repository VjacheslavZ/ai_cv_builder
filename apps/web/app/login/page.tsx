import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Log in · AI CV Builder' };

export default function LoginPage() {
  return <AuthForm mode="sign-in" />;
}
