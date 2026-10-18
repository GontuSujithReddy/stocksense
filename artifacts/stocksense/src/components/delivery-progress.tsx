import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardQueryKey,
  getGetOperationQueryKey,
  getListCourierDeliveriesQueryKey,
  getListOperationsQueryKey,
  useAssignDeliveryCourier,
  useUpdateOperation,
  type Operation,
} from '@workspace/api-client-react';
import { Truck } from 'lucide-react';
import './delivery-progress.css';

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function DeliveryProgress({ operation }: { operation: Operation }) {
  const queryClient = useQueryClient();
  const assign = useAssignDeliveryCourier();
  const update = useUpdateOperation();
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [editingCourier, setEditingCourier] = useState(false);
  const [customerEmailDraft, setCustomerEmailDraft] = useState(operation.customerEmail || '');
  useEffect(() => setCustomerEmailDraft(operation.customerEmail || ''), [operation.customerEmail]);
  if (operation.type !== 'delivery') return null;

  const started = operation.deliveryStartedAt !== null;
  const finished = operation.deliveryCompletedAt !== null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationQueryKey(operation.id) });
    void queryClient.invalidateQueries({ queryKey: getListCourierDeliveriesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOperationsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    setError('');
  };
  const onError = (reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not update this delivery. Please try again.');

  return (
    <section className="delivery-progress" aria-label="Delivery tracking" data-testid="delivery-progress">
      <div className="delivery-progress-heading">
        <span className="delivery-progress-icon"><Truck size={17} aria-hidden="true" /></span>
        <div>
          <div className="eyebrow">DELIVERY TRACKING</div>
          <h3>{finished ? 'Delivery done' : started ? 'Delivery in progress' : 'Ready for the delivery person'}</h3>
        </div>
      </div>
      <div className="delivery-progress-dates">
        <div>
          <span>Delivery started</span>
          <strong data-testid="delivery-started-date">{operation.deliveryStartedAt ? timestamp(operation.deliveryStartedAt) : 'Not started yet'}</strong>
        </div>
        <div>
          <span>Delivery done</span>
          <strong data-testid="delivery-completed-date">{operation.deliveryCompletedAt ? timestamp(operation.deliveryCompletedAt) : 'Not completed yet'}</strong>
        </div>
      </div>
      <p className="delivery-progress-note">Assigned courier: <strong>{operation.courierName || operation.courierEmail || 'Not assigned'}</strong>{operation.courierName && operation.courierEmail && <> · {operation.courierEmail}</>}</p>
      {operation.courierEmail && <p className="delivery-progress-note">Courier phone: <strong data-testid="text-courier-phone">{operation.courierPhone || 'Not provided — ask the courier to complete account setup'}</strong></p>}
      {operation.status === 'done' && !started && !finished && (
        <form className="delivery-progress-customer-email" onSubmit={event => {
          event.preventDefault();
          update.mutate({ id: operation.id, data: { customerEmail: customerEmailDraft.trim().toLowerCase() } }, {
            onSuccess: refresh,
            onError,
          });
        }}>
          <label className="field-group">
            <span className="label">Customer email for delivery code</span>
            <input className="field" type="email" autoComplete="email" required value={customerEmailDraft} onChange={event => setCustomerEmailDraft(event.target.value)} placeholder="customer@example.com" data-testid="input-delivery-customer-email" />
          </label>
          <button className="btn btn-outline delivery-progress-action" type="submit" disabled={update.isPending || customerEmailDraft.trim().toLowerCase() === (operation.customerEmail || '').toLowerCase()}>
            {update.isPending ? 'Saving…' : operation.customerEmail ? 'Update customer email' : 'Save customer email'}
          </button>
          <p className="delivery-progress-note">The courier cannot start until a customer email is saved. The arrival code will be sent to this address.</p>
        </form>
      )}
      {!started && !finished && (
        operation.courierEmail && !editingCourier
          ? <div className="delivery-progress-assignment">
            <div className="delivery-progress-note">Courier assignment can be changed or removed until the trip starts.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline" type="button" onClick={() => { setEmail(''); setEditingCourier(true); }} data-testid="button-edit-courier">Change courier</button>
              <button className="btn btn-outline" type="button" disabled={assign.isPending} onClick={() => {
                const courier = operation.courierName || operation.courierEmail || 'the assigned courier';
                if (!window.confirm(`Remove ${courier} from this delivery? They will lose access, and the delivery will need another courier before it can start.`)) return;
                assign.mutate({ id: operation.id, data: { email: null } }, {
                  onSuccess: () => { refresh(); setEmail(''); setEditingCourier(false); },
                  onError,
                });
              }} data-testid="button-remove-courier">Remove assignment</button>
            </div>
          </div>
          : <form onSubmit={event => {
            event.preventDefault();
            const nextEmail = email.trim().toLowerCase();
            if (!nextEmail) return;
            assign.mutate({ id: operation.id, data: { email: nextEmail } }, {
              onSuccess: () => { refresh(); setEmail(''); setEditingCourier(false); },
              onError,
            });
          }}>
            <label className="field-group">
              <span className="label">{operation.courierEmail ? 'New courier account email' : 'Courier account email'}</span>
              <input className="field" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="courier@example.com" data-testid="input-courier-email" />
            </label>
            <button className="btn btn-primary delivery-progress-action" type="submit" disabled={assign.isPending || !email.trim()}>
              {assign.isPending ? 'Saving…' : operation.courierEmail ? 'Save courier change' : 'Assign courier'}
            </button>
            {operation.courierEmail && <button className="btn btn-outline delivery-progress-action" type="button" onClick={() => { setEmail(''); setEditingCourier(false); }}>Cancel</button>}
            <p className="delivery-progress-note">The courier must first sign up, choose Courier, provide a 10-digit phone number, and verify this email. Only their account can start, record arrival, chat with the customer, and finish the delivery.</p>
          </form>
      )}
      {operation.status !== 'done' && operation.status !== 'canceled' && (
        <p className="delivery-progress-note">Validate the outgoing stock movement before the delivery person starts.</p>
      )}
      {operation.status === 'canceled' && <p className="delivery-progress-note">This delivery was canceled.</p>}
      {finished && <p className="delivery-progress-note" role="status">Recorded as delivered on {timestamp(operation.deliveryCompletedAt!)}.</p>}
      {error && <p className="delivery-progress-error" role="alert">{error}</p>}
    </section>
  );
}