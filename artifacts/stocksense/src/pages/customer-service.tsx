import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, ShieldCheck, Plus, CheckCircle2, RefreshCw } from 'lucide-react';
import { Redirect } from 'wouter';
import {
  useGetStocksenseSupportAccess,
  useListStocksenseSupportTickets,
  useCreateStocksenseSupportTicket,
  useCreateStocksenseSupportOwnerMessage,
  useConfirmStocksenseSupportResolved,
  getListStocksenseSupportTicketsQueryKey,
  getListStocksenseSupportStaffTicketsQueryKey,
  getGetStocksenseSupportStaffSummaryQueryKey,
} from '@workspace/api-client-react';
import type { StocksenseSupportMessage } from '@workspace/api-client-react';
import { SectionHeadingIcon, Shell, QueryError, Empty, Modal, Field } from '../components/common';

const dateTime = (v: string | null | undefined) => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';
const invalidateSupport = async (qc: ReturnType<typeof useQueryClient>) => Promise.all([
  qc.invalidateQueries({ queryKey: getListStocksenseSupportTicketsQueryKey() }),
  qc.invalidateQueries({ queryKey: getListStocksenseSupportStaffTicketsQueryKey() }),
  qc.invalidateQueries({ queryKey: getGetStocksenseSupportStaffSummaryQueryKey() }),
]);

function MessageThread({ messages, initial, perspective }: { messages: StocksenseSupportMessage[]; initial: string; perspective: 'owner' | 'staff' }) {
  const ordered = messages.length ? messages : [{ id: -1, sender: 'customer' as const, message: initial, createdAt: null }];
  return <div className="support-thread" data-testid="support-conversation">
    {ordered.map((m) => {
      const own = perspective === 'owner' ? m.sender === 'customer' : m.sender === 'staff';
      return <article key={m.id} className={`support-message ${own ? (perspective === 'owner' ? 'customer' : 'staff') : ''}`} data-testid={`message-${m.id}`}>
        <div className="support-message-meta"><span>{m.sender === 'customer' ? 'You' : 'Customer service'}</span><span>{dateTime(m.createdAt)}</span></div>
        <p>{m.message}</p>
      </article>;
    })}
  </div>;
}

