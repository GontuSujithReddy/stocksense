import { useState } from 'react';
import { Link } from 'wouter';
import { useListMoves, useListWarehouses, type OperationType, type StockMoveEffect } from '@workspace/api-client-react';
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, ClipboardList, History, MapPin, Package } from 'lucide-react';
import { Empty, LoadingRows, PageHeading, QueryError, SearchField, Shell, dateText, numberText } from '../components/common';
import './moves.css';

function MovementIcon({ type }: { type: OperationType }) {
  if (type === 'receipt') return <ArrowDownLeft aria-hidden="true" size={14} />;
  if (type === 'delivery') return <ArrowUpRight aria-hidden="true" size={14} />;
  if (type === 'transfer') return <ArrowLeftRight aria-hidden="true" size={14} />;
  return <ClipboardList aria-hidden="true" size={14} />;
}

function MovementEffect({ effect, moveId }: { effect: StockMoveEffect; moveId: number }) {
  const added = effect.quantityAdded > 0 ? `+${numberText(effect.quantityAdded)}` : numberText(effect.quantityAdded);
  const removed = effect.quantityRemoved > 0 ? `−${numberText(effect.quantityRemoved)}` : numberText(effect.quantityRemoved);

  return (
    <section
      className={`moves-effect-card ${effect.side}`}
      aria-label={`${effect.side} effect at ${effect.locationName}, ${effect.warehouseName}`}
      data-testid={`row-move-effect-${moveId}-${effect.locationId}-${effect.side}`}
    >
      <div className="moves-effect-heading">
        <span className={`moves-side-marker ${effect.side}`}>{effect.side}</span>
        <span className="moves-location"><MapPin aria-hidden="true" size={12} />{effect.locationName}</span>
        <span className="moves-warehouse">{effect.warehouseName}</span>
      </div>
      <div className="moves-effect-values">
        <div><small>Before</small><strong>{numberText(effect.quantityBefore)}</strong></div>
        <div><small>Added</small><strong className={effect.quantityAdded ? 'added' : ''}>{added}</strong></div>
        <div><small>Used / removed</small><strong className={effect.quantityRemoved ? 'removed' : ''}>{removed}</strong></div>
        <div className="remaining"><small>Remaining</small><strong>{numberText(effect.quantityRemaining)}</strong></div>
      </div>
    </section>
  );
}

