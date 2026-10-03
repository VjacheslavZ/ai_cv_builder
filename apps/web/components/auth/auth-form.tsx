'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ErrorCode,
  signInSchema,
  signUpSchema,
  type SignInInput,
  type SignUpInput,
} from '@cv/shared';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm, type Resolver } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/form/text-field';
import { FieldError, FieldGroup } from '@/components/ui/field';
import { ApiRequestError } from '@/lib/api-fetch';
import { signIn, signUp } from '@/lib/auth';
import { AUTH_COPY, formMessage, type AuthMode } from './auth-copy';

type Values = SignInInput & SignUpInput;
type FieldName = keyof Values;

const FIELD_NAMES = new Set<string>(['firstName', 'lastName', 'email', 'password']);
const isFieldName = (name: string): name is FieldName => FIELD_NAMES.has(name);

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const copy = AUTH_COPY[mode];
  const form = useForm<Values>({
    // One form type for both modes; the sign-in schema simply ignores the name fields.
    resolver: (mode === 'sign-up'
      ? zodResolver(signUpSchema)
      : zodResolver(signInSchema)) as unknown as Resolver<Values>,
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
  });
  const { errors } = form.formState;

  /** Puts a failed request's error where the user sees it. */
  function showError(error: unknown) {
    if (error instanceof ApiRequestError && error.fields) {
      for (const [name, message] of Object.entries(error.fields)) {
        if (isFieldName(name)) form.setError(name, { message });
      }
      return;
    }
    if (error instanceof ApiRequestError && error.code === ErrorCode.EMAIL_TAKEN) {
      form.setError('email', { message: error.message }, { shouldFocus: true });
      return;
    }
    form.setError('root', { message: formMessage(error) });
  }

  const auth = useMutation({
    mutationFn: ({ firstName, lastName, email, password }: Values) =>
      mode === 'sign-up'
        ? signUp({ firstName, lastName, email, password })
        : signIn({ email, password }),
    onSuccess: () => {
      queryClient.removeQueries();
      router.replace('/');
      router.refresh();
    },
    onError: showError,
  });

  const busy = auth.isPending || auth.isSuccess;

  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold">{copy.title}</h1>
      <form noValidate onSubmit={form.handleSubmit((values) => auth.mutate(values))}>
        <FieldGroup className="gap-6">
          {mode === 'sign-up' && (
            <div className="grid gap-6 sm:grid-cols-2">
              <TextField
                id="firstName"
                label="First name"
                autoComplete="given-name"
                autoCapitalize="words"
                error={errors.firstName}
                {...form.register('firstName')}
              />
              <TextField
                id="lastName"
                label="Last name"
                autoComplete="family-name"
                autoCapitalize="words"
                error={errors.lastName}
                {...form.register('lastName')}
              />
            </div>
          )}
          <TextField
            id="email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            error={errors.email}
            {...form.register('email')}
          />
          <TextField
            id="password"
            label="Password"
            type="password"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            error={errors.password}
            {...form.register('password')}
          />
          <div className="relative">
            <FieldError errors={[errors.root]} className="absolute bottom-[-21px] left-0" />
            <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>
              {busy ? copy.pending : copy.submit}
            </Button>
          </div>
        </FieldGroup>
      </form>
      <p className="text-sm text-muted-foreground">
        {copy.alt.text}{' '}
        <Link href={copy.alt.href} className="text-foreground underline underline-offset-4">
          {copy.alt.link}
        </Link>
      </p>
    </section>
  );
}