export default function CustomerServicePage() {
  const access = useGetStocksenseSupportAccess();
  const canLoadOwnerTickets = !access.isLoading && !access.isFetching && !access.isError && access.data?.status !== 'approved';
  const ticketsQuery = useListStocksenseSupportTickets({ query: { queryKey: getListStocksenseSupportTicketsQueryKey(), enabled: canLoadOwnerTickets, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const createTicket = useCreateStocksenseSupportTicket();
  const addMessage = useCreateStocksenseSupportOwnerMessage();
  const resolveTicket = useConfirmStocksenseSupportResolved();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composer, setComposer] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const tickets = ticketsQuery.data ?? [];
  const active = useMemo(() => tickets.find(t => t.id === selectedId) ?? tickets[0] ?? null, [tickets, selectedId]);

  if (access.data?.status === 'approved') return <Redirect to="/customer-service/staff" />;

  const resetNotice = () => { setError(''); setSuccess(''); };
  const onCreate = async (e: FormEvent) => {
    e.preventDefault(); resetNotice();
    const cleanSubject = subject.trim(), cleanDescription = description.trim();
    if (!cleanSubject || !cleanDescription) return;
    try {
      const created = await createTicket.mutateAsync({ data: { subject: cleanSubject, message: cleanDescription } });
      await invalidateSupport(qc);
      setSelectedId(created.id); setSubject(''); setDescription(''); setCreating(false);
      setSuccess('Your ticket is in the queue. You can follow every reply here.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Ticket could not be created. Try again.'); }
  };
  const onReply = async (e: FormEvent) => {
    e.preventDefault(); if (!active || !composer.trim() || active.status !== 'open') return;
    resetNotice();
    try {
      await addMessage.mutateAsync({ id: active.id, data: { message: composer.trim() } });
      setComposer(''); await invalidateSupport(qc); setSuccess('Reply sent.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Reply could not be sent. Try again.'); }
  };
  const onResolve = async () => {
    if (!active || !active.assignedStaff || active.status !== 'open') return;
    resetNotice();
    try {
      await resolveTicket.mutateAsync({ id: active.id });
      setConfirmResolve(false); await invalidateSupport(qc); setSuccess('Ticket marked resolved. Thanks for confirming.');
    } catch (err) { setError(err instanceof Error ? err.message : 'We could not confirm this resolution. Try again.'); }
  };

  return <Shell title="Customer service"><main className="page support-page">
    <div className="support-heading">
      <div className="section-heading-copy"><SectionHeadingIcon section="customerService"/><div><div className="eyebrow">OWNER WORKSPACE / PRIVATE THREADS</div><h1>Customer service</h1><p>Get help with StockSense. Only you can see your ticket history.</p></div></div>
      <button className="btn btn-primary" onClick={() => { resetNotice(); setCreating(true); }} data-testid="button-create-ticket"><Plus size={15}/>New ticket</button>
    </div>
    {error && <div className="support-alert" role="alert" data-testid="status-support-error">{error}</div>}
    {success && <div className="support-success" role="status" data-testid="status-support-success">{success}</div>}
    <div className="support-toolbar"><span className="support-count">{tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} · private to your account</span><button className="btn btn-outline" onClick={() => void ticketsQuery.refetch()} disabled={ticketsQuery.isFetching} data-testid="button-refresh-tickets"><RefreshCw size={14}/>{ticketsQuery.isFetching ? 'Refreshing' : 'Refresh'}</button></div>
    {access.isLoading ? <div className="support-layout" role="status" aria-label="Checking support access"><section className="panel support-spinner-skeleton"><div className="support-skel-row"/><div className="support-skel-row"/></section><section className="panel support-spinner-skeleton"><div className="support-skel-row" style={{height:80}}/><div className="support-skel-row" style={{height:230}}/></section></div>
    : access.isError ? <QueryError retry={() => void access.refetch()}/>
    : ticketsQuery.isLoading ? <div className="support-layout"><section className="panel support-spinner-skeleton" aria-label="Loading tickets" role="status">{[0,1,2,3].map(n=><div key={n} className="support-skel-row"/>)}</section><section className="panel support-spinner-skeleton"><div className="support-skel-row" style={{height:80}}/><div className="support-skel-row" style={{height:230}}/></section></div>
    : ticketsQuery.isError ? <QueryError retry={() => void ticketsQuery.refetch()}/>
    : tickets.length === 0 ? <section className="panel"><Empty title="No tickets yet" description="Start a private conversation with our customer service team." action={<button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="button-first-ticket"><Plus size={14}/>Create a ticket</button>}/></section>
    : <div className="support-layout">
      <section className="panel support-list" aria-label="Your tickets">
        <div className="support-list-head"><strong>Your tickets</strong><span className="support-count">{tickets.length} total</span></div>
        {tickets.map(t => <button key={t.id} className={`support-ticket-row ${active?.id === t.id ? 'selected' : ''}`} onClick={() => { setSelectedId(t.id); setConfirmResolve(false); resetNotice(); }} data-testid={`ticket-select-${t.id}`} aria-pressed={active?.id === t.id}>
          <div className="support-ticket-row-top"><span className="support-ticket-id">CS-{t.id}</span><span className={`support-badge ${t.status}`}>{t.status === 'closed' ? 'Resolved' : 'Open'}</span></div>
          <strong>{t.subject}</strong><small>Updated {dateTime(t.messages.at(-1)?.createdAt ?? t.createdAt)}</small>
        </button>)}
      </section>
      <section className="panel support-detail" aria-label="Selected ticket conversation">
        {active ? <>
          <header className="support-detail-head"><div><div className="support-ticket-id">TICKET CS-{active.id}</div><h2>{active.subject}</h2><div className="support-detail-meta">Opened {dateTime(active.createdAt)}</div></div><span className={`support-badge ${active.status}`}>{active.status === 'closed' ? 'Resolved' : 'Open'}</span></header>
          {active.assignedStaff && <div className="support-assignee" data-testid={`assigned-staff-${active.id}`}><span className="support-assignee-mark"><ShieldCheck size={17}/></span><div><strong>{active.assignedStaff.displayName} · assigned support</strong><small>Verified email: {active.assignedStaff.email} · Registered phone: {active.assignedStaff.phone}</small></div></div>}
          {!active.assignedStaff && active.status === 'open' && <p className="support-composer-note" style={{padding:'14px 22px 0'}}>A support specialist will appear here once assigned.</p>}
          <MessageThread messages={active.messages} initial={active.message} perspective="owner"/>
          {active.status === 'open' ? <form className="support-reply" onSubmit={onReply}>
            {confirmResolve ? <div className="support-success" role="group" aria-label="Confirm ticket resolution">Confirm that {active.assignedStaff?.displayName ?? 'customer service'} resolved this ticket?<div style={{display:'flex',gap:8,marginTop:10}}><button type="button" className="btn btn-outline" onClick={() => setConfirmResolve(false)} data-testid="button-cancel-resolve">Not yet</button><button type="button" className="btn btn-primary" onClick={() => void onResolve()} disabled={resolveTicket.isPending} data-testid="button-confirm-resolved">{resolveTicket.isPending ? 'Confirming…' : 'Yes, resolved'}</button></div></div> : null}
            <label className="field-group"><span className="label">Your reply</span><textarea className="field" value={composer} maxLength={4000} onChange={e => setComposer(e.target.value)} placeholder="Add context or answer a question…" data-testid="input-owner-reply"/></label>
            <div className="support-reply-actions"><small>{composer.length}/4000 · Replies never change ticket status.</small><div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}><button type="submit" className="btn btn-primary" disabled={!composer.trim() || addMessage.isPending} data-testid="button-send-owner-reply"><Send size={14}/>{addMessage.isPending ? 'Sending…' : 'Send reply'}</button>
              {active.assignedStaff && <button type="button" className="btn btn-soft" onClick={() => { setConfirmResolve(true); resetNotice(); }} data-testid="button-request-resolve"><CheckCircle2 size={14}/>Confirm resolved</button>}
            </div></div>
          </form> : <div className="support-reply"><p className="support-composer-note" data-testid={`status-ticket-resolved-${active.id}`}>{active.resolvedByName ? `Resolved by ${active.resolvedByName}${active.resolvedAt ? ` · ${dateTime(active.resolvedAt)}` : ''}.` : 'This ticket is resolved.'}</p></div>}
        </> : <div className="support-empty-detail"><div><MessageCircle size={30}/><h3>Select a ticket</h3><p>Choose a conversation to see the full thread.</p></div></div>}
      </section>
    </div>}
    {creating && <Modal title="Create a support ticket" onClose={() => setCreating(false)} footer={<><button className="btn btn-outline" type="button" onClick={() => setCreating(false)} data-testid="button-cancel-ticket">Cancel</button><button className="btn btn-primary" form="create-support-ticket" disabled={!subject.trim() || !description.trim() || createTicket.isPending} data-testid="button-submit-ticket">{createTicket.isPending ? 'Sending…' : 'Send ticket'}</button></>}>
      <form id="create-support-ticket" onSubmit={onCreate}><p className="subtle" style={{fontSize:12,lineHeight:1.6,marginTop:0}}>Your ticket and every reply are visible only to you and assigned approved support staff.</p><Field label="Subject"><input className="field" value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} placeholder="What do you need help with?" autoFocus data-testid="input-ticket-subject"/></Field><div style={{height:16}}/><Field label="Description"><textarea className="field" value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} placeholder="Share the details we need to help…" style={{minHeight:140,resize:'vertical'}} data-testid="input-ticket-description"/></Field><div className="support-reply-actions"><small>{description.length}/4000</small></div></form>
    </Modal>}
  </main></Shell>;
}