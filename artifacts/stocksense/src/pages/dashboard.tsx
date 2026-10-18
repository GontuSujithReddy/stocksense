import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  useGetDashboard,
  useListOperations,
  useListProducts,
  useListWarehouses,
  type Operation,
  type OperationStatus,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  ClipboardCheck,
  Clock3,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Truck,
  Warehouse,
  ScanSearch,
} from 'lucide-react';
import { Empty, LoadingRows, numberText, QueryError, dateText, SectionHeadingIcon, Shell, Status } from '../components/common';
import { OverviewSelectionPanel, type OverviewSelection } from '../components/overview-selection-panel';
import './control-room.css';

const statusTabs: { label: string; value: OperationStatus | 'all' | 'open' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Draft', value: 'draft' },
  { label: 'Waiting', value: 'waiting' },
  { label: 'Ready', value: 'ready' },
  { label: 'Done', value: 'done' },
  { label: 'Canceled', value: 'canceled' },
];

const typeIcons = {
  receipt: ArrowDownLeft,
  delivery: Truck,
  transfer: ArrowLeftRight,
  adjustment: SlidersHorizontal,
};

const openStatuses: OperationStatus[] = ['draft', 'waiting', 'ready'];

function statusLabel(operation: Operation) {
  const { status, type } = operation;
  if (operation.origin === 'storefront' && status === 'ready') return 'Awaiting review';
  if (type === 'delivery' && operation.deliveryCompletedAt) return 'Delivery done';
  if (type === 'delivery' && operation.deliveryStartedAt) return 'In transit';
  if (type === 'delivery' && status === 'done') return 'Awaiting dispatch';
  if (type === 'delivery' && status === 'waiting') return 'Picked';
  if (type === 'delivery' && status === 'ready') return 'Packed';
  return status;
}

function operationItems(operation: Operation) {
  return operation.lines.map((line) => line.productName).filter(Boolean).join(', ') || 'No product lines';
}

function operationQuantity(operation: Operation) {
  if (!operation.lines.length) return 'No line items';
  const units = new Set(operation.lines.map((line) => line.unit));
  if (units.size !== 1) return `${operation.lines.length} line items`;
  if (operation.type === 'adjustment') {
    const counted = operation.lines.filter((line) => line.countedQuantity !== null);
    if (!counted.length) return `${operation.lines.length} count lines`;
    const total = counted.reduce((sum, line) => sum + (line.countedQuantity ?? 0), 0);
    return `Counted ${numberText(total)} ${counted[0].unit}`;
  }
  const total = operation.lines.reduce((sum, line) => sum + line.quantity, 0);
  return `${numberText(total)} ${operation.lines[0].unit}`;
}

