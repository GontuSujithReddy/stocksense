import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AlertTriangle, Check, Clock3, Mail, Pause, Phone, Play, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react';
import {
  getGetStocksenseSupportStaffSummaryQueryKey,
  getGetStocksenseSupportAccessQueryKey,
  getListStocksenseSupportAccessRequestsQueryKey,
  getListStocksenseSupportStaffTicketsQueryKey,
  useListStocksenseSupportAccessRequests,
  useReviewStocksenseSupportAccessRequest,
  useSetStocksenseSupportAccessPaused,
} from '@workspace/api-client-react';
import type { StocksenseSupportAccessRequest } from '@workspace/api-client-react';
import { SectionHeadingIcon, Shell } from '../components/common';

type RequestView = 'pending' | 'accepted' | 'denied' | 'paused';
type Decision = 'approved' | 'denied';
type RequestAction =
  | { type: 'decision'; request: StocksenseSupportAccessRequest; status: Decision }
  | { type: 'pause'; request: StocksenseSupportAccessRequest; paused: boolean };
const EMPTY_REQUESTS: StocksenseSupportAccessRequest[] = [];
const isPaused = (request: StocksenseSupportAccessRequest) => request.status === 'approved' && !!request.pausedAt;

const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'Not recorded';

const errorStatus = (error: unknown) => {
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; response?: { status?: unknown }; message?: unknown };
    const status = candidate.status ?? candidate.response?.status;
    if (status !== undefined) return Number(status);
    if (typeof candidate.message === 'string') {
      const match = candidate.message.match(/\b(403|409)\b/);
      if (match) return Number(match[1]);
    }
  }
  return undefined;
};

function RequestCard({
  request, view, busy, onAction,
}: {
  request: StocksenseSupportAccessRequest;
  view: RequestView;
  busy: boolean;
  onAction: (action: RequestAction) => void;
}) {
  const pending = request.status === 'pending';
  const initials = (request.displayName || request.verifiedEmail || 'S').trim().slice(0, 1).toUpperCase();
  const acceptedOrPaused = view === 'accepted' || view === 'paused';
  return <article className={`review-card ${pending ? 'is-pending' : `is-${view}`}`} data-testid={`request-card-${request.userId}`}>
    <div className="review-card-main">
      <div className="review-person-mark" aria-hidden="true">{initials}</div>
      <div className="review-person">
        <div className="review-person-title">
          <h2 data-testid={`request-name-${request.userId}`}>{request.displayName?.trim() || 'Name not provided'}</h2>
          <span className={`review-status ${view}`} data-testid={`request-status-${request.userId}`}><i />{view}</span>
        </div>
        <div className="review-contact">
          <span><Mail size={13} aria-hidden="true"/>{request.verifiedEmail || 'Verified email unavailable'}</span>
          <span><Phone size={13} aria-hidden="true"/>{request.phone || 'Phone not provided'}</span>
        </div>
        <div className="review-meta">
          <span><Clock3 size={12} aria-hidden="true"/>Requested {dateTime(request.requestedAt)}</span>
          <span className="review-user-id">Account ID · {request.userId}</span>
          {acceptedOrPaused && <span className="review-tickets" data-testid={`tickets-replied-${request.userId}`}><Check size={12} aria-hidden="true"/><strong>{request.ticketsReviewed}</strong> Tickets replied to</span>}
        </div>
      </div>
      <div className="review-card-actions">
        {pending ? <>
          <button className="btn btn-outline review-deny" disabled={busy} onClick={() => onAction({ type: 'decision', request, status: 'denied' })} data-testid={`button-deny-${request.userId}`}><X size={14}/>Deny</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onAction({ type: 'decision', request, status: 'approved' })} data-testid={`button-approve-${request.userId}`}><Check size={14}/>Approve</button>
        </> : view === 'accepted' ? <button className="btn btn-outline review-pause" disabled={busy} onClick={() => onAction({ type: 'pause', request, paused: true })} data-testid={`button-pause-${request.userId}`}><Pause size={14}/>Pause access</button>
        : view === 'paused' ? <button className="btn btn-primary review-reactivate" disabled={busy} onClick={() => onAction({ type: 'pause', request, paused: false })} data-testid={`button-reactivate-${request.userId}`}><Play size={14}/>Reactivate</button>
        : null}
      </div>
    </div>
    {!pending && <div className="review-audit" data-testid={`review-metadata-${request.userId}`}>
      <span>{request.status === 'approved' ? 'Accepted' : 'Denied'}</span>
      <span>Reviewed {dateTime(request.reviewedAt)}</span>
      <span>Reviewer ID · {request.reviewedByUserId || 'Unavailable'}</span>
    </div>}
    {acceptedOrPaused && <div className="review-ticket-definition">Distinct support tickets with at least one reply from this member.</div>}
    {view === 'paused' && <div className="review-paused-meta" data-testid={`paused-metadata-${request.userId}`}>Paused {dateTime(request.pausedAt)} · Administrator ID {request.pausedByUserId || 'unavailable'}</div>}
    {request.notificationSentAt && <div className="review-notice" data-testid={`notification-sent-${request.userId}`}><Mail size={12}/>Administrator notified {dateTime(request.notificationSentAt)}</div>}
  </article>;
}