export default function MovesPage() {
  const [search, setSearch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [type, setType] = useState('');
  const warehouses = useListWarehouses();
  const q = useListMoves({
    ...(search ? { search } : {}),
    ...(warehouse ? { warehouseId: Number(warehouse) } : {}),
    ...(type ? { type: type as OperationType } : {}),
  });

  const movementCount = q.data?.length;
  const hasFilters = Boolean(search || warehouse || type);
  const clearFilters = () => {
    setSearch('');
    setWarehouse('');
    setType('');
  };

  return (
    <Shell title="Stock ledger">
      <main className="page moves-page">
        <PageHeading
          eyebrow="AUDIT TRAIL"
          title="Stock ledger"
          description="See what changed and the remaining stock at every affected location."
        />

        <section className="panel moves-panel" aria-label="Stock movement ledger">
          <div className="moves-panel-heading">
            <div>
              <div className="moves-panel-title">
                <span className="moves-panel-icon"><History aria-hidden="true" size={16} /></span>
                <h2>Movement history</h2>
              </div>
              <p>Each location effect is shown separately, including both sides of a transfer.</p>
            </div>
            <span className="moves-audit-tag">LOCATION-LEVEL RECORDS</span>
          </div>

          <div className="moves-filters">
            <label className="moves-search">
              <span className="moves-sr-only">Search products or SKU</span>
              <SearchField value={search} onChange={setSearch} placeholder="Search products or SKU" />
            </label>
            <label className="moves-filter-select">
              <span className="moves-sr-only">Filter by warehouse</span>
              <select
                className="field"
                value={warehouse}
                onChange={event => setWarehouse(event.target.value)}
                data-testid="select-move-warehouse"
                aria-label="Filter by warehouse"
              >
                <option value="">All warehouses</option>
                {warehouses.data?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="moves-filter-select type-filter">
              <span className="moves-sr-only">Filter by movement type</span>
              <select
                className="field"
                value={type}
                onChange={event => setType(event.target.value)}
                data-testid="select-move-type"
                aria-label="Filter by movement type"
              >
                <option value="">All movements</option>
                {(['receipt', 'delivery', 'transfer', 'adjustment'] as OperationType[]).map(value => (
                  <option value={value} key={value}>{value}</option>
                ))}
              </select>
            </label>
            {hasFilters && <button className="moves-reset" type="button" onClick={clearFilters}>Clear filters</button>}
          </div>

          <div className="moves-result-meta">
            <span><strong>{movementCount ?? '—'}</strong> recorded {movementCount === 1 ? 'movement' : 'movements'}</span>
            <span>Quantities belong to the labeled location</span>
          </div>

          {q.isLoading ? (
            <div className="moves-loading"><LoadingRows /></div>
          ) : q.isError ? (
            <QueryError retry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <Empty
              title="No movements found"
              description="Validated stock operations and stock clearing leave a permanent record here."
            />
          ) : (
            <div className="moves-list">
              {q.data.map(move => (
                <article className="moves-card" key={move.id} data-testid={`row-move-${move.id}`}>
                  <div className="moves-card-heading">
                    <div className="moves-date">
                      <time dateTime={String(move.movedAt)}>{dateText(move.movedAt)}</time>
                    </div>
                    <div className="moves-product">
                      <span className="moves-product-icon"><Package aria-hidden="true" size={16} /></span>
                      <span className="moves-product-copy">
                        {move.productActive ? (
                          <Link href={`/products/${move.productId}`} className="moves-product-link" data-testid={`link-move-product-${move.id}`}>
                            {move.productName}
                          </Link>
                        ) : <strong className="moves-product-name">{move.productName}</strong>}
                        <small>{move.sku}{!move.productActive && <em>Archived</em>}</small>
                      </span>
                    </div>
                    <div className="moves-operation">
                      <span className={`moves-type-badge ${move.type}`}>
                        <MovementIcon type={move.type} />
                        {move.reference.startsWith('ARCH-') ? 'Stock cleared & archived' : move.type}
                      </span>
                      {move.operationId ? (
                        <Link href={`/operations/${move.operationId}`} className="moves-reference" data-testid={`link-move-operation-${move.id}`}>
                          {move.reference}
                        </Link>
                      ) : <span className="moves-reference">{move.reference}</span>}
                    </div>
                    <div className="moves-route">
                      <small>Movement route</small>
                      <span className="moves-route-path">
                        <span>{move.sourceLocationName || 'External'}</span>
                        <ArrowRight aria-hidden="true" size={13} />
                        <span>{move.destinationLocationName || 'External'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="moves-effect-labels" aria-hidden="true">
                    <span>Affected location</span><span>Before</span><span>Added</span><span>Used / removed</span><span>Remaining</span>
                  </div>
                  <div className="moves-effects">
                    {move.stockEffects.length ? move.stockEffects.map(effect => (
                      <MovementEffect key={`${effect.locationId}-${effect.side}`} effect={effect} moveId={move.id} />
                    )) : (
                      <div className="moves-effect-card moves-effect-empty" aria-label="Location effect details unavailable">
                        <div className="moves-effect-empty-location">Location details unavailable</div>
                        <div className="moves-effect-empty-value"><small>Before</small><strong>—</strong></div>
                        <div className="moves-effect-empty-value"><small>Added</small><strong>—</strong></div>
                        <div className="moves-effect-empty-value"><small>Used / removed</small><strong>—</strong></div>
                        <div className="moves-effect-empty-value"><small>Remaining</small><strong>—</strong></div>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="moves-footnote"><History aria-hidden="true" size={14} />Stock clearing and validated operations remain visible here.</div>
      </main>
    </Shell>
  );
}