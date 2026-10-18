import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useClerk, useUser } from '@clerk/react';
import {
  getGetCourierDeliveryQueryKey,
  getListCourierDeliveriesQueryKey,
  useCompleteDelivery,
  useGetCourierDelivery,
  useListCourierDeliveries,
  useReachDelivery,
  useStartDelivery,
  type CourierDelivery,
} from '@workspace/api-client-react';
import { Link, useParams } from 'wouter';
import { Brand, Empty, LoadingRows, QueryError, SectionHeadingIcon } from '../components/common';
import { CourierDeliveryChat } from '../components/courier-delivery-chat';
import '../components/delivery-progress.css';

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet';
}

function CourierLayout({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  return <div className="app-shell" style={{ display: 'block' }}>
    <header className="topbar" style={{ padding: '16px 5%', display: 'flex', justifyContent: 'space-between' }}>
      <Brand /><div><span className="subtle">{user?.firstName || user?.primaryEmailAddress?.emailAddress}</span>{' '}
        <button className="btn btn-outline" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}>Sign out</button></div>
    </header>
    <main className="page" style={{ maxWidth: 880, margin: 'auto', padding: '30px 20px' }}>{children}</main>
  </div>;
}

export function CourierDeliveriesPage() {
  const q = useListCourierDeliveries();
  return <CourierLayout>
    <div className="section-heading-copy"><SectionHeadingIcon section="deliveries"/><div>
      <div className="eyebrow">COURIER WORKSPACE</div>
      <h1 className="page-title">My deliveries</h1>
      <p className="subtle">Only deliveries assigned to your account appear here. Inventory validation is handled separately by the workspace owner.</p>
    </div></div>
    {q.isLoading ? <LoadingRows /> : q.isError ? <QueryError retry={() => void q.refetch()} /> :
      !q.data?.length ? <Empty title="No assigned deliveries" description="Ask the workspace owner to assign a delivery to your verified account email." /> :
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {q.data.map(delivery => <Link href={`/courier/deliveries/${delivery.id}`} key={delivery.id} className="panel panel-pad" style={{ display: 'block', textDecoration: 'none' }}>
          <strong>{delivery.reference}</strong> · {delivery.deliveryCompletedAt ? 'Done' : delivery.deliveryReachedAt ? 'At destination' : delivery.deliveryStartedAt ? 'In progress' : 'Not started'}
          <p className="subtle" style={{ marginBottom: 0 }}>{delivery.contact || 'No contact'} · Scheduled: {date(delivery.scheduledAt)}</p>
        </Link>)}
      </div>}
  </CourierLayout>;
}

