import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCustomerDeliveryChat,
  getGetCustomerDeliveryChatQueryKey,
  sendCustomerDeliveryMessage,
  type DeliveryChatMessage,
  type DeliveryChatThread,
} from '@workspace/api-client-react';
import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import './delivery-customer-chat.css';

function messageTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function DeliveryCustomerChatPage() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const queryClient = useQueryClient();
  const endRef = useRef<HTMLDivElement>(null);
  const queryKey = [...getGetCustomerDeliveryChatQueryKey(), token];
  const thread = useQuery({
    queryKey,
    queryFn: () => getCustomerDeliveryChat({ headers: { 'X-Delivery-Chat-Token': token } }),
    enabled: /^[A-Za-z0-9_-]{40,100}$/.test(token),
    refetchInterval: query => query.state.status === 'success' ? 4000 : false,
  });
  const send = useMutation({
    mutationFn: (message: string) => sendCustomerDeliveryMessage(
      { message },
      { headers: { 'X-Delivery-Chat-Token': token } },
    ),
    onSuccess: message => {
      queryClient.setQueryData<DeliveryChatThread>(queryKey, current => current
        ? { ...current, messages: [...current.messages, message] }
        : current);
      setDraft('');
      setSendError('');
    },
    onError: reason => setSendError(reason instanceof Error ? reason.message : 'Could not send your message. Please try again.'),
  });

  useEffect(() => {
    document.title = 'Delivery chat · StockSense';
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [thread.data?.messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || thread.data?.closed || send.isPending) return;
    setSendError('');
    send.mutate(message);
  };

  const tokenLooksValid = /^[A-Za-z0-9_-]{40,100}$/.test(token);
  const errorStatus = (thread.error as { status?: number } | null)?.status;
  const invalidLink = !tokenLooksValid || errorStatus === 404;

  return <main className="delivery-customer-page">
    <header className="delivery-customer-header">
      <div className="delivery-customer-brand"><span className="delivery-customer-brand-mark">S</span><span>StockSense</span></div>
      <div className="delivery-customer-private"><ShieldCheck size={15} aria-hidden="true" /> Private delivery chat</div>
    </header>
    <section className="delivery-customer-card">
      <div className="delivery-customer-title">
        <span className="delivery-customer-icon"><MessageCircle size={21} aria-hidden="true" /></span>
        <div>
          <div className="eyebrow">DELIVERY SUPPORT</div>
          <h1>{thread.data ? `Chat about ${thread.data.reference}` : 'Chat with your courier'}</h1>
        </div>
      </div>
      {thread.isLoading && <p className="delivery-customer-state" role="status">Opening your private chat…</p>}
      {invalidLink && <div className="delivery-customer-state delivery-customer-invalid" role="alert">
        <strong>This chat link is invalid or has expired.</strong>
        <span>Ask your courier to send a new message with a fresh link.</span>
      </div>}
      {thread.isError && !invalidLink && <div className="delivery-customer-state delivery-customer-invalid" role="alert">Could not load this delivery chat. Refresh the page to try again.</div>}
      {thread.data && <>
        <p className="delivery-customer-intro">
          {thread.data.courierName
            ? `You are chatting with ${thread.data.courierName} about delivery ${thread.data.reference}.`
            : `Use this private chat to message your courier about delivery ${thread.data.reference}.`}
        </p>
        <div className="delivery-customer-messages" aria-label="Conversation" aria-live="polite">
          {thread.data.messages.length
            ? thread.data.messages.map((item: DeliveryChatMessage) => <article key={item.id} className={`delivery-customer-message ${item.sender === 'customer' ? 'is-customer' : 'is-courier'}`}>
              <div className="delivery-customer-message-meta">
                <strong>{item.sender === 'customer' ? 'You' : thread.data?.courierName || 'Courier'}</strong>
                <time dateTime={new Date(item.createdAt).toISOString()}>{messageTime(item.createdAt)}</time>
              </div>
              <p>{item.message}</p>
            </article>)
            : <p className="delivery-customer-empty">No messages yet. Your courier will see your reply here.</p>}
          <div ref={endRef} />
        </div>
        {thread.data.closed
          ? <div className="delivery-customer-closed" role="status">This delivery is complete. The conversation is now read-only.</div>
          : <form className="delivery-customer-compose" onSubmit={submit}>
            <label htmlFor="delivery-customer-message">Your message</label>
            <textarea id="delivery-customer-message" rows={4} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a reply to your courier…" data-testid="input-customer-delivery-message" />
            {sendError && <p className="delivery-customer-error" role="alert">{sendError}</p>}
            <button className="btn btn-primary" type="submit" disabled={send.isPending || !draft.trim()} data-testid="button-send-customer-delivery-message">
              <Send size={15} aria-hidden="true" /> {send.isPending ? 'Sending…' : 'Send reply'}
            </button>
          </form>}
      </>}
    </section>
    <p className="delivery-customer-footnote"><ShieldCheck size={14} aria-hidden="true" /> This link gives access only to this delivery conversation. Don’t forward it.</p>
  </main>;
}
