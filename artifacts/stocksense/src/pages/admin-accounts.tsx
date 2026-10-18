import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStocksenseAdminAccessQueryKey,
  getListStocksenseAdminAccountsQueryKey,
  useListStocksenseAdminAccounts,
  useReviewStocksenseAdminAccount,
  useSetStocksenseAdminAccountStatus,
  useTerminateStocksenseAdminAccount,
  type StocksenseAdminAccount,
} from '@workspace/api-client-react';
import { AlertTriangle, ArchiveX, Check, Clock3, Mail, Pause, Play, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react';
import { SectionHeadingIcon, Shell } from '../components/common';

type AccountView = 'pending' | 'accepted' | 'denied' | 'active' | 'inactive' | 'terminated';
type Action = { type: 'review'; account: StocksenseAdminAccount; status: 'accepted' | 'denied' }
  | { type: 'status'; account: StocksenseAdminAccount; status: 'active' | 'inactive' }
  | { type: 'terminate'; account: StocksenseAdminAccount };

const views: AccountView[] = ['pending', 'accepted', 'denied', 'active', 'inactive', 'terminated'];
const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'Not recorded';

export default function AdminAccountsPage() {
  const queryKey = getListStocksenseAdminAccountsQueryKey();
  const accountsQuery = useListStocksenseAdminAccounts({ query: { queryKey, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const review = useReviewStocksenseAdminAccount();
  const setStatus = useSetStocksenseAdminAccountStatus();
  const terminate = useTerminateStocksenseAdminAccount();
  const queryClient = useQueryClient();
  const [view, setView] = useState<AccountView>('pending');
  const [action, setAction] = useState<Action | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const data = accountsQuery.data;
  const busy = review.isPending || setStatus.isPending || terminate.isPending;
  const accountGroups = useMemo(() => ({
    pending: data?.accounts.filter(account => account.requestStatus === 'pending') ?? [],
    accepted: data?.accounts.filter(account => account.requestStatus === 'accepted' && account.accessStatus !== 'terminated') ?? [],
    denied: data?.accounts.filter(account => account.requestStatus === 'denied') ?? [],
    active: data?.accounts.filter(account => account.accessStatus === 'active') ?? [],
    inactive: data?.accounts.filter(account => account.accessStatus === 'inactive') ?? [],
    terminated: data?.accounts.filter(account => account.accessStatus === 'terminated') ?? [],
  }), [data]);
  const filtered = accountGroups[view].filter(account => {
    const q = search.trim().toLowerCase();
    return !q || [account.displayName, account.verifiedEmail, account.phone, account.userId].some(value => value.toLowerCase().includes(q));
  });

  useEffect(() => {
    if (!action) return;
    const focusable = () => dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setAction(null); return; }
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [action, busy]);

  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey }),
    queryClient.invalidateQueries({ queryKey: getGetStocksenseAdminAccessQueryKey() }),
  ]);
  const commitAction = async () => {
    if (!action) return;
    setNotice(null);
    try {
      let message = '';
      if (action.type === 'review') {
        const saved = await review.mutateAsync({ userId: action.account.userId, data: { status: action.status } });
        message = `${saved.displayName || 'Request'} marked ${saved.requestStatus}. The decision is recorded.`;
      } else if (action.type === 'status') {
        const saved = await setStatus.mutateAsync({ userId: action.account.userId, data: { status: action.status } });
        message = `${saved.displayName || 'Admin'} access is now ${saved.accessStatus}.`;
      } else {
        const saved = await terminate.mutateAsync({ userId: action.account.userId });
        message = `${saved.displayName || 'Admin'} access has been permanently terminated.`;
      }
      await invalidate();
      setAction(null);
      setNotice({ kind: 'success', text: message });
    } catch (error) {
      setAction(null);
      setNotice({ kind: 'error', text: error instanceof Error && error.message ? error.message : 'That change could not be saved. Refresh the list and try again.' });
      await invalidate();
    }
  };

  const counts = data?.counts;
  const countFor = (item: AccountView) => item === 'accepted' ? counts?.accepted ?? 0 : counts?.[item] ?? 0;
  const labels: Record<AccountView, string> = { pending: 'Pending', accepted: 'Accepted', denied: 'Denied', active: 'Active', inactive: 'Inactive', terminated: 'Terminated' };
  const actionTitle = !action ? '' : action.type === 'review' ? (action.status === 'accepted' ? 'Accept Admin request?' : 'Deny Admin request?')
    : action.type === 'status' ? `${action.status === 'active' ? 'Reactivate' : 'Set inactive'} access?` : 'Terminate Admin access permanently?';
  const confirmLabel = !action ? '' : action.type === 'review' ? (action.status === 'accepted' ? 'Accept request' : 'Deny request')
    : action.type === 'status' ? (action.status === 'active' ? 'Set active' : 'Set inactive') : 'Terminate permanently';

  return <Shell title="Admin accounts"><main className="page admin-accounts-page">
    <div className="admin-heading">
      <div className="section-heading-copy"><SectionHeadingIcon section="administration"/><div><div className="eyebrow">ACCESS GOVERNANCE / ADMIN WORKSPACE</div><h1>Admin accounts</h1><p>Review requests and keep every access change traceable.</p></div></div>
      <button className="btn btn-outline" onClick={() => void accountsQuery.refetch()} disabled={accountsQuery.isFetching} data-testid="button-refresh-admin-accounts"><RefreshCw size={14}/>{accountsQuery.isFetching ? 'Refreshing' : 'Refresh list'}</button>
    </div>
    <div className="admin-guardrail" data-testid="admin-account-policy-note"><span><ShieldCheck size={18}/></span><p><strong>Approval creates a scoped Owner workspace.</strong> Inactive Admins retain their accepted record but cannot access the workspace. Terminated records are retained for audit and cannot be restored here.</p></div>
    {notice && <div className={`admin-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid={`status-admin-${notice.kind}`}>{notice.text}</div>}
    {accountsQuery.isLoading ? <section className="panel admin-loading" role="status" aria-label="Loading Admin accounts" data-testid="status-admin-loading"><div className="skeleton admin-skeleton-heading"/>{[0,1,2].map(item => <div className="skeleton admin-skeleton-row" key={item}/>)}</section>
    : accountsQuery.isError ? <section className="panel admin-state" role="alert" data-testid="status-admin-error"><span className="admin-state-icon"><AlertTriangle size={21}/></span><div><h2>Could not load Admin accounts</h2><p>Access records were not changed. Check your connection and try again.</p></div><button className="btn btn-primary" onClick={() => void accountsQuery.refetch()} data-testid="button-retry-admin-accounts"><RefreshCw size={14}/>Retry</button></section>
    : <>
      <section className="admin-counts" aria-label="Admin access counts" data-testid="admin-account-counts">
        {views.map(item => <button key={item} className={`admin-count ${item} ${view === item ? 'selected' : ''}`} onClick={() => setView(item)} aria-pressed={view === item} data-testid={`view-admin-${item}`}><span className="mono">{countFor(item).toString().padStart(2, '0')}</span><span><strong>{labels[item]}</strong><small>{item === 'accepted' ? 'Active + inactive' : item === 'pending' ? 'Awaiting decision' : item === 'terminated' ? 'Retained record' : item === 'active' ? 'Workspace enabled' : item === 'inactive' ? 'Temporarily disabled' : 'Decision recorded'}</small></span></button>)}
      </section>
      <div className="admin-list-toolbar"><div><span className="eyebrow">ACCESS REGISTER</span><h2>{labels[view]} <span>{countFor(view)}</span></h2></div><label className="admin-search"><span className="sr-only">Search accounts</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, email or ID" data-testid="input-search-admin-accounts"/></label></div>
      {filtered.length === 0 ? <section className="panel admin-empty" data-testid="status-admin-empty"><div className="admin-empty-mark"><ArchiveX size={21}/></div><h2>{search ? 'No matching accounts' : view === 'pending' ? 'No requests waiting' : `No ${view} accounts`}</h2><p>{search ? 'Try a different name, email, phone or account ID.' : view === 'pending' ? 'New Admin requests will appear here for review.' : `Admin records in the ${view} view will appear here.`}</p></section>
      : <section className="admin-account-list" aria-label={`${labels[view]} Admin accounts`} data-testid="list-admin-accounts">{filtered.map(account => <AccountRow key={account.userId} account={account} busy={busy} onAction={next => { setNotice(null); setAction(next); }}/>)}</section>}
    </>}
    {action && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setAction(null); }}><section ref={dialogRef} className="dialog admin-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" data-testid="dialog-admin-confirm">
      <div className="dialog-header"><div><div className="eyebrow">{action.type === 'terminate' ? 'PERMANENT ACCESS CHANGE' : 'ADMIN ACCESS / CONFIRM'}</div><h2 id="admin-confirm-title" className="display">{actionTitle}</h2></div></div>
      <div className="dialog-body"><p><strong>{action.account.displayName}</strong> · {action.account.verifiedEmail}</p><p className="subtle">{action.type === 'terminate' ? 'This action permanently removes this Admin’s StockSense workspace access. The account record remains visible as Terminated, is excluded from Accepted, and cannot be reactivated.' : action.type === 'review' ? action.status === 'accepted' ? 'Accepting grants access to a separate Owner-scoped workspace. It does not create a shared or administrator workspace.' : 'This request will be recorded as denied. The applicant can still use ordinary Owner or Courier setup.' : action.status === 'inactive' ? 'This preserves the accepted record and audit history while disabling workspace access. You can set the account Active later.' : 'This restores this accepted Admin’s workspace access.'}</p><div className="admin-confirm-id"><UserRound size={15}/><span>Account ID</span><code>{action.account.userId}</code></div></div>
      <div className="dialog-footer"><button className="btn btn-outline" disabled={busy} onClick={() => setAction(null)} data-testid="button-cancel-admin-action">{busy ? 'Saving…' : 'Cancel'}</button><button className={`btn ${action.type === 'terminate' || (action.type === 'review' && action.status === 'denied') ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => void commitAction()} data-testid="button-confirm-admin-action">{busy ? 'Saving…' : action.type === 'review' && action.status === 'accepted' ? <><Check size={14}/>{confirmLabel}</> : action.type === 'status' && action.status === 'active' ? <><Play size={14}/>{confirmLabel}</> : action.type === 'status' && action.status === 'inactive' ? <><Pause size={14}/>{confirmLabel}</> : action.type === 'terminate' ? <><ArchiveX size={14}/>{confirmLabel}</> : <><X size={14}/>{confirmLabel}</>}</button></div>
    </section></div>}
  </main></Shell>;
}

function AccountRow({ account, busy, onAction }: { account: StocksenseAdminAccount; busy: boolean; onAction: (action: Action) => void }) {
  const terminated = account.accessStatus === 'terminated';
  const pending = account.requestStatus === 'pending';
  const status = account.accessStatus ?? account.requestStatus;
  const initials = account.displayName.trim().slice(0, 1).toUpperCase() || 'A';
  return <article className={`admin-account-card ${status}`} data-testid={`admin-account-${account.userId}`}>
    <div className="admin-account-main"><div className="admin-account-avatar" aria-hidden="true">{initials}</div><div className="admin-account-info">
      <div className="admin-account-title"><h3 data-testid={`admin-name-${account.userId}`}>{account.displayName}</h3><span className={`admin-status ${status}`} data-testid={`admin-status-${account.userId}`}><i/>{status === 'accepted' ? 'Accepted' : status}</span></div>
      <div className="admin-contact"><span><Mail size={13}/>{account.verifiedEmail}</span><span><span className="admin-phone-dot" aria-hidden="true"/> {account.phone}</span></div>
      <div className="admin-meta"><span><Clock3 size={12}/>{pending ? 'Requested' : 'Request'} {dateTime(account.requestedAt)}</span><span className="admin-id">Account ID · {account.userId}</span></div>
    </div><div className="admin-actions">
      {pending ? <><button className="btn btn-outline" disabled={busy} onClick={() => onAction({ type: 'review', account, status: 'denied' })} data-testid={`button-deny-admin-${account.userId}`}><X size={14}/>Deny</button><button className="btn btn-primary" disabled={busy} onClick={() => onAction({ type: 'review', account, status: 'accepted' })} data-testid={`button-accept-admin-${account.userId}`}><Check size={14}/>Accept</button></>
      : account.accessStatus === 'active' ? <><button className="btn btn-outline admin-inactive-action" disabled={busy} onClick={() => onAction({ type: 'status', account, status: 'inactive' })} data-testid={`button-inactivate-admin-${account.userId}`}><Pause size={14}/>Set inactive</button><button className="btn btn-danger admin-terminate-action" disabled={busy} onClick={() => onAction({ type: 'terminate', account })} data-testid={`button-terminate-admin-${account.userId}`}><ArchiveX size={14}/>Terminate</button></>
      : account.accessStatus === 'inactive' ? <><button className="btn btn-primary" disabled={busy} onClick={() => onAction({ type: 'status', account, status: 'active' })} data-testid={`button-activate-admin-${account.userId}`}><Play size={14}/>Set active</button><button className="btn btn-danger admin-terminate-action" disabled={busy} onClick={() => onAction({ type: 'terminate', account })} data-testid={`button-terminate-admin-${account.userId}`}><ArchiveX size={14}/>Terminate</button></>
      : terminated ? <span className="admin-no-actions" data-testid={`admin-no-actions-${account.userId}`}>Record retained · no actions</span> : null}
    </div></div>
    <div className="admin-audit" data-testid={`admin-audit-${account.userId}`}><span>{account.requestStatus === 'accepted' ? 'Accepted' : account.requestStatus === 'denied' ? 'Denied' : 'Awaiting review'}</span><span>Reviewed {dateTime(account.reviewedAt)} · {account.reviewedByUserId || 'Reviewer unavailable'}</span>{account.accessStatus && <span>Access changed {dateTime(account.accessChangedAt)} · {account.accessChangedByUserId || 'Not recorded'}</span>}{terminated && <span className="admin-terminated-audit">Terminated {dateTime(account.terminatedAt)} · {account.terminatedByUserId || 'Not recorded'}</span>}</div>
  </article>;
}