function CourierMilestones({ delivery }: { delivery: CourierDelivery }) {
  const qc = useQueryClient();
  const start = useStartDelivery();
  const reach = useReachDelivery();
  const complete = useCompleteDelivery();
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const cooldownTarget = Math.max(
    cooldownUntil,
    delivery.emailOtpSentAt ? new Date(delivery.emailOtpSentAt).getTime() + 60_000 : 0,
  );
  useEffect(() => {
    if (cooldownTarget <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownTarget, now]);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getGetCourierDeliveryQueryKey(delivery.id) });
    void qc.invalidateQueries({ queryKey: getListCourierDeliveriesQueryKey() });
  };
  const refresh = () => {
    invalidate();
    setError('');
  };
  const onError = (reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not update delivery.');
  const resendWait = Math.max(0, Math.ceil((cooldownTarget - now) / 1000));
  const requestOtp = () => {
    setCooldownUntil(Date.now() + 60_000);
    reach.mutate({ id: delivery.id }, {
      onSuccess: refresh,
      onError: reason => { invalidate(); onError(reason); },
    });
  };
  return <section className="delivery-progress" aria-label="Delivery tracking">
    <div className="delivery-progress-dates">
      <div><span>Started</span><strong>{date(delivery.deliveryStartedAt)}</strong></div>
      <div><span>Reached destination</span><strong>{date(delivery.deliveryReachedAt)}</strong></div>
      <div><span>Done</span><strong>{date(delivery.deliveryCompletedAt)}</strong></div>
    </div>
    {delivery.status !== 'done' && <p className="delivery-progress-note">The owner must validate the outgoing stock before you can start.</p>}
    {delivery.status === 'done' && !delivery.deliveryStartedAt && <>
      {!delivery.customerEmailMasked && <p className="delivery-progress-error" role="alert">Ask the workspace owner to add the customer email before starting this delivery.</p>}
      <button className="btn btn-primary delivery-progress-action" disabled={start.isPending || !delivery.customerEmailMasked} onClick={() => start.mutate({ id: delivery.id }, { onSuccess: refresh, onError })} data-testid="button-start-delivery">{start.isPending ? 'Starting…' : 'Mark started'}</button>
    </>}
    {delivery.deliveryStartedAt && !delivery.deliveryReachedAt && <button className="btn btn-primary delivery-progress-action" disabled={reach.isPending} onClick={requestOtp} data-testid="button-reach-destination">{reach.isPending ? 'Sending code…' : 'Reached destination · email code'}</button>}
    {delivery.deliveryReachedAt && !delivery.deliveryCompletedAt && <>
      <p className="delivery-progress-note">Customer email: <strong>{delivery.customerEmailMasked || 'Not available'}</strong></p>
      {delivery.emailOtpSentAt
        ? <p className="delivery-progress-note" role="status">Code emailed {date(delivery.emailOtpSentAt)} · expires {date(delivery.emailOtpExpiresAt)}.</p>
        : <p className="delivery-progress-error" role="status">The code has not been confirmed as emailed yet. You can retry after any resend wait.</p>}
      <button className="btn btn-outline delivery-progress-action" disabled={reach.isPending || resendWait > 0} onClick={requestOtp} data-testid="button-resend-delivery-otp">
        {reach.isPending ? 'Sending code…' : resendWait > 0 ? `Resend in ${resendWait}s` : delivery.emailOtpSentAt ? 'Resend customer code' : 'Send customer code'}
      </button>
      {delivery.emailOtpSentAt && <form onSubmit={event => {
        event.preventDefault();
        complete.mutate({ id: delivery.id, data: { otp } }, {
          onSuccess: () => { setOtp(''); refresh(); },
          onError,
        });
      }}>
        <label className="field-group" style={{ marginTop: 15 }}>
          <span className="label">Customer confirmation code</span>
          <input className="field" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" data-testid="input-delivery-otp" />
        </label>
        <p className="delivery-progress-note">Ask the customer for the code sent to their email. The delivery cannot be marked done without it.</p>
        <button className="btn btn-primary delivery-progress-action" type="submit" disabled={complete.isPending || otp.length !== 6} data-testid="button-complete-delivery">{complete.isPending ? 'Checking code…' : 'Mark done'}</button>
      </form>}
    </>}
    {error && <p className="delivery-progress-error" role="alert">{error}</p>}
  </section>;
}

export function CourierDeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const q = useGetCourierDelivery(Number(id));
  return <CourierLayout>
    <Link href="/courier/deliveries" className="btn btn-outline">← My deliveries</Link>
    {q.isLoading ? <LoadingRows /> : q.isError ? <QueryError retry={() => void q.refetch()} /> : q.data &&
      <><div className="section-heading-copy" style={{ marginTop: 24 }}><SectionHeadingIcon section="deliveries"/><div>
          <div className="eyebrow">ASSIGNED DELIVERY</div>
          <h1 className="page-title">{q.data.reference}</h1>
          <p className="subtle">Contact: {q.data.contact || '—'} · Scheduled: {date(q.data.scheduledAt)}</p>
        </div></div>
        <CourierMilestones delivery={q.data} />
        <CourierDeliveryChat deliveryId={q.data.id} closed={!!q.data.deliveryCompletedAt} /></>}
  </CourierLayout>;
}