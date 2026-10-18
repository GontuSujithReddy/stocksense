import { useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetProduct, useListLocations, useUpdateProduct, useDeleteProduct, useArchiveProductWithStock, getGetProductQueryKey, getListProductsQueryKey, getGetDashboardQueryKey, getListMovesQueryKey, type ProductUpdate } from '@workspace/api-client-react';
 import { ArrowLeft, ArrowUpRight, Pencil, Trash2, MapPin, Package, Plus, ScanSearch } from 'lucide-react';
import { Shell, LoadingRows, QueryError, Status, Confirm, Modal, numberText, dateText } from '../components/common';
import { ProductForm } from '../components/product-form';
import { ProductStockCountModal } from '../components/product-stock-count';
import { formatSellingPrice, unitLooksLikeQuantity } from '../components/product-display';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const q = useGetProduct(productId);
  const locations = useListLocations();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const clearAndArchive = useArchiveProductWithStock();
  const [editing, setEditing] = useState(false);
  const [stockCountOpen, setStockCountOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [error, setError] = useState('');
  const save = (data: ProductUpdate) => update.mutate({ id: productId, data }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      setEditing(false);
      setError('');
    },
    onError: reason => setError(String(reason)),
  });
  const product = q.data;
  const stockedLocations = product?.locationStocks.filter(stock => stock.quantity !== 0) ?? [];
  const hasStock = stockedLocations.length > 0;
  const closeArchive = () => { setDeleting(false); setClearConfirmed(false); setError(''); };
  const afterArchive = () => {
    qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    qc.invalidateQueries({ queryKey: getListMovesQueryKey() });
    navigate('/products');
  };
  const del = () => {
    setError('');
    if (hasStock) {
      if (!clearConfirmed) return;
      clearAndArchive.mutate({ id: productId }, {
        onSuccess: afterArchive,
        onError: reason => { setError(String(reason)); void q.refetch(); },
      });
    } else {
      remove.mutate({ id: productId }, {
        onSuccess: afterArchive,
        onError: reason => { setError(String(reason)); void q.refetch(); },
      });
    }
  };
  const needsUnitCorrection = !!product && unitLooksLikeQuantity(product.unit);
  const receiptHref = product ? `/operations?add=operation&productId=${product.id}${product.defaultLocationId ? `&locationId=${product.defaultLocationId}` : ''}` : '/operations?add=operation';
  const defaultLocation = locations.data?.find(location => location.id === product?.defaultLocationId);
  const mapQuery = defaultLocation?.latitude != null && defaultLocation.longitude != null
    ? `${defaultLocation.latitude},${defaultLocation.longitude}`
    : defaultLocation?.address?.trim();

  return <Shell title="Product details"><main className="page">
    <Link href="/products" className="btn btn-outline" style={{ marginBottom: 30 }} data-testid="link-back-products"><ArrowLeft size={15} /> All products</Link>
    {q.isLoading ? <LoadingRows /> : q.isError ? <QueryError retry={() => q.refetch()} /> : product && <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 20, flexWrap: 'wrap', marginBottom: 29 }}>
        <div><div className="eyebrow">PRODUCT / <span className="mono">{product.sku}</span></div><h1 className="page-title">{product.name}</h1><div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}><Status value={product.stockStatus} /><span className="subtle" style={{ fontSize: 12 }}>{product.categoryName || 'Uncategorized'} · Created {dateText(product.createdAt)}</span></div></div>
         <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}><Link href={`/intelligence?product=${product.id}`} className="btn btn-soft" data-testid="link-product-intelligence"><ScanSearch size={15} /> Review signals</Link><Link href={receiptHref} className="btn btn-primary" data-testid="link-add-product-stock"><Plus size={15} /> Add stock</Link><button className="btn btn-outline" onClick={() => { setError(''); setEditing(true); }} data-testid="button-edit-product"><Pencil size={15} /> Edit details</button><button className="btn btn-danger" onClick={() => { setError(''); setClearConfirmed(false); setDeleting(true); }} data-testid="button-delete-product"><Trash2 size={15} /> {hasStock ? 'Clear stock & archive' : 'Archive'}</button></div>
      </div>
      {error && <p style={{ color: '#a34432' }} data-testid="status-product-error">{error}</p>}
      {needsUnitCorrection && <div className="panel panel-pad" role="status" style={{ marginBottom: 20, borderColor: '#e4b96b', background: '#fff9ec' }} data-testid="notice-numeric-unit">
        <strong>“{product.unit}” is saved as the unit label, not stock.</strong> Your recorded stock is {numberText(product.totalStock)}. Use Edit details to change the unit to “pieces” or “boxes”, then Add stock to record the actual quantity with a receipt.
      </div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 15, marginBottom: 23 }}>
        <div className="panel panel-pad" data-testid="metric-product-on-hand">
          <div className="eyebrow">On hand · actual stock</div>
          <div className="display" style={{ fontSize: 38, marginTop: 15 }}>{numberText(product.totalStock)} <span style={{ fontSize: 12, color: '#6c8880', letterSpacing: 0 }}>{needsUnitCorrection ? '' : product.unit}</span></div>
          <button
            type="button"
            className="btn btn-outline"
            style={{ marginTop: 13 }}
            onClick={() => setStockCountOpen(true)}
            data-testid="button-edit-product-stock"
          >
            <Pencil size={14} /> Edit count
          </button>
        </div>
        {[{ label: 'Low-stock warning at', value: product.reorderPoint > 0 ? numberText(product.reorderPoint) : 'Off', suffix: product.reorderPoint > 0 && !needsUnitCorrection ? product.unit : '' }, { label: 'Locations with stock', value: String(product.locationStocks.length), suffix: product.locationStocks.length === 1 ? 'location' : 'locations' }].map(item => <div className="panel panel-pad" key={item.label}><div className="eyebrow">{item.label}</div><div className="display" style={{ fontSize: 38, marginTop: 15 }}>{item.value} <span style={{ fontSize: 12, color: '#6c8880', letterSpacing: 0 }}>{item.suffix}</span></div></div>)}
      </div>
      <p className="subtle" style={{ fontSize: 12, margin: '-7px 0 22px' }} data-testid="text-stock-calculation">On hand = the quantities recorded at all locations for this product. The low-stock warning is only a threshold; it is never added to your stock. A receipt changes on hand only after validation.</p>
      {product.sellingPrice !== null && <p className="subtle" style={{ fontSize: 12, margin: '-8px 0 23px' }}>Optional price set for this product: {formatSellingPrice(product.sellingPrice, product.currencyCode)} per unit. This does not publish it for sale.</p>}
      <section className="panel panel-pad" style={{ marginBottom: 23, background: '#f2f7f0' }} aria-label="Default storage location">
        <div className="eyebrow">PRODUCT SETUP / DEFAULT LOCATION</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12 }}><MapPin size={19} color="#408078" /><strong data-testid="text-product-default-location">{product.defaultLocationName ? `${product.defaultWarehouseName} / ${product.defaultLocationName}` : 'No default location set'}</strong></div>
        {defaultLocation?.address && <p className="subtle" style={{ fontSize: 13, margin: '8px 0 0 30px' }} data-testid="text-product-default-address">{defaultLocation.address}</p>}
        {mapQuery && <a className="btn btn-soft" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12 }} data-testid="link-product-default-map">View on Google Maps <ArrowUpRight size={14} /></a>}
        <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, margin: '10px 0 0' }}>This is where the product normally belongs. It is not a count of stock here; changing it does not move existing stock.</p>
      </section>
      <section className="panel"><div style={{ padding: 24, borderBottom: '1px solid #dce6dc' }}><div className="eyebrow">ACTUAL STOCK / LOCATION BREAKDOWN</div><h2 className="display" style={{ fontSize: 22, margin: '6px 0 0' }}>Where stock is recorded</h2></div>
         {product.locationStocks.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: '#66827a' }}><Package size={23} style={{ margin: 'auto' }} /><p>No stock has been recorded for this product yet. A default location is not a stock count. Create and validate a receipt for the quantity at that location.</p><Link href={receiptHref} className="btn btn-primary" data-testid="link-receive-stock">Add stock with a receipt</Link></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Location</th><th>Warehouse</th><th>Quantity</th></tr></thead><tbody>{product.locationStocks.map(stock => <tr key={stock.locationId}><td><span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700 }}><MapPin size={16} color="#408078" />{stock.locationName}</span></td><td className="subtle">{stock.warehouseName}</td><td className="mono" style={{ fontWeight: 700 }}>{numberText(stock.quantity)} <span className="subtle">{needsUnitCorrection ? '' : product.unit}</span></td></tr>)}</tbody></table></div>}
      </section>
    </>}
    {editing && product && <ProductForm product={product} onClose={() => setEditing(false)} onEditStock={() => { setEditing(false); setStockCountOpen(true); }} onSave={data => save(data as ProductUpdate)} busy={update.isPending} error={error} />}
    {stockCountOpen && product && <ProductStockCountModal product={product} onClose={() => setStockCountOpen(false)} />}
    {deleting && product && (hasStock ? <Modal title="Clear stock and archive?" onClose={closeArchive} footer={<><button type="button" className="btn btn-outline" onClick={closeArchive} disabled={clearAndArchive.isPending}>Keep product</button><button type="button" className="btn btn-danger" disabled={!clearConfirmed || clearAndArchive.isPending} onClick={del} data-testid="button-confirm-clear-stock">{clearAndArchive.isPending ? 'Clearing stock…' : 'Clear stock and archive'}</button></>}>
      <p className="subtle" style={{ fontSize: 13, lineHeight: 1.7 }}>This will set the recorded stock for <strong>{product.name}</strong> to zero at {stockedLocations.length} {stockedLocations.length === 1 ? 'location' : 'locations'} and remove the product from your active catalog. This cannot be undone in the app. A record of each stock change will remain in the Stock ledger.</p>
      <ul style={{ paddingLeft: 20, fontSize: 12, lineHeight: 1.9, color: '#586a7d' }}>{stockedLocations.map(stock => <li key={stock.locationId}>{stock.locationName}: {numberText(stock.quantity)} {needsUnitCorrection ? '' : product.unit} → 0</li>)}</ul>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, lineHeight: 1.5, marginTop: 16 }}><input type="checkbox" checked={clearConfirmed} onChange={event => setClearConfirmed(event.target.checked)} data-testid="checkbox-confirm-clear-stock" style={{ marginTop: 3 }} />I understand this removes all of this product’s on-hand stock.</label>
      {error && <p className="location-error" role="alert" data-testid="status-archive-error">{error}</p>}
    </Modal> : <Confirm title="Archive product?" description="This removes the product from your active catalog. Its prior stock history remains in the Stock ledger." onClose={closeArchive} onConfirm={del} busy={remove.isPending} />)}
  </main></Shell>;
}