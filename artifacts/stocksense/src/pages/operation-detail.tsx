import { useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetOperation,
  useUpdateOperation,
  useDeleteOperation,
  useValidateOperation,
  useCancelOperation,
  getGetOperationQueryKey,
  getListOperationsQueryKey,
  getGetDashboardQueryKey,
  getListProductsQueryKey,
  getListMovesQueryKey,
  type OperationUpdate,
  type OperationStatus,
} from '@workspace/api-client-react';
import { ArrowLeft, Pencil, Trash2, Check, Ban, ArrowRight, ScanSearch } from 'lucide-react';
import { Shell, LoadingRows, QueryError, Status, Confirm, numberText, dateText } from '../components/common';
import { OperationForm } from '../components/operation-form';
import { DeliveryProgress } from '../components/delivery-progress';
import './operation-detail.css';

export default function OperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const opId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const q = useGetOperation(opId);
  const update = useUpdateOperation();
  const remove = useDeleteOperation();
  const validate = useValidateOperation();
  const cancel = useCancelOperation();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);
  const [error, setError] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetOperationQueryKey(opId) });
    qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
    qc.invalidateQueries({ queryKey: getListMovesQueryKey() });
  };
  const edit = (data: OperationUpdate) =>
    update.mutate(
      { id: opId, data },
      {
        onSuccess: () => {
          refresh();
          setEditing(false);
          setError('');
        },
        onError: e => setError(String(e)),
      },
    );
  const status = (value: OperationStatus) =>
    update.mutate(
      { id: opId, data: { status: value } },
      {
        onSuccess: () => {
          refresh();
          setError('');
        },
        onError: e => setError(String(e)),
      },
    );
  const validateNow = () =>
    validate.mutate(
      { id: opId },
      {
        onSuccess: () => {
          refresh();
          setError('');
        },
        onError: e => setError(String(e)),
      },
    );
  const cancelNow = () =>
    cancel.mutate(
      { id: opId },
      {
        onSuccess: () => {
          refresh();
          setConfirm(null);
          setError('');
        },
        onError: e => {
          setConfirm(null);
          setError(String(e));
        },
      },
    );
  const deleteNow = () =>
    remove.mutate(
      { id: opId },
      {
        onSuccess: () => {
          refresh();
          navigate('/operations');
        },
        onError: e => {
          setConfirm(null);
          setError(String(e));
        },
      },
    );

  const op = q.data;
  const editable = op?.status === 'draft' || op?.status === 'waiting' || op?.status === 'ready';

  return (
    <Shell title="Operation details">
      <main className="page operation-detail">
        <Link
          href="/operations"
          className="btn btn-outline operation-detail-back"
          data-testid="link-back-operations"
        >
          <ArrowLeft size={15} /> All operations
        </Link>

        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <QueryError retry={() => q.refetch()} />
        ) : (
          op && (
            <>
              <header className="operation-detail-header">
                <div className="operation-detail-identity">
                  <div className="eyebrow">{op.origin === 'storefront' ? 'STOREFRONT ORDER / DELIVERY' : `OPERATION / ${op.type.toUpperCase()}`}</div>
                  <h1 className="page-title mono operation-detail-reference">{op.reference}</h1>
                  <div className="operation-detail-created">
                    <Status
                      value={op.status}
                      label={
                        op.origin === 'storefront' && op.status === 'ready'
                          ? 'Awaiting review'
                          : op.type === 'delivery' && op.deliveryCompletedAt
                          ? 'Delivery done'
                          : op.type === 'delivery' && op.deliveryStartedAt
                            ? 'In transit'
                            : op.type === 'delivery' && op.status === 'waiting'
                          ? 'Picked'
                          : op.type === 'delivery' && op.status === 'ready'
                            ? 'Packed'
                            : undefined
                      }
                    />
                    <span className="subtle operation-detail-created-date">
                      Created {dateText(op.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="operation-detail-actions">
                  <Link href={`/intelligence?operation=${op.id}`} className="btn btn-soft" data-testid="link-operation-intelligence"><ScanSearch size={15} /> Review signals</Link>
                  {editable && (
                    <button
                      className="btn btn-outline"
                      onClick={() => setEditing(true)}
                      data-testid="button-edit-operation"
                    >
                      <Pencil size={15} /> Edit
                    </button>
                  )}
                  {editable && (
                    <button
                      className="btn btn-danger"
                      onClick={() => setConfirm('cancel')}
                      data-testid="button-cancel-operation"
                    >
                      <Ban size={15} /> Cancel
                    </button>
                  )}
                  {op.status === 'draft' && (
                    <button
                      className="btn btn-outline"
                      onClick={() => setConfirm('delete')}
                      data-testid="button-delete-operation"
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  )}
                </div>
              </header>

              {error && (
                <div
                  className="panel panel-pad operation-detail-error"
                  data-testid="status-operation-error"
                >
                  {error}
                </div>
              )}

              <div className="operation-detail-grid">
                <div className="operation-detail-primary">
                  <section className="panel operation-detail-lines">
                    <div className="operation-detail-section-heading">
                      <div className="eyebrow">MOVEMENT DETAILS</div>
                      <h2 className="display">Items in this {op.type}</h2>
                    </div>

                    <div className="table-wrap operation-detail-table-wrap">
                      <table className="data-table operation-detail-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>SKU</th>
                            <th>{op.type === 'adjustment' ? 'Counted quantity' : 'Quantity'}</th>
                            <th>Unit of measure</th>
                          </tr>
                        </thead>
                        <tbody>
                          {op.lines.map(line => (
                            <tr key={line.id}>
                              <td>
                                <Link
                                  href={`/products/${line.productId}`}
                                  className="operation-detail-product-link"
                                  data-testid={`link-line-product-${line.productId}`}
                                >
                                  {line.productName}
                                </Link>
                              </td>
                              <td className="mono subtle">{line.sku}</td>
                              <td>
                                <strong className="mono">
                                  {numberText(
                                    op.type === 'adjustment'
                                      ? line.countedQuantity ?? 0
                                      : line.quantity,
                                  )}
                                </strong>
                              </td>
                              <td className="subtle">{line.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="operation-detail-mobile-lines" aria-label="Operation products">
                      {op.lines.map(line => (
                        <article className="operation-detail-product-card" key={line.id}>
                          <div className="operation-detail-product-field">
                            <span className="operation-detail-field-label">Product</span>
                            <Link
                              href={`/products/${line.productId}`}
                              className="operation-detail-product-link"
                              data-testid={`link-line-product-mobile-${line.productId}`}
                            >
                              {line.productName}
                            </Link>
                          </div>
                          <div className="operation-detail-product-meta">
                            <div className="operation-detail-product-field">
                              <span className="operation-detail-field-label">SKU</span>
                              <span className="mono">{line.sku}</span>
                            </div>
                            <div className="operation-detail-product-field">
                              <span className="operation-detail-field-label">
                                {op.type === 'adjustment' ? 'Counted quantity' : 'Quantity'}
                              </span>
                              <span>
                                <strong className="mono">
                                  {numberText(
                                    op.type === 'adjustment'
                                      ? line.countedQuantity ?? 0
                                      : line.quantity,
                                  )}
                                </strong>
                              </span>
                            </div>
                            <div className="operation-detail-product-field">
                              <span className="operation-detail-field-label">Unit of measure</span>
                              <span className="subtle">{line.unit}</span>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="panel panel-pad operation-detail-routing">
                    <div className="eyebrow">{op.type === 'adjustment' ? 'STOCK COUNT LOCATION' : 'ROUTING'}</div>
                    <div className="operation-detail-route">
                      {op.type === 'adjustment' ? (
                        <div className="operation-detail-route-stop">
                          <small className="subtle">Counted at</small>
                          <div className="operation-detail-value">{op.sourceLocationName || op.destinationLocationName || 'Unknown location'}</div>
                        </div>
                      ) : (
                        <>
                      <div className="operation-detail-route-stop">
                        <small className="subtle">From</small>
                        <div className="operation-detail-value">
                          {op.sourceLocationName || 'External'}
                        </div>
                      </div>
                      <ArrowRight
                        className="operation-detail-route-arrow"
                        size={19}
                        color="#7da397"
                        aria-hidden="true"
                      />
                      <div className="operation-detail-route-stop">
                        <small className="subtle">To</small>
                        <div className="operation-detail-value">
                          {op.destinationLocationName || 'External'}
                        </div>
                      </div>
                        </>
                      )}
                    </div>
                    <div className="operation-detail-route-meta">
                      <div>
                        <span className="subtle">Contact</span>
                        <div className="operation-detail-value">{op.contact || '—'}</div>
                      </div>
                      {op.type === 'delivery' && <div>
                        <span className="subtle">Customer email</span>
                        <div className="operation-detail-value">{op.customerEmail || 'Not added'}</div>
                      </div>}
                      {op.type === 'delivery' && <div>
                        <span className="subtle">Customer phone</span>
                        <div className="operation-detail-value">{op.contactPhone || 'Not provided'}</div>
                      </div>}
                      {op.type === 'delivery' && <div style={{ gridColumn: '1 / -1' }}>
                        <span className="subtle">Delivery address</span>
                        <div className="operation-detail-value">{op.deliveryAddress || 'Not provided'}</div>
                      </div>}
                      <div>
                        <span className="subtle">Scheduled</span>
                        <div className="operation-detail-value">{dateText(op.scheduledAt)}</div>
                      </div>
                    </div>
                  </section>
                  <DeliveryProgress operation={op} />
                </div>

                <aside className="panel panel-pad operation-detail-workflow">
                  <div className="eyebrow">WORKFLOW</div>
                  <h2 className="display">Move it forward</h2>
                  <p className="operation-detail-workflow-copy">
                    {op.status === 'done'
                      ? 'Stock movement recorded. Delivery tracking continues separately below the route.'
                      : 'Review the lines and locations, then validate to record the stock movement.'}
                  </p>
                  <div className="operation-detail-progress">
                    {['draft', 'waiting', 'ready', 'done'].map((s, i) => (
                      <div key={s} className="operation-detail-progress-step">
                        <div
                          className="operation-detail-progress-bar"
                          style={{
                            background:
                              ['draft', 'waiting', 'ready', 'done'].indexOf(op.status) >= i
                                ? '#2b7569'
                                : '#bfd3c0',
                          }}
                        />
                        <small>
                          {op.type === 'delivery' && s === 'waiting'
                            ? 'picked'
                            : op.type === 'delivery' && s === 'ready'
                              ? 'packed'
                              : s}
                        </small>
                      </div>
                    ))}
                  </div>
                  {op.status === 'draft' && (
                    <button
                      className="btn btn-outline operation-detail-workflow-button"
                      disabled={update.isPending}
                      onClick={() => status('waiting')}
                      data-testid="button-mark-waiting"
                    >
                      {op.type === 'delivery' ? 'Mark as picked' : 'Mark as waiting'}
                    </button>
                  )}
                  {(op.status === 'draft' || op.status === 'waiting') && (
                    <button
                      className="btn btn-outline operation-detail-workflow-button"
                      disabled={update.isPending}
                      onClick={() => status('ready')}
                      data-testid="button-mark-ready"
                    >
                      {op.type === 'delivery' ? 'Mark as packed' : 'Mark as ready'}
                    </button>
                  )}
                  {editable && (
                    <button
                      className="btn btn-primary operation-detail-workflow-button"
                      disabled={validate.isPending}
                      onClick={validateNow}
                      data-testid="button-validate-operation"
                    >
                      <Check size={16} />
                      {validate.isPending ? 'Validating…' : 'Validate movement'}
                    </button>
                  )}
                  {!editable && op.type !== 'delivery' && (
                    <p className="operation-detail-locked">
                      This operation is {op.status}. No further changes can be made.
                    </p>
                  )}
                </aside>
              </div>
            </>
          )
        )}

        {editing && op && (
          <OperationForm
            operation={op}
            onClose={() => setEditing(false)}
            onSave={data => edit(data as OperationUpdate)}
            busy={update.isPending}
            error={error}
          />
        )}
        {confirm && (
          <Confirm
            title={confirm === 'delete' ? 'Delete draft?' : 'Cancel operation?'}
            description={
              confirm === 'delete'
                ? 'This draft will be permanently removed.'
                : 'This operation will be canceled and can no longer be validated.'
            }
            onClose={() => setConfirm(null)}
            onConfirm={confirm === 'delete' ? deleteNow : cancelNow}
            busy={remove.isPending || cancel.isPending}
          />
        )}
      </main>
    </Shell>
  );
}