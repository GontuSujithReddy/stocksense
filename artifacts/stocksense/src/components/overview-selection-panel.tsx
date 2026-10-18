import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardQueryKey,
  getGetOperationQueryKey,
  getListMovesQueryKey,
  getListOperationsQueryKey,
  getListProductsQueryKey,
  useCancelOperation,
  useUpdateOperation,
  useValidateOperation,
  type Operation,
  type OperationStatus,
  type Product,
} from '@workspace/api-client-react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Ban,
  CalendarClock,
  Check,
  Clock3,
  MapPin,
  Package,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from 'lucide-react';
import { Confirm, dateText, numberText, Status } from './common';
import { DeliveryProgress } from './delivery-progress';
import { unitLooksLikeQuantity } from './product-display';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';

export type OverviewSelection =
  | { kind: 'operation'; id: number }
  | { kind: 'product'; id: number };

type OverviewSelectionPanelProps = {
  selection: OverviewSelection | null;
  operation?: Operation;
  product?: Product;
  operationsLoading: boolean;
  operationsError: boolean;
  productsLoading: boolean;
  productsError: boolean;
  retryOperations: () => void;
  retryProducts: () => void;
  onClose: () => void;
};

const workflowSteps: OperationStatus[] = ['draft', 'waiting', 'ready', 'done'];

function operationStatusText(operation: Operation) {
  if (operation.type === 'delivery' && operation.deliveryCompletedAt) return 'Delivery done';
  if (operation.type === 'delivery' && operation.deliveryStartedAt) return 'In transit';
  if (operation.type === 'delivery' && operation.status === 'waiting') return 'Picked';
  if (operation.type === 'delivery' && operation.status === 'ready') return 'Packed';
  return operation.status;
}

function operationTypeIcon(operation: Operation) {
  if (operation.type === 'delivery') return Truck;
  if (operation.type === 'transfer') return ArrowLeftRight;
  if (operation.type === 'adjustment') return SlidersHorizontal;
  if (operation.type === 'receipt') return ArrowDownLeft;
  return Package;
}

function scheduledText(value: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (!value.includes('T') || Number.isNaN(date.getTime())) return dateText(value);
  return `${dateText(value)} · ${new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)}`;
}

function PanelLoading() {
  return (
    <div className="overview-drawer-state" role="status">
      <span className="overview-drawer-spinner" aria-hidden="true" />
      Loading live details…
    </div>
  );
}

function PanelUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="overview-drawer-state overview-drawer-unavailable" role="alert">
      <p>These details couldn’t be loaded.</p>
      <button className="btn btn-outline" type="button" onClick={onRetry} data-testid="button-retry-overview-details">
        Retry
      </button>
    </div>
  );
}

