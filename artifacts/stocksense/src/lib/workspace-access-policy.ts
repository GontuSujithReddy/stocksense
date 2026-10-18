export type WorkspaceAccessRole = 'owner' | 'courier' | 'any' | 'profile';

type WorkspaceAccessContext = {
  role: WorkspaceAccessRole;
  deliveryRole?: string | null;
  phone?: string | null;
  accountDeleted: boolean;
  adminStatus?: string | null;
  supportStatus?: string | null;
};

export function getWorkspaceAccessRedirect({
  role,
  deliveryRole,
  phone,
  accountDeleted,
  adminStatus,
  supportStatus,
}: WorkspaceAccessContext): string | null {
  if (accountDeleted) return '/account-deleted';

  if (adminStatus === 'pending' || adminStatus === 'inactive' || adminStatus === 'terminated') {
    return '/onboarding';
  }

  // Support staff may view their own account page only while approved. Keep
  // paused staff on the inactive screen instead of exposing the account page.
  if (role === 'profile' && deliveryRole === 'support_staff') {
    if (supportStatus === 'paused') return '/customer-service/staff';
    if (supportStatus === 'approved') return null;
  }

  if (adminStatus !== 'active' && (supportStatus === 'paused' || supportStatus === 'approved')) {
    return '/customer-service/staff';
  }

  if (deliveryRole === 'support_staff') return '/onboarding';
  if (!deliveryRole || !/^[0-9]{10}$/.test(phone ?? '')) return '/onboarding';

  if (role !== 'any' && role !== 'profile' && deliveryRole !== role) {
    return deliveryRole === 'courier' ? '/courier/deliveries' : '/dashboard';
  }

  return null;
}
