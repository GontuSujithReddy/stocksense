import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListCourierDeliveryMessagesQueryKey,
  useListCourierDeliveryMessages,
  useSendCourierDeliveryMessage,
} from '@workspace/api-client-react';
import { MessageCircle, Send } from 'lucide-react';
import './courier-delivery-chat.css';

function messageTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function CourierDeliveryChat({ deliveryId, closed }: { deliveryId: number; closed: boolean }) {
  const queryClient = useQueryClient();
  const messageQueryKey = getListCourierDeliveryMessagesQueryKey(deliveryId);
  const messages = useListCourierDeliveryMessages(deliveryId, { query: { queryKey: messageQueryKey, refetchInterval: 4000 } });
  const send = useSendCourierDeliveryMessage();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.data]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setNotice('');
    setError('');
    send.mutate({ id: deliveryId, data: { message } }, {
      onSuccess: result => {
        queryClient.setQueryData(messageQueryKey, (current: typeof messages.data) =>
          [...(current ?? []), result.message]);
        setDraft('');
        setNotice(result.emailSent
          ? 'Message sent. A private chat link was emailed to the customer.'
          : 'Message saved, but the email could not be sent. Check the StockSense sender setup and try again to issue a new chat link.');
      },
      onError: reason => setError(reason instanceof Error ? reason.message : 'Could not send the message.'),
    });
  };

  return <section className="courier-chat panel panel-pad" aria-label="Delivery chat">
    <div className="courier-chat-heading">
      <span className="courier-chat-icon"><MessageCircle size={18} aria-hidden="true" /></span>
      <div>
        <div className="eyebrow">CUSTOMER CHAT</div>
        <h2>Delivery messages</h2>
      </div>
    </div>
    <p className="subtle courier-chat-intro">Your first message sends the customer a private link to reply. New replies appear here automatically.</p>
    {messages.isLoading ? <p className="courier-chat-state" role="status">Loading messages…</p> :
      messages.isError ? <div className="courier-chat-state" role="alert">Could not load this delivery chat. <button className="btn btn-outline" type="button" onClick={() => void messages.refetch()}>Retry</button></div> :
        <div className="courier-chat-thread" aria-label="Conversation" aria-live="polite">
          {messages.data?.length ? messages.data.map(item => <article key={item.id} className={`courier-chat-message ${item.sender === 'courier' ? 'is-courier' : 'is-customer'}`}>
            <div className="courier-chat-message-meta">
              <strong>{item.sender === 'courier' ? 'You' : 'Customer'}</strong>
              <time dateTime={new Date(item.createdAt).toISOString()}>{messageTime(item.createdAt)}</time>
            </div>
            <p>{item.message}</p>
          </article>) : <p className="courier-chat-empty">No messages yet. Send a message to email the customer a private reply link.</p>}
          <div ref={endRef} />
        </div>}
    {closed
      ? <p className="courier-chat-closed" role="status">This delivery is complete. The chat is now read-only.</p>
      : <form className="courier-chat-compose" onSubmit={submit}>
        <label className="sr-only" htmlFor={`courier-chat-message-${deliveryId}`}>Message to the customer</label>
        <textarea id={`courier-chat-message-${deliveryId}`} className="field" rows={3} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a delivery update…" data-testid="input-courier-delivery-message" />
        <button className="btn btn-primary" type="submit" disabled={send.isPending || !draft.trim()} data-testid="button-send-courier-delivery-message">
          <Send size={15} aria-hidden="true" /> {send.isPending ? 'Sending…' : 'Send message'}
        </button>
      </form>}
    {notice && <p className="courier-chat-notice" role="status">{notice}</p>}
    {error && <p className="courier-chat-error" role="alert">{error}</p>}
  </section>;
}
