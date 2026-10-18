import { useState, type FormEvent } from 'react';
import {
  useListProducts,
  useListLocations,
  type Operation,
  type OperationType,
  type OperationInput,
  type OperationUpdate,
} from '@workspace/api-client-react';
import { Plus, Trash2 } from 'lucide-react';
import { Field, Modal } from './common';

type Row = { productId: string; quantity: string };

function localDateTime(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function OperationForm({
  operation, initialProductId, initialDestinationLocationId, onClose, onSave, busy, error,
}: {
  operation?: Operation;
  initialProductId?: number;
  initialDestinationLocationId?: number;
  onClose: () => void;
  onSave: (data: OperationInput | OperationUpdate) => void;
  busy: boolean;
  error?: string;
}) {
  const products = useListProducts();
  const locations = useListLocations();
  const [type, setType] = useState<OperationType>(operation?.type || 'receipt');
  const [contact, setContact] = useState(operation?.contact || '');
  const [customerEmail, setCustomerEmail] = useState(operation?.customerEmail || '');
  const [source, setSource] = useState(operation?.sourceLocationId?.toString() || '');
   const [destination, setDestination] = useState(operation?.destinationLocationId?.toString() || (initialDestinationLocationId ? String(initialDestinationLocationId) : ''));
  const [scheduled, setScheduled] = useState(operation?.scheduledAt ? localDateTime(operation.scheduledAt) : '');
  const [lines, setLines] = useState<Row[]>(
    operation?.lines.map(line => ({
      productId: String(line.productId),
      quantity: String(operation.type === 'adjustment' ? line.countedQuantity ?? 0 : line.quantity),
     })) || [{ productId: initialProductId ? String(initialProductId) : '', quantity: '' }],
  );
  const [localError, setLocalError] = useState('');
  const changingType = !!operation && type !== operation.type;

  const updateLine = (index: number, key: keyof Row, value: string) => {
    setLines(previous => previous.map((row, i) => i === index ? { ...row, [key]: value } : row));
    setLocalError('');
  };

  const changeType = (nextType: OperationType) => {
    if (nextType === type) return;
    if ((type === 'adjustment') !== (nextType === 'adjustment')) {
      // A stock count is an absolute value; other quantities are amounts moved.
      setLines(previous => previous.map(row => ({ ...row, quantity: '' })));
    }
    if (nextType === 'receipt') setSource('');
    if (nextType === 'delivery' || nextType === 'adjustment') setDestination('');
    setType(nextType);
    setLocalError('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (type === 'receipt' && !destination) {
      setLocalError('Choose a destination for incoming stock.');
      return;
    }
    if (type === 'delivery' && !customerEmail.trim()) {
      setLocalError('Add the customer email used for the delivery confirmation code.');
      return;
    }
    if (['delivery', 'transfer', 'adjustment'].includes(type) && !source) {
      setLocalError('Choose a source location.');
      return;
    }
    if (type === 'transfer' && (!destination || source === destination)) {
      setLocalError('Choose a different destination for the transfer.');
      return;
    }
    const productIds = lines.map(line => line.productId);
    if (new Set(productIds).size !== productIds.length) {
      setLocalError('Add each product only once per operation.');
      return;
    }
    if (lines.some(line => !line.productId || line.quantity.trim() === '' ||
      !Number.isFinite(Number(line.quantity)) ||
      (type === 'adjustment' ? Number(line.quantity) < 0 : Number(line.quantity) <= 0))) {
      setLocalError(type === 'adjustment'
        ? 'Choose a product and enter a counted quantity of zero or more for every line.'
        : 'Choose a product and enter a quantity greater than zero for every line.');
      return;
    }
    setLocalError('');
    const base = {
      contact: contact.trim() || null,
      customerEmail: type === 'delivery' ? customerEmail.trim().toLowerCase() : null,
      sourceLocationId: type === 'receipt' ? null : source ? Number(source) : null,
      destinationLocationId: type === 'receipt' || type === 'transfer' ? Number(destination) : null,
      scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
      lines: lines.map(line => ({
        productId: Number(line.productId),
        ...(type === 'adjustment'
          ? { countedQuantity: Number(line.quantity) }
          : { quantity: Number(line.quantity) }),
      })),
    };
    onSave(operation ? { ...base, ...(changingType ? { type } : {}) } : { ...base, type });
  };

  return <Modal title={operation ? 'Edit operation' : 'New operation'} onClose={onClose}>
    <form onSubmit={submit}>
      {!operation && initialProductId && <p className="product-form-summary" style={{ margin: '0 0 18px' }} role="status" data-testid="receipt-prefill-note">
        This receipt is ready for your product. Enter how many new units arrived, create the draft, then validate it on the next screen to update on-hand stock.
      </p>}
      <div className="grid-fields">
        <Field label="Operation type *">
          <select className="field" value={type} onChange={event => changeType(event.target.value as OperationType)} data-testid="select-operation-type">
            <option value="receipt">Receipt — stock coming in</option>
            <option value="delivery">Delivery — stock going out</option>
            <option value="transfer">Transfer — move between locations</option>
            <option value="adjustment">Adjustment — correct a count</option>
          </select>
        </Field>
        <Field label="Contact / reference party">
          <input className="field" value={contact} onChange={event => setContact(event.target.value)} placeholder="Supplier or recipient" data-testid="input-operation-contact" />
        </Field>
        {type === 'delivery' && <Field label="Customer email for delivery code *">
          <input className="field" type="email" autoComplete="email" required value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="customer@example.com" data-testid="input-customer-email" />
        </Field>}
        <Field label={`Source location ${type === 'delivery' || type === 'transfer' || type === 'adjustment' ? '*' : ''}`}>
          <select className="field" required={type !== 'receipt'} value={source} onChange={event => setSource(event.target.value)} data-testid="select-source-location">
            <option value="">Select source</option>
            {locations.data?.map(location => <option key={location.id} value={location.id}>{location.warehouseName} / {location.name}</option>)}
          </select>
        </Field>
        <Field label={`Destination location ${type === 'receipt' || type === 'transfer' ? '*' : ''}`}>
          <select className="field" required={type === 'receipt' || type === 'transfer'} value={destination} onChange={event => setDestination(event.target.value)} data-testid="select-destination-location">
            <option value="">Select destination</option>
            {locations.data?.map(location => <option key={location.id} value={location.id}>{location.warehouseName} / {location.name}</option>)}
          </select>
        </Field>
        <Field label="Scheduled for">
          <input type="datetime-local" className="field" value={scheduled} onChange={event => setScheduled(event.target.value)} data-testid="input-scheduled-at" />
        </Field>
      </div>
      {changingType && <p role="status" style={{ margin: '14px 0 0', fontSize: 12, color: '#875720' }}>
        Changing type returns this operation to Draft and updates its reference.
        {operation?.courierEmail && ' Its courier assignment will be removed.'}
        {(type === 'adjustment') !== (operation?.type === 'adjustment') && ' Enter a new quantity: counted stock and stock moved mean different things.'}
      </p>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '27px 0 13px' }}>
        <div>
          <div className="eyebrow">LINE ITEMS</div>
          <div style={{ fontSize: 11, color: '#728b80', marginTop: 5 }}>
            {type === 'adjustment' ? 'Enter the actual counted quantity.' : 'Enter the quantity to move.'}
          </div>
        </div>
        <button className="btn btn-soft" type="button" onClick={() => setLines(previous => [...previous, { productId: '', quantity: '' }])} data-testid="button-add-line"><Plus size={14} /> Add line</button>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {lines.map((row, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 34px', gap: 8 }}>
          <select className="field" required value={row.productId} onChange={event => updateLine(index, 'productId', event.target.value)} data-testid={`select-line-product-${index}`}>
            <option value="">Select product</option>
            {products.data?.map(product => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}
          </select>
          <input className="field" type="number" min="0" step="any" required placeholder={type === 'adjustment' ? 'Count' : 'Qty'} value={row.quantity} onChange={event => updateLine(index, 'quantity', event.target.value)} data-testid={`input-line-quantity-${index}`} />
          <button className="btn btn-outline icon-btn" type="button" disabled={lines.length === 1} onClick={() => setLines(previous => previous.filter((_, i) => i !== index))} aria-label="Remove line" data-testid={`button-remove-line-${index}`}><Trash2 size={15} /></button>
        </div>)}
      </div>
      {(localError || error) && <p style={{ color: '#a34432', fontSize: 12 }} role="alert" data-testid="status-operation-form-error">{localError || error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 28 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="button-save-operation">{busy ? 'Saving…' : operation ? 'Save changes' : 'Create draft'}</button>
      </div>
    </form>
  </Modal>;
}