export default function CustomerServiceAccessRequestsPage() {
  const queryKey = getListStocksenseSupportAccessRequestsQueryKey();
  const requestsQuery = useListStocksenseSupportAccessRequests({
    query: { queryKey, refetchInterval: 30000, refetchOnWindowFocus: true },
  });
  const reviewMutation = useReviewStocksenseSupportAccessRequest();
  const pauseMutation = useSetStocksenseSupportAccessPaused();
  const queryClient = useQueryClient();
  const [selectedView, setSelectedView] = useState<RequestView>('pending');
  const [confirmation, setConfirmation] = useState<RequestAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const requests = requestsQuery.data ?? EMPTY_REQUESTS;
  const groups = useMemo(() => ({
    pending: requests.filter(request => request.status === 'pending'),
    accepted: requests.filter(request => request.status === 'approved' && !request.pausedAt),
    denied: requests.filter(request => request.status === 'denied'),
    paused: requests.filter(isPaused),
  }), [requests]);
  const viewLabels: Record<RequestView, string> = { pending: 'Pending', accepted: 'Accepted', denied: 'Denied', paused: 'Paused' };
  const visible = groups[selectedView];
  const busy = reviewMutation.isPending || pauseMutation.isPending;

  const invalidateAccessViews = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey }),
    queryClient.invalidateQueries({ queryKey: getGetStocksenseSupportAccessQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListStocksenseSupportStaffTicketsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetStocksenseSupportStaffSummaryQueryKey() }),
  ]);

  const commitAction = async () => {
    if (!confirmation) return;
    const request = confirmation.request;
    setNotice(null);
    try {
      const saved = confirmation.type === 'decision'
        ? await reviewMutation.mutateAsync({ userId: request.userId, data: { status: confirmation.status } })
        : await pauseMutation.mutateAsync({ userId: request.userId, data: { paused: confirmation.paused } });
      queryClient.setQueryData<StocksenseSupportAccessRequest[]>(queryKey, old =>
        old?.map(item => item.userId === saved.userId ? saved : item) ?? [saved]);
      await invalidateAccessViews();
      setConfirmation(null);
      const description = confirmation.type === 'decision'
        ? `${saved.displayName?.trim() || saved.verifiedEmail || 'Request'} marked ${saved.status}. The decision is recorded.`
        : `${saved.displayName?.trim() || saved.verifiedEmail || 'Member'} support access ${confirmation.paused ? 'paused' : 'reactivated'}. Their accepted status is preserved.`;
      setNotice({ kind: 'success', text: description });
    } catch (error) {
      const statusCode = errorStatus(error);
      setConfirmation(null);
      if (statusCode === 409) {
        setNotice({ kind: 'error', text: 'This access state changed elsewhere. The current list has been refreshed.' });
        await invalidateAccessViews();
      } else if (statusCode === 403) {
        setNotice({ kind: 'error', text: 'Administrator access is required to review these requests.' });
      } else {
        setNotice({ kind: 'error', text: error instanceof Error && error.message ? error.message : 'The decision was not saved. Refresh the list and try again.' });
      }
    }
  };

  const statusCode = errorStatus(requestsQuery.error);
  const confirmationTitle = !confirmation ? '' : confirmation.type === 'decision'
    ? confirmation.status === 'approved' ? 'Approve access?' : 'Deny access?'
    : confirmation.paused ? 'Pause support access?' : 'Reactivate support access?';
  return <Shell title="Access review"><main className="page support-page access-review-page">
    <div className="support-heading">
      <div className="section-heading-copy"><SectionHeadingIcon section="supportReview"/><div>
        <div className="eyebrow">ADMINISTRATOR WORKFLOW / PRIVATE ACCESS</div>
        <h1>Support access review</h1>
        <p>Verify each application before granting access to owners’ private cases.</p>
      </div></div>
      <button className="btn btn-outline" onClick={() => void requestsQuery.refetch()} disabled={requestsQuery.isFetching} data-testid="button-refresh-access-requests">
        <RefreshCw size={14}/>{requestsQuery.isFetching ? 'Refreshing' : 'Refresh list'}
      </button>
    </div>

    <div className="review-guardrail" data-testid="review-privacy-note">
      <span><ShieldCheck size={18}/></span>
      <p><strong>Access controls protect private customer conversations.</strong> Verify each applicant’s identity before approval. Pausing blocks only the StockSense support queue; it does not remove acceptance or change Delivery access.</p>
      <Link href="/customer-service" className="review-owner-link" data-testid="link-owner-customer-service">Owner support</Link>
    </div>

    {notice && <div className={`support-${notice.kind === 'error' ? 'alert' : 'success'} review-notice-banner`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid={`status-review-${notice.kind}`}>{notice.text}</div>}

    {requestsQuery.isLoading ? <section className="panel review-loading" role="status" aria-label="Loading access requests" data-testid="status-review-loading">
      <div className="review-skeleton-heading skeleton"/>{[0, 1, 2].map(index => <div className="review-skeleton-row skeleton" key={index}/>)}
    </section> : requestsQuery.isError ? statusCode === 403 ? <section className="panel review-state" role="alert" data-testid="status-review-denied">
      <span className="review-state-icon denied"><LockIcon/></span><div><h2>Administrator access required</h2><p>This review queue is restricted. Your account cannot view or change access requests.</p><p className="subtle">No requester details have been loaded.</p></div>
      <button className="btn btn-outline" onClick={() => void requestsQuery.refetch()} data-testid="button-retry-access-review"><RefreshCw size={14}/>Try again</button>
    </section> : <section className="panel review-state" role="alert" data-testid="status-review-error">
      <span className="review-state-icon"><AlertTriangle size={21}/></span><div><h2>Could not load the review queue</h2><p>Requests remain unchanged. Check your connection and try again.</p></div>
      <button className="btn btn-primary" onClick={() => void requestsQuery.refetch()} data-testid="button-retry-access-review"><RefreshCw size={14}/>Retry</button>
    </section> : <>
      <div className="review-summary">
        {(['pending', 'accepted', 'denied', 'paused'] as RequestView[]).map(view => <button key={view} className={`review-count ${selectedView === view ? 'selected' : ''} ${view}`} onClick={() => setSelectedView(view)} aria-pressed={selectedView === view} data-testid={`view-requests-${view}`}>
          <span className="mono">{groups[view].length.toString().padStart(2, '0')}</span><span className="review-count-copy"><strong>{viewLabels[view]}</strong><small>{view === 'accepted' ? 'Active approved' : view === 'pending' ? 'Awaiting decision' : view === 'paused' ? 'Temporarily inactive' : 'Decision recorded'}</small></span>
        </button>)}
        <div className="review-auto-note"><span className="review-live-dot"/>Updates every 30 seconds</div>
      </div>
      <div className="review-view-heading">
        <div><span className="eyebrow">ACCESS APPLICATIONS</span><h2>{viewLabels[selectedView]} <span>{groups[selectedView].length}</span></h2></div>
        <p data-testid="text-review-count">{visible.length} {visible.length === 1 ? 'member' : 'members'}</p>
      </div>
      {visible.length === 0 ? <section className="panel review-empty" data-testid="status-review-empty">
        <span className="review-empty-icon"><Check size={21}/></span>
        <h2>{requests.length === 0 ? 'No applications yet' : selectedView === 'pending' ? 'All caught up' : `No ${viewLabels[selectedView].toLowerCase()} members`}</h2>
        <p>{requests.length === 0 ? 'New support access applications will appear here.' : selectedView === 'pending' ? 'There are no pending applications. New requests will appear automatically.' : `Members in the ${viewLabels[selectedView].toLowerCase()} view will appear here.`}</p>
      </section> : <section className="review-list" aria-label="Support access applications" data-testid="list-access-requests">
        {visible.map(request => <RequestCard key={request.userId} request={request} view={selectedView} busy={busy} onAction={action => { setNotice(null); setConfirmation(action); }}/>)}
      </section>}
    </>}

    {confirmation && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setConfirmation(null); }}>
      <section className="dialog review-confirm" role="alertdialog" aria-modal="true" aria-labelledby="review-confirm-title" data-testid="dialog-review-confirm">
        <div className="dialog-header"><div><div className="eyebrow">{confirmation.type === 'decision' ? 'REVIEW DECISION / CONFIRM' : 'SUPPORT ACCESS / CONFIRM'}</div><h2 id="review-confirm-title" className="display">{confirmationTitle}</h2></div></div>
        <div className="dialog-body">
          <p><strong>{confirmation.request.displayName?.trim() || 'Name not provided'}</strong>{confirmation.request.verifiedEmail ? ` · ${confirmation.request.verifiedEmail}` : ''}</p>
          <p className="subtle">{confirmation.type === 'decision'
            ? confirmation.status === 'approved' ? 'This account will be allowed to access StockSense owner support cases. Delivery access is not changed.' : 'This application will be recorded as denied. The requester may submit a new request later.'
            : confirmation.paused ? 'This blocks access to the StockSense support queue only. Their accepted status, review history, ticket replies, and existing ticket assignments are preserved. Assigned tickets will remain theirs and can be handled after reactivation. Delivery access is unchanged.'
              : 'This restores access to the StockSense support queue. The member’s accepted status and review history remain unchanged.'}</p>
          <div className="review-confirm-identity"><UserRound size={15}/><span>Account ID</span><code>{confirmation.request.userId}</code></div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-outline" disabled={busy} onClick={() => setConfirmation(null)} data-testid="button-cancel-review">{busy ? 'Saving…' : 'Cancel'}</button>
          <button className={`btn ${confirmation.type === 'decision' && confirmation.status === 'denied' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => void commitAction()} data-testid="button-confirm-review">
            {busy ? 'Saving…' : confirmation.type === 'decision'
              ? confirmation.status === 'approved' ? <><Check size={14}/>Confirm approval</> : <><X size={14}/>Confirm denial</>
            : confirmation.paused ? <><Pause size={14}/>Confirm pause</> : <><Play size={14}/>Confirm reactivation</>}
          </button>
        </div>
      </section>
    </div>}
  </main></Shell>;
}

function LockIcon() {
  return <ShieldCheck size={21}/>;
}