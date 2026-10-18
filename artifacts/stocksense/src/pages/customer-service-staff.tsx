import { useMemo, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Send, Hand, RefreshCw, MessageCircle, LockKeyhole, UserRound } from 'lucide-react';
import {
  useGetStocksenseSupportAccess,
  useListStocksenseSupportStaffTickets,
  useClaimStocksenseSupportTicket,
  useCreateStocksenseSupportStaffMessage,
  useGetStocksenseSupportStaffSummary,
  getGetStocksenseSupportAccessQueryKey,
  getListStocksenseSupportTicketsQueryKey,
  getListStocksenseSupportStaffTicketsQueryKey,
  getGetStocksenseSupportStaffSummaryQueryKey,
} from '@workspace/api-client-react';
import type { StocksenseSupportStaffTicket } from '@workspace/api-client-react';
import { SectionHeadingIcon, Shell, QueryError, Empty } from '../components/common';

const dateTime = (v: string | null | undefined) => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';

export default function CustomerServiceStaffPage() {
  const { user } = useUser();
  const access = useGetStocksenseSupportAccess({
    query: {
      queryKey: getGetStocksenseSupportAccessQueryKey(),
      refetchInterval: 20000,
      refetchOnWindowFocus: true,
    },
  });
  const approved = access.data?.status === 'approved';
  const profileComplete = !!access.data?.profileComplete && !!access.data?.displayName?.trim() && !!access.data?.phone;
  const staffEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? '';
  const canLoadStaffData = !access.isLoading && !access.isFetching && !access.isError && approved && profileComplete;
  const ticketsQuery = useListStocksenseSupportStaffTickets({ query: { queryKey: getListStocksenseSupportStaffTicketsQueryKey(), enabled: canLoadStaffData, refetchInterval: 20000, refetchOnWindowFocus: true } });
  const summaryQuery = useGetStocksenseSupportStaffSummary({ query: { queryKey: getGetStocksenseSupportStaffSummaryQueryKey(), enabled: canLoadStaffData, refetchInterval: 45000, refetchOnWindowFocus: true } });
  const claim = useClaimStocksenseSupportTicket();
  const addMessage = useCreateStocksenseSupportStaffMessage();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'mine'>('all');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const allTickets = ticketsQuery.data ?? [];
  const visible = useMemo(() => allTickets.filter(t => {
    if (filter === 'open') return t.status === 'open';
    if (filter === 'mine') return !!staffEmail && t.assignee?.email.toLowerCase() === staffEmail;
    return true;
  }), [allTickets, filter, staffEmail]);
  const active = visible.find(t => t.id === selectedId) ?? visible[0] ?? null;
  const myAssignment = !!active && !!staffEmail && active.assignee?.email.toLowerCase() === staffEmail;
  const sendable = myAssignment && active?.status === 'open' && !!profileComplete;

  const refreshTickets = async () => Promise.all([
    qc.invalidateQueries({ queryKey: getListStocksenseSupportStaffTicketsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListStocksenseSupportTicketsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetStocksenseSupportStaffSummaryQueryKey() }),
  ]);
  const onClaim = async (ticket: StocksenseSupportStaffTicket) => {
    setError(''); setSuccess('');
    try {
      await claim.mutateAsync({ id: ticket.id });
      await refreshTickets();
      setSuccess(`Ticket CS-${ticket.id} is now assigned to you.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'This ticket could not be claimed. Refresh the queue and try again.'); }
  };
  const onReply = async (e: FormEvent) => {
    e.preventDefault(); if (!active || !sendable || !reply.trim()) return;
    setError(''); setSuccess('');
    try {
      await addMessage.mutateAsync({ id: active.id, data: { message: reply.trim() } });
      setReply(''); await refreshTickets(); setSuccess('Reply sent.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Reply could not be sent. Check that the ticket is still assigned to you.'); }
  };

  const accessLoading = access.isLoading;
  const accessError = access.isError;
  const paused = !accessLoading && !accessError && access.data?.status === 'paused';
  const denied = !accessLoading && !accessError && !paused && (!approved || !profileComplete);

  return <Shell title="Customer service"><main className="page support-page">
    <div className="support-heading">
      <div className="section-heading-copy"><SectionHeadingIcon section="customerService"/><div><div className="eyebrow">{paused ? 'CUSTOMER AGENT ACCESS / INACTIVE' : 'APPROVED STAFF / SHARED QUEUE'}</div><h1 className={paused ? 'support-access-status-title' : undefined}>{paused ? 'INACTIVE' : 'Support desk'}</h1><p>{paused ? 'You can still sign in, but you cannot use the StockSense Customer Agent portal while access is inactive.' : 'Claim open cases, keep the conversation moving, and leave resolution to the owner.'}</p></div></div>
      {canLoadStaffData && <div className="support-summary" data-testid="summary-tickets-solved"><span className="support-summary-number">{summaryQuery.isLoading ? '—' : summaryQuery.data?.solvedCount ?? 0}</span><span className="support-summary-label">Tickets<br/>I solved</span></div>}
    </div>
    {canLoadStaffData && summaryQuery.isError && <div className="support-alert" role="alert" data-testid="status-staff-summary-error">Your solved-ticket count could not load. <button className="btn btn-outline" onClick={() => void summaryQuery.refetch()} data-testid="button-retry-solved-count">Retry count</button></div>}
    {accessLoading && <section className="panel support-spinner-skeleton" role="status" aria-label="Checking support access"><div className="support-skel-row" style={{height:90}}/><div className="support-skel-row"/></section>}
    {accessError && <QueryError retry={() => void access.refetch()}/>}
    {paused && <section className="panel panel-pad support-access-paused" data-testid="support-access-paused" role="status">
      <span className="support-paused-mark"><LockKeyhole size={19}/></span>
      <div><div className="eyebrow">CUSTOMER AGENT PORTAL / INACTIVE</div><h2 className="display">Portal access paused</h2>
        <p>An administrator paused your StockSense Customer Agent access. The portal and shared ticket queue are unavailable until access is restored.</p>
        <p className="support-paused-scope">Your accepted status is preserved. This pause applies only to the StockSense support queue; it does not change your Delivery access.</p>
      </div>
    </section>}
    {denied && <section className="panel panel-pad" data-testid="support-access-denied">
      {access.data?.status === 'pending' ? <><div className="support-assignee-mark"><LockKeyhole size={18}/></div><h2 className="display" style={{fontSize:22}}>Awaiting approval</h2><p className="subtle" style={{fontSize:13,lineHeight:1.6}}>Your customer service access request is under review. The shared queue stays unavailable until an administrator approves it.</p><button className="btn btn-outline" onClick={() => void access.refetch()} data-testid="button-refresh-access"><RefreshCw size={14}/>Check approval</button></>
        : access.data?.status === 'approved' ? <><div className="support-staff-profile-alert" role="alert">Your approved staff profile is missing contact details. The shared queue remains unavailable until an administrator completes your staff profile.</div><button className="btn btn-outline" onClick={() => void access.refetch()} data-testid="button-refresh-incomplete-profile"><RefreshCw size={14}/>Check profile</button></>
         : access.data?.status === 'denied' ? <><h2 className="display" style={{fontSize:22}}>Access request denied</h2><p className="subtle" style={{fontSize:13,lineHeight:1.6}}>This shared queue remains unavailable. You may review your details and submit a new request.</p><Link className="btn btn-outline" href="/onboarding" data-testid="link-staff-request-again">Review or request access again</Link></>
         : <><h2 className="display" style={{fontSize:22}}>Staff access required</h2><p className="subtle" style={{fontSize:13,lineHeight:1.6}}>This shared ticket queue is only available to administrator-approved customer service staff.</p><Link className="btn btn-outline" href="/onboarding" data-testid="link-staff-onboarding">Request access</Link></>}
    </section>}
    {canLoadStaffData && <>
      {error && <div className="support-alert" role="alert" data-testid="status-staff-error">{error}</div>}
      {success && <div className="support-success" role="status" data-testid="status-staff-success">{success}</div>}
      <div className="support-toolbar">
        <span className="support-count">{allTickets.length} cases in shared queue</span>
        <div style={{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap'}}>
          <select className="field support-filter" value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setSelectedId(null); }} aria-label="Filter tickets" data-testid="select-ticket-filter"><option value="all">All tickets</option><option value="open">Open tickets</option><option value="mine">Assigned to me</option></select>
          <button className="btn btn-outline" onClick={() => void ticketsQuery.refetch()} disabled={ticketsQuery.isFetching} data-testid="button-refresh-staff-queue"><RefreshCw size={14}/>{ticketsQuery.isFetching ? 'Refreshing' : 'Refresh queue'}</button>
        </div>
      </div>
      {ticketsQuery.isLoading ? <div className="support-layout"><section className="panel support-spinner-skeleton" role="status" aria-label="Loading ticket queue">{[0,1,2,3].map(n=><div key={n} className="support-skel-row"/>)}</section><section className="panel support-spinner-skeleton"><div className="support-skel-row" style={{height:80}}/><div className="support-skel-row" style={{height:230}}/></section></div>
      : ticketsQuery.isError ? <QueryError retry={() => void ticketsQuery.refetch()}/>
      : visible.length === 0 ? <section className="panel"><Empty title={filter === 'mine' ? 'No cases assigned to you' : 'Queue is clear'} description={filter === 'mine' ? 'Claim an open case to take ownership of the conversation.' : 'New owner requests will appear here.'}/></section>
      : <div className="support-layout">
        <section className="panel support-list" aria-label="Shared ticket queue">
          <div className="support-list-head"><strong>Ticket queue</strong><span className="support-count">{visible.length} shown</span></div>
          {visible.map(t => <button key={t.id} className={`support-ticket-row ${active?.id === t.id ? 'selected' : ''}`} onClick={() => { setSelectedId(t.id); setReply(''); setError(''); setSuccess(''); }} data-testid={`staff-ticket-select-${t.id}`} aria-pressed={active?.id === t.id}>
            <div className="support-ticket-row-top"><span className="support-ticket-id">CS-{t.id}</span><span className={`support-badge ${t.status}`}>{t.status === 'closed' ? 'Resolved' : 'Open'}</span></div>
            <strong>{t.subject}</strong>
            <small>{t.assignee ? `Assigned · ${t.assignee.displayName}` : 'Unassigned'} · {dateTime(t.messages.at(-1)?.createdAt ?? t.createdAt)}</small>
          </button>)}
        </section>
        <section className="panel support-detail" aria-label="Selected support conversation">
          {active ? <>
            <header className="support-detail-head"><div><div className="support-ticket-id">TICKET CS-{active.id}</div><h2>{active.subject}</h2><div className="support-detail-meta">Opened {dateTime(active.createdAt)}</div></div><span className={`support-badge ${active.status}`}>{active.status === 'closed' ? 'Resolved' : 'Open'}</span></header>
            <div className="support-assignee" data-testid={`ticket-assignee-${active.id}`}><span className="support-assignee-mark"><UserRound size={16}/></span><div><strong>{active.assignee ? (myAssignment ? 'Assigned to you' : `Assigned to ${active.assignee.displayName}`) : 'Unassigned ticket'}</strong><small>{active.assignee?.email ?? 'Claim to take this conversation'}</small></div></div>
            <div className="support-thread" data-testid="staff-support-conversation">
              {(active.messages.length ? active.messages : [{ id:-1, sender:'customer' as const, message:active.message, createdAt:null }]).map(m=><article key={m.id} className={`support-message ${m.sender === 'staff' ? 'staff' : ''}`} data-testid={`staff-message-${m.id}`}><div className="support-message-meta"><span>{m.sender === 'staff' ? (myAssignment ? 'Support · you' : 'Customer service') : 'Owner'}</span><span>{dateTime(m.createdAt)}</span></div><p>{m.message}</p></article>)}
            </div>
            {active.status === 'open' && !active.assignee && <div className="support-reply"><p className="support-composer-note">This case is open to claim. Claiming assigns it to your approved staff profile.</p><button className="btn btn-primary support-claim" onClick={() => void onClaim(active)} disabled={!profileComplete || claim.isPending} data-testid={`button-claim-ticket-${active.id}`}><Hand size={14}/>{claim.isPending ? 'Claiming…' : 'Take this ticket'}</button></div>}
            {active.status === 'open' && active.assignee && myAssignment && <form className="support-reply" onSubmit={onReply}>
              <label className="field-group"><span className="label">Reply to owner</span><textarea className="field" maxLength={4000} value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a clear next step…" data-testid="input-staff-reply"/></label>
              <div className="support-reply-actions"><small>{reply.length}/4000 · Only your assigned cases can be replied to.</small><button type="submit" className="btn btn-primary" disabled={!reply.trim() || addMessage.isPending} data-testid="button-send-staff-reply"><Send size={14}/>{addMessage.isPending ? 'Sending…' : 'Send reply'}</button></div>
            </form>}
            {active.status === 'closed' && <div className="support-reply"><p className="support-composer-note">This case is resolved. Owners confirm resolution; staff cannot change ticket status.</p></div>}
            {active.status === 'open' && active.assignee && !myAssignment && <div className="support-reply"><p className="support-composer-note">This ticket belongs to its assigned staff member. You can read the thread but cannot reply or change its status.</p></div>}
          </> : <div className="support-empty-detail"><div><MessageCircle size={30}/><h3>Select a case</h3><p>Choose a ticket to review its conversation.</p></div></div>}
        </section>
      </div>}
    </>}
  </main></Shell>;
}