function NewWorkspaceGuide() {
  const steps = [
    { number: '01', icon: Warehouse, title: 'Give your stock a home', description: 'In Settings, create a warehouse and a location where items will be stored.', href: '/settings', destination: 'Open Settings' },
    { number: '02', icon: Package, title: 'Build your catalog', description: 'Add products in Products. You can organize them with categories whenever you like.', href: '/products', destination: 'Open Products' },
    { number: '03', icon: ArrowLeftRight, title: 'Record your first movement', description: 'Create a receipt in Operations and validate it to update stock and the ledger.', href: '/operations?add=operation', destination: 'Create an operation' },
  ] as const;

  return (
    <section className="cr-onboarding" aria-label="Getting started">
      <div className="cr-kicker">A CLEAR FIRST SHIFT</div>
      <h2 className="cr-onboarding-title">Your control room starts with a place.</h2>
      <p className="cr-onboarding-copy">Set up a warehouse, build your catalog, then record a movement. Your live picture takes shape as you work.</p>
      <div className="cr-onboarding-grid">
        {steps.map((step) => (
          <article className="cr-onboarding-card" key={step.number}>
            <div className="cr-onboarding-card-top">
              <span className="cr-onboarding-icon"><step.icon size={19} aria-hidden="true" /></span>
              <span className="cr-onboarding-step">{step.number} / 03</span>
            </div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
            <Link href={step.href} data-testid={`link-onboarding-${step.number}`}>{step.destination}<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<typeof statusTabs[number]['value']>('all');
  const [query, setQuery] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [selection, setSelection] = useState<OverviewSelection | null>(null);
  const dashboard = useGetDashboard();
  const operations = useListOperations();
  const products = useListProducts();
  const warehouses = useListWarehouses();

  const sortedOperations = useMemo(
    () => [...(operations.data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [operations.data],
  );
  const visibleProducts = useMemo(() => {
    const term = productQuery.trim().toLowerCase();
    return [...(products.data ?? [])]
      .sort((a, b) => {
        const priority = (status: string) => status === 'out' ? 0 : status === 'low' ? 1 : 2;
        return priority(a.stockStatus) - priority(b.stockStatus) || a.name.localeCompare(b.name);
      })
      .filter(product => !term || `${product.name} ${product.sku}`.toLowerCase().includes(term));
  }, [products.data, productQuery]);
  const openOperations = sortedOperations.filter((operation) => openStatuses.includes(operation.status));
  const waiting = sortedOperations.filter((operation) => operation.status === 'waiting');
  const lead = [...openOperations].sort((a, b) => {
    const queueOrder = (status: OperationStatus) => status === 'ready' ? 0 : status === 'waiting' ? 1 : 2;
    const byQueue = queueOrder(a.status) - queueOrder(b.status);
    if (byQueue) return byQueue;
    const aScheduled = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    const bScheduled = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    return aScheduled - bScheduled
      || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      || a.id - b.id;
  })[0];
  const visibleOperations = sortedOperations.filter((operation) => {
    const matchesStatus = filter === 'all'
      || (filter === 'open' ? openStatuses.includes(operation.status) : operation.status === filter);
    const searchText = [
      operation.reference,
      operation.type,
      operation.contact ?? '',
      operation.sourceLocationName ?? '',
      operation.destinationLocationName ?? '',
      ...operation.lines.flatMap((line) => [line.productName, line.sku]),
    ].join(' ').toLowerCase();
    return matchesStatus && searchText.includes(query.trim().toLowerCase());
  });
  const hasFilters = filter !== 'all' || query.length > 0;
  const clearFilters = () => {
    setFilter('all');
    setQuery('');
  };
  const confirmedEmptyWorkspace = !dashboard.isLoading && !operations.isLoading
    && !dashboard.isError && !operations.isError
    && dashboard.data?.totalProducts === 0
    && dashboard.data?.totalUnits === 0
    && sortedOperations.length === 0
    && (dashboard.data?.recentMoves.length ?? 0) === 0;

  if (confirmedEmptyWorkspace) {
    return <Shell title="Overview"><main className="page cr-page"><NewWorkspaceGuide /></main></Shell>;
  }

  const leadType = lead ? lead.type.charAt(0).toUpperCase() + lead.type.slice(1) : '';
  const leadNextStep = lead?.status === 'waiting'
    ? 'Review the operation details and confirm what is still needed.'
    : lead?.status === 'ready'
      ? 'Review the lines and locations, then validate on the operation page.'
      : 'Complete the draft details before moving it into the workflow.';

  return (
    <Shell title="Overview">
      <main className="page cr-page">
        <div className="cr-root">
          <div className="cr-kicker">STOCKSENSE / OVERVIEW</div>
          <div className="cr-heading">
            <div className="section-heading-copy">
              <SectionHeadingIcon section="overview"/>
              <div>
                <h1 className="cr-title">Keep stock moving.</h1>
                <p className="cr-description">A working view of what’s moving, what’s waiting, and what needs your call.</p>
              </div>
            </div>
            <div className="cr-heading-action">
              <div className="cr-live"><i /> LIVE WORKSPACE DATA</div>
              <Link href="/operations?add=operation" className="cr-create" data-testid="link-new-operation"><Plus size={15} />New operation</Link>
              <Link href="/intelligence" className="cr-ledger-link" data-testid="link-dashboard-intelligence"><ScanSearch size={13} />Inventory intelligence</Link>
            </div>
          </div>

          <section className="cr-brief" aria-label="Live workspace summary" data-testid="section-live-summary">
            <div>
              <div className="cr-brief-label">The work in front of you</div>
              <div className="cr-brief-copy">
                {operations.isLoading ? 'Loading your operation queue…' : operations.isError
                  ? 'Operation queue is temporarily unavailable.'
                  : <><strong>{openOperations.length} open {openOperations.length === 1 ? 'operation' : 'operations'}</strong> remain in the workflow.</>}
              </div>
            </div>
            <div className="cr-metrics">
              <div className="cr-metric"><b>{operations.isError || operations.isLoading ? '—' : numberText(openOperations.length)}</b><span>Open</span></div>
              <div className="cr-metric"><b>{operations.isError || operations.isLoading ? '—' : numberText(waiting.length)}</b><span>Waiting</span></div>
              <div className="cr-metric"><b>{dashboard.data ? numberText(dashboard.data.totalProducts) : '—'}</b><span>Products</span></div>
              <div className="cr-metric"><b>{dashboard.data ? numberText(dashboard.data.totalUnits) : '—'}</b><span>Units on hand</span></div>
            </div>
          </section>

          <section className="cr-next" aria-label="Recommended next operation">
            {operations.isLoading ? (
              <div className="cr-next-main"><span className="cr-next-icon"><Clock3 size={18} /></span><div className="cr-next-copy"><div className="cr-next-label">Recommended next operation</div><b>Checking your live queue…</b></div></div>
            ) : operations.isError ? (
              <div className="cr-next-main"><span className="cr-next-icon"><AlertCircle size={18} /></span><div className="cr-next-copy"><div className="cr-next-label">Recommended next operation</div><b>Queue unavailable right now.</b><small>Retry the operation list to get a current recommendation.</small></div><button className="cr-btn" type="button" onClick={() => operations.refetch()} data-testid="button-retry-recommended">Retry</button></div>
            ) : lead ? (
              <div className="cr-next-main">
                <span className="cr-next-icon"><ClipboardCheck size={18} /></span>
                <div className="cr-next-copy">
                  <div className="cr-next-label">Next in queue · {leadType} {lead.reference}</div>
                  <b>{lead.status === 'waiting' ? 'Review' : lead.status === 'ready' ? 'Validate' : 'Complete'} this {lead.type}</b>
                  <small>{operationItems(lead)} · {operationQuantity(lead)} · {leadNextStep}</small>
                </div>
                <button className="cr-btn primary" type="button" onClick={() => setSelection({ kind: 'operation', id: lead.id })} data-testid={`button-recommended-operation-${lead.id}`}><ArrowUpRight size={13} />Review operation</button>
              </div>
            ) : (
              <div className="cr-next-main">
                <span className="cr-next-icon"><Check size={18} /></span>
                <div className="cr-next-copy"><div className="cr-next-label">Recommended next operation</div><b>No open operations remain in the queue.</b><small>{sortedOperations.length ? 'Your current queue has no draft, waiting, or ready operations.' : 'Create an operation when you’re ready to record a stock movement.'}</small></div>
              </div>
            )}
            <div className="cr-note"><Clock3 size={14} /><span><strong>Queue order:</strong> ready, then waiting, then draft. Within each status, earliest scheduled comes first; oldest creation time breaks ties and orders unscheduled operations. This is workflow order, not an urgency rating. Stock moves only when validated.</span></div>
          </section>

          <section aria-label="Operations movement board">
            <div className="cr-section-head">
              <div><div className="cr-kicker">THE MOVEMENT BOARD</div><h2>Operations in motion</h2></div>
              <div className="cr-head-meta">{operations.isError ? 'QUEUE UNAVAILABLE' : `${visibleOperations.length} SHOWN · MOST RECENT FIRST`}</div>
            </div>
            <div className="cr-filters">
              <div className="cr-tabs" role="tablist" aria-label="Filter operations by status">
                {statusTabs.map((tab) => {
                  const count = tab.value === 'all' ? sortedOperations.length
                    : tab.value === 'open' ? openOperations.length
                      : sortedOperations.filter((operation) => operation.status === tab.value).length;
                  return <button key={tab.value} type="button" role="tab" aria-selected={filter === tab.value} className={`cr-tab ${filter === tab.value ? 'active' : ''}`} onClick={() => setFilter(tab.value)} data-testid={`tab-operation-${tab.value}`}>{tab.label}<em>{operations.isError || operations.isLoading ? '—' : count}</em></button>;
                })}
              </div>
              <div className="cr-filter-row">
                <label className="cr-search"><Search size={13} /><input type="search" aria-label="Search operations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, product or SKU" data-testid="input-search-dashboard-operations" /></label>
                {hasFilters && <button type="button" className="cr-reset" onClick={clearFilters} data-testid="button-clear-operation-filters">Reset</button>}
              </div>
            </div>
            {operations.isLoading ? <LoadingRows />
              : operations.isError ? <QueryError retry={() => operations.refetch()} />
                : !sortedOperations.length ? (
                  <div className="cr-empty"><Package size={21} /><b>No operations recorded yet.</b><span>Start a real operation when stock is ready to move.</span><Link href="/operations?add=operation" className="cr-btn primary" data-testid="link-empty-create-operation"><Plus size={13} />New operation</Link></div>
                ) : visibleOperations.length === 0 ? (
                  <div className="cr-empty"><Package size={21} /><b>No operations in this view.</b><span>Try another status or search term.</span>{hasFilters && <button type="button" className="cr-btn" onClick={clearFilters} data-testid="button-reset-empty-operation-filters">Reset filters</button>}</div>
                ) : (
                  <div className="cr-board">
                    <div className="cr-table-head"><span>Operation / items</span><span>Type / created</span><span>From / to</span><span>Lines / quantity</span><span>Status</span><span /></div>
                    {visibleOperations.map((operation) => {
                      const Icon = typeIcons[operation.type];
                      const from = operation.sourceLocationName || (operation.type === 'receipt' ? operation.contact : null) || 'External';
                      const to = operation.destinationLocationName || (operation.type === 'delivery' ? operation.contact : null) || 'External';
                      return (
                        <div id={`operation-${operation.id}`} key={operation.id} className="cr-operation-row">
                          <Link href={`/operations/${operation.id}`} className="cr-operation-primary" data-testid={`row-dashboard-operation-${operation.id}`} aria-label={`Open ${operation.reference}, ${operation.type}, ${statusLabel(operation)}`}>
                          <span className="cr-idline"><span className={`cr-type-icon ${operation.type}`}><Icon size={15} aria-hidden="true" /></span><span className="cr-op-copy"><span className="cr-ref">{operation.reference}</span><span className="cr-product">{operationItems(operation)}</span><span className="cr-sku">{operation.lines.map((line) => line.sku).filter(Boolean).join(', ') || 'No product SKU'}</span></span></span>
                          <span className="cr-route"><b>{operation.type}</b><span>{dateText(operation.createdAt)}</span></span>
                          <span className="cr-route cr-route-flow"><span>{from}</span><ArrowRight size={11} aria-hidden="true" /><span>{to}</span></span>
                          <span className="cr-qty"><b>{operation.lines.length}</b><span>{operationQuantity(operation)}</span></span>
                          <span className="cr-status-wrap"><span className={`cr-status ${operation.status}`}><i />{statusLabel(operation)}</span>{operation.deliveryCompletedAt && <small>Done {dateText(operation.deliveryCompletedAt)}</small>}</span>
                          </Link>
                          <button type="button" onClick={() => setSelection({ kind: 'operation', id: operation.id })} className="cr-row-open" aria-label={`Review ${operation.reference}`} aria-haspopup="dialog" data-testid={`button-review-dashboard-operation-${operation.id}`}>
                            Review<ArrowUpRight size={14} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
            <div className="cr-foot"><Activity size={12} /> Live operation records <span>·</span> Status changes are managed and confirmed on each operation</div>
          </section>

          <div className="cr-lower">
            <section className="cr-lower-card" aria-label="Recent confirmed stock movement">
              <div className="cr-lower-title"><Truck size={15} /> Recent stock movement<Link href="/moves" className="cr-ledger-link" data-testid="link-control-room-ledger">Stock ledger<ArrowUpRight size={13} /></Link></div>
              {dashboard.isLoading ? <p className="cr-lower-copy">Loading recent confirmed movements…</p>
                : dashboard.isError ? <div className="cr-inline-error"><AlertCircle size={15} />Stock movement context is unavailable. <button type="button" onClick={() => dashboard.refetch()} data-testid="button-retry-dashboard-moves">Retry</button></div>
                  : dashboard.data?.recentMoves.length ? (
                    <div className="cr-recent-list">
                      {dashboard.data.recentMoves.slice(0, 3).map((move) => (
                        <article className="cr-recent-item" key={move.id} data-testid={`recent-move-${move.id}`}>
                          <div><button type="button" className="cr-recent-product" onClick={() => setSelection({ kind: 'product', id: move.productId })} data-testid={`button-recent-product-${move.id}-${move.productId}`}>{move.productName}</button><span>{move.reference} · {move.type}</span></div>
                          <strong>{numberText(move.quantity)}</strong>
                          <time dateTime={move.movedAt}>{dateText(move.movedAt)}</time>
                          {move.operationId !== null && <Link href={`/operations/${move.operationId}`} className="cr-recent-operation" data-testid={`link-recent-operation-${move.id}-${move.operationId}`}>Operation<ArrowUpRight size={12} /></Link>}
                        </article>
                      ))}
                    </div>
                  ) : <p className="cr-lower-copy">No confirmed stock movements have been recorded yet.</p>}
              {dashboard.data && <div className="cr-stock-context"><Boxes size={14} /><span>{numberText(dashboard.data.totalUnits)} units across {numberText(dashboard.data.totalProducts)} products</span><span className="cr-context-separator">·</span><span>{numberText(dashboard.data.lowStockItems)} low · {numberText(dashboard.data.outOfStockItems)} out of stock</span></div>}
            </section>
            <section className="cr-lower-card">
              <div className="cr-lower-title"><Warehouse size={15} /> Workspace context</div>
              {warehouses.isLoading ? <p className="cr-lower-copy">Loading warehouse details…</p>
                : warehouses.isError ? <div className="cr-inline-error"><AlertCircle size={15} />Warehouse context is unavailable. <button type="button" onClick={() => warehouses.refetch()} data-testid="button-retry-warehouses">Retry</button></div>
                  : warehouses.data?.length ? (
                    <>
                      <p className="cr-lower-copy">{warehouses.data.length} {warehouses.data.length === 1 ? 'warehouse' : 'warehouses'} in this workspace.</p>
                      <div className="cr-warehouse-list">{warehouses.data.slice(0, 4).map((item) => <span key={item.id}><Warehouse size={13} />{item.name}<small>{item.locationCount} {item.locationCount === 1 ? 'location' : 'locations'}</small></span>)}</div>
                    </>
                  ) : <p className="cr-lower-copy">No warehouses are configured yet. Add one in Settings before recording a movement.</p>}
            </section>
            <section className="cr-lower-card cr-product-browser" aria-label="Find a product">
              <div className="cr-lower-title"><Package size={15} /> Find a product <span className="cr-product-total">{products.isError || products.isLoading ? '—' : `${visibleProducts.length} found`}</span></div>
              <label className="cr-product-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={productQuery}
                  onChange={event => setProductQuery(event.target.value)}
                  placeholder="Search product name or SKU"
                  aria-label="Search products in Overview"
                  data-testid="input-search-overview-products"
                />
              </label>
              {products.isLoading ? <p className="cr-lower-copy">Loading products…</p>
                : products.isError ? <div className="cr-inline-error"><AlertCircle size={15} />Product catalog is unavailable. <button type="button" onClick={() => products.refetch()} data-testid="button-retry-overview-products">Retry</button></div>
                  : visibleProducts.length ? (
                    <div className="cr-product-list">
                      {visibleProducts.map(product => (
                        <button
                          type="button"
                          className="cr-product-option"
                          key={product.id}
                          onClick={() => setSelection({ kind: 'product', id: product.id })}
                          aria-haspopup="dialog"
                          data-testid={`button-overview-product-${product.id}`}
                        >
                          <span className="cr-product-option-icon"><Package size={15} aria-hidden="true" /></span>
                          <span className="cr-product-option-copy"><strong>{product.name}</strong><small>{product.sku} · {numberText(product.totalStock)} {product.unit} on hand</small></span>
                          <Status value={product.stockStatus} />
                          <ArrowUpRight className="cr-product-option-open" size={14} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="cr-product-empty">
                      <span>{productQuery ? 'No products match that search.' : 'No products are in the catalog yet.'}</span>
                      {!productQuery && <Link href="/products" className="cr-ledger-link">Add a product<ArrowUpRight size={12} /></Link>}
                    </div>
                  )}
            </section>
          </div>

          {(dashboard.isError || operations.isError || products.isError || warehouses.isError) && <div className="cr-partial-note" role="status"><AlertCircle size={15} />Some live workspace details could not be loaded. Available information is shown where possible.</div>}
        </div>
      </main>
      <OverviewSelectionPanel
        selection={selection}
        operation={selection?.kind === 'operation' ? operations.data?.find(item => item.id === selection.id) : undefined}
        product={selection?.kind === 'product' ? products.data?.find(item => item.id === selection.id) : undefined}
        operationsLoading={operations.isLoading}
        operationsError={operations.isError}
        productsLoading={products.isLoading}
        productsError={products.isError}
        retryOperations={() => { void operations.refetch(); }}
        retryProducts={() => { void products.refetch(); }}
        onClose={() => setSelection(null)}
      />
    </Shell>
  );
}