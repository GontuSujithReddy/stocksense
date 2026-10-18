import { useState } from 'react';
import { useClerk, useSignIn, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Eye, EyeOff, KeyRound, LogOut, Mail, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import {
  useGetDeliveryProfile,
  useDeleteStocksenseAccount,
  useGetStocksenseAccountStatus,
} from '@workspace/api-client-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Shell, PageHeading } from '../components/common';

function deletionErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return 'The deletion result could not be confirmed. Refresh the page to check the account status before retrying.';
}

function clerkErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    if ('longMessage' in error && typeof error.longMessage === 'string') {
      return error.longMessage;
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if ('errors' in error && Array.isArray(error.errors)) {
      const firstError = error.errors.find(
        (item): item is { longMessage?: string; message?: string } =>
          typeof item === 'object' && item !== null,
      );
      if (firstError?.longMessage || firstError?.message) {
        return firstError.longMessage || firstError.message || fallback;
      }
    }
  }
  return fallback;
}

type PasswordFormValues = {
  code: string;
  newPassword: string;
  confirmPassword: string;
};

export default function ProfilePage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { signIn, fetchStatus } = useSignIn();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const account = useGetStocksenseAccountStatus();
  const deleteAccount = useDeleteStocksenseAccount();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [passwordStep, setPasswordStep] = useState<'idle' | 'code' | 'password' | 'complete'>('idle');
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordForm = useForm<PasswordFormValues>({
    defaultValues: { code: '', newPassword: '', confirmPassword: '' },
  });
  const workspaceProfile = useGetDeliveryProfile();
  const isSupportStaff = workspaceProfile.data?.role === 'support_staff';
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const primaryEmail = user?.primaryEmailAddress;
  const hasVerifiedPrimaryEmail =
    Boolean(primaryEmail?.emailAddress) && primaryEmail?.verification.status === 'verified';
  const canChangePassword = hasVerifiedPrimaryEmail;
  const passwordFlowBusy = fetchStatus === 'fetching';

  const closeDialog = (open: boolean) => {
    if (deleteAccount.isPending && !open) return;
    setDialogOpen(open);
    if (!open) {
      setConfirmationText('');
      setDeleteError('');
    }
  };

  const confirmDeletion = async () => {
    setDeleteError('');
    try {
      await deleteAccount.mutateAsync();
      queryClient.clear();
      setLocation('/account-deleted?complete=1');
    } catch (error) {
      setDeleteError(deletionErrorMessage(error));
    }
  };

  const resetPasswordFlow = () => {
    if (passwordFlowBusy) return;
    void signIn.reset();
    passwordForm.reset();
    setPasswordStep('idle');
    setPasswordError('');
    setPasswordNotice('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const resendPasswordCode = async () => {
    setPasswordError('');
    setPasswordNotice('');
    try {
      const { error } = await signIn.resetPasswordEmailCode.sendCode();
      if (error) {
        setPasswordError(
          clerkErrorMessage(error, 'We could not resend the verification code. Please try again.'),
        );
        return;
      }
      passwordForm.setValue('code', '');
      setPasswordNotice(`A new verification code was sent to ${primaryEmail?.emailAddress}.`);
    } catch (error) {
      setPasswordError(
        clerkErrorMessage(error, 'We could not resend the verification code. Please try again.'),
      );
    }
  };

  const beginPasswordChange = async () => {
    if (!primaryEmail?.emailAddress || !canChangePassword) return;
    setPasswordError('');
    setPasswordNotice('');

    try {
      const { error: createError } = await signIn.create({
        identifier: primaryEmail.emailAddress,
      });
      if (createError) {
        setPasswordError(
          clerkErrorMessage(createError, 'We could not start the password change. Please try again.'),
        );
        return;
      }

      const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendError) {
        setPasswordError(
          clerkErrorMessage(sendError, 'We could not send a verification code. Please try again.'),
        );
        return;
      }

      passwordForm.reset();
      setPasswordStep('code');
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setPasswordNotice(`A verification code was sent to ${primaryEmail.emailAddress}.`);
    } catch (error) {
      setPasswordError(
        clerkErrorMessage(error, 'We could not send a verification code. Please try again.'),
      );
    }
  };

  const submitPasswordFlow = async (values: PasswordFormValues) => {
    setPasswordError('');
    setPasswordNotice('');

    if (passwordStep === 'code') {
      const code = values.code.trim();
      if (!code) {
        passwordForm.setError('code', { type: 'required', message: 'Enter the email verification code.' });
        return;
      }

      try {
        const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
        if (error) {
          setPasswordError(
            clerkErrorMessage(error, 'That code could not be verified. Check it and try again.'),
          );
          return;
        }
        if (signIn.status !== 'needs_new_password') {
          setPasswordError(
            'The code was accepted, but Clerk has not authorized a password change. Restart the flow and try again.',
          );
          return;
        }
        setPasswordStep('password');
        setPasswordNotice('Email verified. Choose your new password.');
        passwordForm.setValue('code', '');
      } catch (error) {
        setPasswordError(
          clerkErrorMessage(error, 'That code could not be verified. Check it and try again.'),
        );
      }
      return;
    }

    if (passwordStep !== 'password') return;
    try {
      const { error } = await signIn.resetPasswordEmailCode.submitPassword({
        password: values.newPassword,
      });
      if (error) {
        setPasswordError(
          clerkErrorMessage(error, 'The password could not be updated. Check the password and try again.'),
        );
        return;
      }

      if (signIn.status === 'complete') {
        try {
          const { error: finalizeError } = await signIn.finalize();
          if (finalizeError) {
            setPasswordNotice(
              'Your password was updated. Clerk could not refresh the sign-in session; use the new password if you are asked to sign in again.',
            );
          } else {
            setPasswordNotice('Your password was updated and your StockSense session is ready.');
          }
        } catch {
          setPasswordNotice(
            'Your password was updated. Clerk could not refresh the sign-in session; use the new password if you are asked to sign in again.',
          );
        }
      } else {
        setPasswordNotice(
          'Your password was updated. Clerk requires another verification to complete sign-in; your current StockSense session remains active.',
        );
      }
      passwordForm.reset();
      setPasswordStep('complete');
    } catch (error) {
      setPasswordError(
        clerkErrorMessage(error, 'The password could not be updated. Please try again.'),
      );
    }
  };

  return (
    <Shell title="Profile" supportWorkspace={isSupportStaff}>
      <main className="page">
        <PageHeading
          eyebrow="YOUR ACCOUNT"
          title="Profile"
          description="Your identity in the StockSense workspace."
        />
        <div className="panel" style={{ maxWidth: 700, overflow: 'hidden' }}>
          <div style={{ background: '#dcebd7', padding: '35px 30px', display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 65, height: 65, borderRadius: 18, background: '#205856', color: '#dcebd7', display: 'grid', placeItems: 'center' }}>
              <UserRound size={30} />
            </div>
            <div>
              <div className="eyebrow">WORKSPACE MEMBER</div>
              <h2 className="display" style={{ fontSize: 28, margin: '5px 0' }} data-testid="text-profile-name">
                {isLoaded ? (user?.fullName || user?.username || 'StockSense member') : 'Loading account…'}
              </h2>
              <div className="subtle" style={{ fontSize: 12 }}>Signed in and ready to work</div>
            </div>
          </div>
          <div style={{ padding: 30 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 18,
                padding: '18px 0',
                borderBottom: '1px solid #e3ebe2',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15, minWidth: 0 }}>
                <Mail size={18} color="#417b71" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow">EMAIL ADDRESS</div>
                  <div
                    style={{ fontSize: 13, marginTop: 6, overflowWrap: 'anywhere' }}
                    data-testid="text-profile-email"
                  >
                    {user?.primaryEmailAddress?.emailAddress || '—'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15, minWidth: 0 }}>
                <KeyRound size={18} color="#417b71" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="eyebrow">PASSWORD</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 3 }}>
                    <span style={{ fontSize: 13, letterSpacing: 2 }} data-testid="text-profile-password">
                      {!isLoaded ? 'Loading…' : '••••••••••••'}
                    </span>
                    {isLoaded && user && (
                      <button
                        className="btn btn-outline"
                        type="button"
                        onClick={() => void beginPasswordChange()}
                        disabled={!canChangePassword || passwordFlowBusy || passwordStep !== 'idle'}
                        aria-label="Change password after email verification"
                        title={
                          canChangePassword
                            ? 'Change password after email verification'
                            : 'A verified primary email is required to change the password'
                        }
                        data-testid="button-profile-password"
                        style={{ padding: '6px 9px', minHeight: 30, gap: 6 }}
                      >
                        <KeyRound size={14} /> Change
                      </button>
                    )}
                  </div>
                  <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>
                    Password stays hidden; use Change password to set or update it.
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '18px 0' }}>
              <ShieldCheck size={18} color="#417b71" />
              <div>
                <div className="eyebrow">ACCOUNT STATUS</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Active session</div>
              </div>
            </div>
            <button
              className="btn btn-danger"
              style={{ marginTop: 20 }}
              onClick={() => signOut({ redirectUrl: basePath || '/' })}
              data-testid="button-logout"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>

        <section
          className="panel"
          aria-labelledby="change-password-title"
          style={{ maxWidth: 700, marginTop: 24, padding: 26 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <KeyRound size={19} color="#417b71" />
            <div>
              <div className="eyebrow">ACCOUNT SECURITY</div>
              <h2 id="change-password-title" className="display" style={{ fontSize: 24, margin: '5px 0' }}>
                Change password
              </h2>
            </div>
          </div>
          <p className="subtle" style={{ fontSize: 13, lineHeight: 1.65, maxWidth: 590, margin: '10px 0 18px' }}>
            Verify your primary email with a one-time code before setting a new password.
          </p>

          {!isLoaded ? (
            <p className="subtle" role="status" data-testid="status-password-loading">Loading password options…</p>
          ) : !hasVerifiedPrimaryEmail ? (
            <p className="subtle" role="status" data-testid="status-password-email-unverified">
              A verified primary email is required to receive the password verification code.
            </p>
          ) : passwordStep === 'idle' ? (
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => void beginPasswordChange()}
              disabled={passwordFlowBusy}
              data-testid="button-start-password-change"
            >
              {passwordFlowBusy ? 'Sending code…' : 'Change password'}
            </button>
          ) : passwordStep === 'complete' ? (
            <button
              className="btn btn-outline"
              type="button"
              onClick={resetPasswordFlow}
              disabled={passwordFlowBusy}
              data-testid="button-change-password-again"
            >
              Change password again
            </button>
          ) : (
            <Form {...passwordForm}>
              <form
                onSubmit={passwordForm.handleSubmit(submitPasswordFlow)}
                style={{ display: 'grid', gap: 14, maxWidth: 420 }}
              >
                {passwordStep === 'code' ? (
                  <FormField
                    control={passwordForm.control}
                    name="code"
                    rules={{ required: 'Enter the email verification code.' }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email verification code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="Enter the code from your email"
                            disabled={passwordFlowBusy}
                            data-testid="input-password-email-code"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <>
                    <FormField
                      control={passwordForm.control}
                      name="newPassword"
                      rules={{ required: 'Enter a new password.' }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New password</FormLabel>
                          <div style={{ position: 'relative' }}>
                            <FormControl>
                              <Input
                                {...field}
                                type={showNewPassword ? 'text' : 'password'}
                                autoComplete="new-password"
                                disabled={passwordFlowBusy}
                                style={{ paddingRight: 44 }}
                                data-testid="input-new-password"
                              />
                            </FormControl>
                            <button
                              type="button"
                              onClick={() => setShowNewPassword((visible) => !visible)}
                              disabled={passwordFlowBusy}
                              aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                              data-testid="button-toggle-new-password-visibility"
                              style={{
                                position: 'absolute',
                                top: 2,
                                right: 4,
                                width: 32,
                                height: 32,
                                display: 'grid',
                                placeItems: 'center',
                                border: 0,
                                borderRadius: 6,
                                background: 'transparent',
                                color: '#417b71',
                                cursor: passwordFlowBusy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {showNewPassword ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="confirmPassword"
                      rules={{
                        required: 'Confirm your new password.',
                        validate: (value) =>
                          value === passwordForm.getValues('newPassword') || 'The passwords do not match.',
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm new password</FormLabel>
                          <div style={{ position: 'relative' }}>
                            <FormControl>
                              <Input
                                {...field}
                                type={showConfirmPassword ? 'text' : 'password'}
                                autoComplete="new-password"
                                disabled={passwordFlowBusy}
                                style={{ paddingRight: 44 }}
                                data-testid="input-confirm-new-password"
                              />
                            </FormControl>
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword((visible) => !visible)}
                              disabled={passwordFlowBusy}
                              aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                              data-testid="button-toggle-confirm-password-visibility"
                              style={{
                                position: 'absolute',
                                top: 2,
                                right: 4,
                                width: 32,
                                height: 32,
                                display: 'grid',
                                placeItems: 'center',
                                border: 0,
                                borderRadius: 6,
                                background: 'transparent',
                                color: '#417b71',
                                cursor: passwordFlowBusy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {showConfirmPassword ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {passwordNotice && (
                  <p role="status" style={{ color: '#417b71', fontSize: 13 }} data-testid="status-password-notice">
                    {passwordNotice}
                  </p>
                )}
                {passwordError && (
                  <p role="alert" style={{ color: '#a34432', fontSize: 13 }} data-testid="status-password-error">
                    {passwordError}
                  </p>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button
                    className="btn"
                    type="submit"
                    disabled={passwordFlowBusy}
                    data-testid={passwordStep === 'code' ? 'button-verify-password-code' : 'button-update-password'}
                  >
                    {passwordFlowBusy
                      ? passwordStep === 'code' ? 'Verifying…' : 'Updating…'
                      : passwordStep === 'code' ? 'Verify code' : 'Update password'}
                  </button>
                  {passwordStep === 'code' && (
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={() => void resendPasswordCode()}
                      disabled={passwordFlowBusy}
                      data-testid="button-resend-password-code"
                    >
                      Resend code
                    </button>
                  )}
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={resetPasswordFlow}
                    disabled={passwordFlowBusy}
                    data-testid="button-cancel-password-change"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </Form>
          )}

          {(passwordStep === 'idle' || passwordStep === 'complete') && passwordNotice && (
            <p role="status" style={{ color: '#417b71', fontSize: 13 }} data-testid="status-password-notice">
              {passwordNotice}
            </p>
          )}
          {(passwordStep === 'idle' || passwordStep === 'complete') && passwordError && (
            <p role="alert" style={{ color: '#a34432', fontSize: 13 }} data-testid="status-password-error">
              {passwordError}
            </p>
          )}
        </section>

        {account.data?.canDelete && (
          <section
            className="panel"
            aria-labelledby="delete-account-title"
            style={{ maxWidth: 700, marginTop: 24, padding: 26, border: '1px solid #e7c7c1' }}
          >
            <div className="eyebrow" style={{ color: '#a34432' }}>PERMANENT ACTION</div>
            <h2 id="delete-account-title" className="display" style={{ fontSize: 24, margin: '8px 0' }}>
              Delete your account permanently
            </h2>
            <p className="subtle" style={{ fontSize: 13, lineHeight: 1.65, maxWidth: 590 }}>
              This removes your StockSense data and memory, shared sign-in, and Delivery profile and owner settings.
              Delivery-linked operational history remains available in Delivery.
            </p>
            <button
              className="btn btn-danger"
              style={{ marginTop: 14 }}
              onClick={() => setDialogOpen(true)}
              data-testid="button-delete-stocksense-data"
            >
              <Trash2 size={16} /> Delete account permanently
            </button>
          </section>
        )}

        <AlertDialog open={dialogOpen} onOpenChange={closeDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. Your StockSense workspace and memory bank, shared sign-in, Delivery profile,
                owner settings, and account access will be removed. Delivery-linked operational history is retained
                in Delivery.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label style={{ display: 'grid', gap: 7, fontSize: 13 }}>
              Type <strong>DELETE</strong> to confirm
              <input
                className="field"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                autoComplete="off"
                autoFocus
                aria-label="Type DELETE to confirm account data deletion"
                data-testid="input-delete-confirmation"
              />
            </label>
            {deleteError && <p role="alert" style={{ color: '#a34432', fontSize: 13 }}>{deleteError}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel
                className="btn btn-outline"
                disabled={deleteAccount.isPending}
                data-testid="button-cancel-delete"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="btn btn-danger"
                disabled={confirmationText !== 'DELETE' || deleteAccount.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDeletion();
                }}
                data-testid="button-confirm-delete"
              >
                {deleteAccount.isPending ? 'Deleting…' : 'Delete permanently'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </Shell>
  );
}