export function OverviewSelectionPanel({
  selection,
  operation,
  product,
  operationsLoading,
  operationsError,
  productsLoading,
  productsError,
  retryOperations,
  retryProducts,
  onClose,
}: OverviewSelectionPanelProps) {
  const queryClient = useQueryClient();
  const update = useUpdateOperation();
  const validate = useValidateOperation();
  const cancel = useCancelOperation();
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busy = update.isPending || validate.isPending || cancel.isPending;

  const refreshOperationData = (id: number) => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: getListOperationsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMovesQueryKey() });
  };

  const setStatus = (id: number, status: OperationStatus) => {
    setError('');
    update.mutate(
      { id, data: { status } },
      {
        onSuccess: () => refreshOperationData(id),
        onError: mutationError => setError(String(mutationError)),
      },
    );
  };

  const validateOperation = (id: number) => {
    setError('');
    validate.mutate(
      { id },
      {
        onSuccess: () => refreshOperationData(id),
        onError: mutationError => setError(String(mutationError)),
      },
    );
  };

  const cancelOperation = (id: number) => {
    setError('');
    cancel.mutate(
      { id },
      {
        onSuccess: () => {
          refreshOperationData(id);
          setConfirmCancel(false);
        },
        onError: mutationError => {
          setConfirmCancel(false);
          setError(String(mutationError));
        },
      },
    );
  };

  const editable = operation
    ? ['draft', 'waiting', 'ready'].includes(operation.status)
    : false;
  const statusIndex = operation && operation.status !== 'canceled'
    ? workflowSteps.indexOf(operation.status)
    : -1;
  const operationUnits = operation?.lines.reduce(
    (sum, line) => sum + (operation.type === 'adjustment' ? line.countedQuantity ?? 0 : line.quantity),
    0,
  ) ?? 0;
  const Icon = operation ? operationTypeIcon(operation) : Package;

  return (
    <Sheet
      open={selection !== null}
      onOpenChange={open => {
        if (!open) {
          setError('');
          setConfirmCancel(false);
          onClose();
        }
      }}
    >
      <SheetContent
        className="overview-drawer"
      >
        <SheetTitle className="sr-only">
          {selection?.kind === 'product'
            ? product?.name || 'Product details'
            : operation?.reference || 'Movement details'}
        </SheetTitle>
        {selection?.kind === 'operation' && (
          operationsLoading ? <PanelLoading />
            : operationsError ? <PanelUnavailable onRetry={retryOperations} />
              : !operation ? (
                <div className="overview-drawer-state">
                  <p>This operation is no longer available in the current queue.</p>
                  <Link href="/operations" className="btn btn-outline" data-testid="link-overview-open-operations">Open operations</Link>
                </div>
              ) : (
                <>
                  <SheetHeader className="overview-drawer-header">
                    <div className="overview-drawer-heading-row">
                      <span className="overview-drawer-icon"><Icon size={20} aria-hidden="true" /></span>
                      <div className="overview-drawer-heading-copy">
                        <div className="eyebrow">MOVEMENT DOSSIER / {operation.type.toUpperCase()}</div>
                        <h2 className="overview-drawer-title">{operation.reference}</h2>
                      </div>
                      <Status value={operation.status} label={operationStatusText(operation)} />
                    </div>
                    <SheetDescription>
                      Review the route, items, and next workflow step for this movement.
                    </SheetDescription>
                  </SheetHeader>

                  <div className="overview-drawer-scroll">
                    <section className="overview-dossier-section" aria-label="Movement route">
                      <div className="overview-dossier-label">{operation.type === 'adjustment' ? 'STOCK COUNT LOCATION' : 'MOVEMENT ROUTE'}</div>
                      <div className="overview-route">
                        {operation.type === 'adjustment' ? (
                          <div>
                            <span>Counted at</span>
                            <strong>{operation.sourceLocationName || operation.destinationLocationName || 'Unknown location'}</strong>
                          </div>
                        ) : (
                          <>
                        <div>
                          <span>From</span>
                          <strong>{operation.sourceLocationName || (operation.type === 'receipt' ? operation.contact : null) || 'External'}</strong>
                        </div>
                        <ArrowRight size={17} aria-hidden="true" />
                        <div>
                          <span>To</span>
                          <strong>{operation.destinationLocationName || (operation.type === 'delivery' ? operation.contact : null) || 'External'}</strong>
                        </div>
                          </>
                        )}
                      </div>
                      <div className="overview-dossier-meta">
                        <div>
                          <CalendarClock size={15} aria-hidden="true" />
                          <span>Scheduled</span>
                          <strong>{scheduledText(operation.scheduledAt)}</strong>
                        </div>
                        <div>
                          <Warehouse size={15} aria-hidden="true" />
                          <span>Contact</span>
                          <strong>{operation.contact || '—'}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="overview-dossier-section" aria-label="Operation items">
                      <div className="overview-dossier-section-heading">
                        <div>
                          <div className="overview-dossier-label">ITEMS IN THIS MOVEMENT</div>
                          <h3>{operation.lines.length} {operation.lines.length === 1 ? 'product' : 'products'}</h3>
                        </div>
                        <span className="overview-line-count">
                          {numberText(operationUnits)} units
                        </span>
                      </div>
                      {operation.lines.length ? (
                        <div className="overview-line-list">
                          {operation.lines.map(line => (
                            <div className="overview-line-item" key={line.id} data-testid={`overview-operation-line-${line.id}`}>
                              <span className="overview-line-icon"><Package size={15} aria-hidden="true" /></span>
                              <span className="overview-line-copy">
                                <strong>{line.productName}</strong>
                                <small>{line.sku}</small>
                              </span>
                              <span className="overview-line-quantity">
                                {operation.type === 'adjustment' && line.countedQuantity !== null
                                  ? numberText(line.countedQuantity)
                                  : numberText(line.quantity)}
                                <small style={{ display: 'block', marginTop: 3, color: '#70838e', fontWeight: 400 }}>Unit: {line.unit}</small>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="overview-drawer-muted">No product lines have been added yet.</p>
                      )}
                    </section>

                    <section className="overview-dossier-section" aria-label="Workflow checkpoint">
                      <div className="overview-dossier-label">WORKFLOW CHECKPOINT</div>
                      <div className={`overview-workflow ${operation.status === 'canceled' ? 'is-canceled' : ''}`}>
                        {workflowSteps.map((step, index) => (
                          <div className={`overview-workflow-step ${index <= statusIndex ? 'is-complete' : ''} ${index === statusIndex ? 'is-current' : ''}`} key={step}>
                            <span>{index < statusIndex ? <Check size={13} /> : index + 1}</span>
                            <small>{operation.type === 'delivery' && step === 'waiting' ? 'Picked' : operation.type === 'delivery' && step === 'ready' ? 'Packed' : step}</small>
                          </div>
                        ))}
                      </div>
                      <div className="overview-next-action">
                        {operation.status === 'ready'
                          ? 'Validate this movement to update stock and the ledger.'
                          : operation.status === 'waiting'
                            ? 'Check the route and item quantities before confirming it as ready.'
                            : operation.status === 'draft'
                              ? 'Review the operation details before moving it into the workflow.'
                              : operation.status === 'canceled'
                                ? 'This movement was canceled and cannot be validated.'
                                : 'This movement is complete. Its stock changes are in the ledger.'}
                      </div>
                    </section>
                    <DeliveryProgress operation={operation} />

                    {error && <div className="overview-drawer-error" role="alert" data-testid="status-overview-operation-error">{error}</div>}
                  </div>

                  <div className="overview-drawer-footer">
                    <div className="overview-drawer-actions">
                      {editable && operation.status === 'draft' && (
                        <button className="btn btn-outline" type="button" disabled={busy} onClick={() => setStatus(operation.id, 'waiting')} data-testid="button-drawer-mark-waiting">
                          {operation.type === 'delivery' ? 'Mark as picked' : 'Mark as waiting'}
                        </button>
                      )}
                      {editable && (operation.status === 'draft' || operation.status === 'waiting') && (
                        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => setStatus(operation.id, 'ready')} data-testid="button-drawer-mark-ready">
                          <Check size={15} />{operation.type === 'delivery' ? 'Mark as packed' : 'Confirm as ready'}
                        </button>
                      )}
                      {editable && (
                        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => validateOperation(operation.id)} data-testid="button-drawer-validate-operation">
                          <Check size={15} />{validate.isPending ? 'Validating…' : 'Validate movement'}
                        </button>
                      )}
                      {editable && (
                        <button className="btn btn-danger overview-drawer-cancel" type="button" disabled={busy} onClick={() => setConfirmCancel(true)} data-testid="button-drawer-cancel-operation">
                          <Ban size={14} />Cancel
                        </button>
                      )}
                    </div>
                    {update.isPending && <span className="overview-drawer-saving" role="status"><Clock3 size={13} />Saving workflow step…</span>}
                    <Link href={`/operations/${operation.id}`} className="overview-drawer-full-link" data-testid="link-drawer-full-operation">
                      Open full operation <ArrowUpRight size={14} />
                    </Link>
                  </div>

                  {confirmCancel && (
                    <Confirm
                      title="Cancel operation?"
                      description="This operation will be canceled and can no longer be validated."
                      onClose={() => setConfirmCancel(false)}
                      onConfirm={() => cancelOperation(operation.id)}
                      busy={cancel.isPending}
                    />
                  )}
                </>
              )
        )}

        {selection?.kind === 'product' && (
          productsLoading ? <PanelLoading />
            : productsError ? <PanelUnavailable onRetry={retryProducts} />
              : !product ? (
                <div className="overview-drawer-state">
                  <p>This product is no longer in the active catalog.</p>
                  <Link href="/products" className="btn btn-outline" data-testid="link-overview-open-products">Open products</Link>
                </div>
              ) : (
                <>
                  <SheetHeader className="overview-drawer-header">
                    <div className="overview-drawer-heading-row">
                      <span className="overview-drawer-icon"><Package size={20} aria-hidden="true" /></span>
                      <div className="overview-drawer-heading-copy">
                        <div className="eyebrow">PRODUCT DOSSIER / <span className="mono">{product.sku}</span></div>
                        <h2 className="overview-drawer-title">{product.name}</h2>
                      </div>
                      <Status value={product.stockStatus} />
                    </div>
                    <SheetDescription>
                      Stock position and storage locations from the live product catalog.
                    </SheetDescription>
                  </SheetHeader>

                  <div className="overview-drawer-scroll">
                    <section className="overview-product-metrics" aria-label="Product stock summary">
                      <div>
                        <span>ON HAND</span>
                        <strong>{numberText(product.totalStock)}</strong>
                        <small>{unitLooksLikeQuantity(product.unit) ? 'Unit needs correction' : product.unit}</small>
                      </div>
                      <div>
                        <span>REORDER POINT</span>
                        <strong>{numberText(product.reorderPoint)}</strong>
                        <small>{unitLooksLikeQuantity(product.unit) ? 'Unit needs correction' : product.unit}</small>
                      </div>
                    </section>

                    <section className="overview-dossier-section" aria-label="Product information">
                      <div className="overview-dossier-label">PRODUCT DETAILS</div>
                      <div className="overview-product-facts">
                        <div><span>Category</span><strong>{product.categoryName || 'Uncategorized'}</strong></div>
                        <div><span>Created</span><strong>{dateText(product.createdAt)}</strong></div>
                        <div><span>Storage default</span><strong>{product.defaultLocationName ? `${product.defaultWarehouseName} / ${product.defaultLocationName}` : 'Not set'}</strong></div>
                      </div>
                    </section>

                    <section className="overview-dossier-section" aria-label="Stock by location">
                      <div className="overview-dossier-section-heading">
                        <div>
                          <div className="overview-dossier-label">STOCK BY LOCATION</div>
                          <h3>{product.locationStocks.length} {product.locationStocks.length === 1 ? 'location' : 'locations'}</h3>
                        </div>
                      </div>
                      {product.locationStocks.length ? (
                        <div className="overview-location-list">
                          {product.locationStocks.map(stock => (
                            <div className="overview-location-item" key={stock.locationId} data-testid={`overview-product-location-${stock.locationId}`}>
                              <span className="overview-line-icon"><MapPin size={15} aria-hidden="true" /></span>
                              <span className="overview-line-copy">
                                <strong>{stock.locationName}</strong>
                                <small>{stock.warehouseName}</small>
                              </span>
                              <span className="overview-line-quantity">{numberText(stock.quantity)} {unitLooksLikeQuantity(product.unit) ? '' : product.unit}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="overview-drawer-muted">No stock has been recorded at a location yet.</p>
                      )}
                    </section>
                  </div>

                  <div className="overview-drawer-footer">
                    <Link href={`/products/${product.id}`} className="btn btn-primary overview-product-full-link" data-testid="link-drawer-full-product">
                      View product details <ArrowUpRight size={15} />
                    </Link>
                  </div>
                </>
              )
        )}
      </SheetContent>
    </Sheet>
  );
}