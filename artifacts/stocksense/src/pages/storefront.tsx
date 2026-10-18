import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPublicStorefrontQueryKey,
  useCreatePublicStorefrontOrder,
  useGetPublicStorefront,
  type PublicStorefrontProduct,
  type StorefrontOrderInput,
  type StorefrontOrderResult,
} from '@workspace/api-client-react';
import { ArrowRight, Check, CircleAlert, Minus, Package, Plus, Search, ShieldCheck, ShoppingBag, Store } from 'lucide-react';
import { DEFAULT_IMAGE_FIT, FittedImage } from '../components/photo-fit-editor';
import './storefront.css';

type StorefrontPageProps = { slug: string };

function currencyPrice(product: PublicStorefrontProduct, quantity = 1) {
  if (product.sellingPrice === null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: product.currencyCode, maximumFractionDigits: 2 }).format(product.sellingPrice * quantity);
  } catch {
    return `${product.currencyCode} ${(product.sellingPrice * quantity).toFixed(2)}`;
  }
}

export function StorefrontPage({ slug }: StorefrontPageProps) {
  const queryClient = useQueryClient();
  const store = useGetPublicStorefront(slug, { query: { queryKey: getGetPublicStorefrontQueryKey(slug), enabled: Boolean(slug), refetchInterval: 10000 } });
  const createOrder = useCreatePublicStorefrontOrder();
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [basket, setBasket] = useState<Record<number, number>>({});
  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '', deliveryAddress: '' });
  const [orderResult, setOrderResult] = useState<StorefrontOrderResult | null>(null);
  const [orderError, setOrderError] = useState('');

  const products = store.data?.products ?? [];
  const shownProducts = useMemo(() => products.filter(product => {
    const matchesCategory = selectedCategory === null || product.categoryId === selectedCategory;
    return matchesCategory && product.name.toLowerCase().includes(search.trim().toLowerCase());
  }), [products, selectedCategory, search]);
  const basketLines = products.filter(product => (basket[product.id] ?? 0) > 0);
  const basketCount = basketLines.reduce((total, product) => total + (basket[product.id] ?? 0), 0);

  const changeQuantity = (product: PublicStorefrontProduct, delta: number) => {
    setBasket(current => {
      const next = Math.max(0, Math.min(product.availableStock, (current[product.id] ?? 0) + delta));
      return { ...current, [product.id]: next };
    });
    setOrderResult(null);
  };

  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!basketLines.length) return;
    setOrderError('');
    const data: StorefrontOrderInput = {
      ...form,
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      customerPhone: form.customerPhone.trim(),
      deliveryAddress: form.deliveryAddress.trim(),
      lines: basketLines.map(product => ({ productId: product.id, quantity: basket[product.id] })),
    };
    createOrder.mutate({ slug, data }, {
      onSuccess: result => {
        setOrderResult(result);
        setBasket({});
        setForm({ customerName: '', customerEmail: '', customerPhone: '', deliveryAddress: '' });
        void queryClient.invalidateQueries({ queryKey: getGetPublicStorefrontQueryKey(slug) });
      },
      onError: () => setOrderError('Your request could not be submitted. Please check the details and try again.'),
    });
  };

  if (store.isLoading) {
    return <main className="ss-storefront"><header className="sf-topbar"><div className="sf-brand"><span className="sf-brand-mark"><Store size={17} /></span>StockSense</div><span className="sf-topnote"><i /> Independent seller</span></header><div className="sf-page" role="status" aria-label="Loading storefront"><div className="sf-skeleton" style={{ height: 100, marginBottom: 20 }} /><div className="sf-product-grid">{[1, 2, 3, 4].map(item => <div key={item} className="sf-skeleton" />)}</div></div></main>;
  }
  if (store.isError || !store.data) {
    return <main className="ss-storefront"><div className="sf-public-error"><span className="sf-brand-mark"><Store size={20} /></span><h1>This storefront isn’t available</h1><p>The address may be incorrect, or the seller may have paused their storefront.</p><button type="button" className="btn btn-outline" onClick={() => void store.refetch()} data-testid="button-retry-public-storefront">Try again</button></div></main>;
  }

  const storefront = store.data;
  const categories = storefront.categories;
  const design = storefront.design;
  const heroImage = design.heroImageAssetId ? `/api/storefronts/${encodeURIComponent(slug)}/assets/${design.heroImageAssetId}` : undefined;
  const setField = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }));

  return (
    <main className={`ss-storefront theme-${design.theme} layout-${design.layout}`}>
      <header className="sf-topbar">
        <div className="sf-brand"><span className="sf-brand-mark"><Store size={17} aria-hidden="true" /></span>{storefront.storeName}</div>
        <span className="sf-topnote"><i /> Independent seller · live stock</span>
      </header>
      <div className="sf-page">
        <section className={`sf-hero ${heroImage ? 'has-image' : ''}`}>
          {heroImage && <FittedImage className="sf-hero-image" src={heroImage} alt="" fit={design.heroImageFit ?? DEFAULT_IMAGE_FIT} loading="eager" />}
          <div>
            <div className="sf-eyebrow">A STOCKSENSE STOREFRONT / {storefront.slug}</div>
            <h1>{storefront.storeName}</h1>
            {design.tagline && <p className="sf-tagline">{design.tagline}</p>}
            <p>{design.description || 'Browse what’s available today. Send a delivery request and the seller will review it with you.'}</p>
            <div className="sf-hero-availability">Available products · live inventory</div>
          </div>
          {!heroImage && <span className="sf-hero-mark" aria-hidden="true"><Package size={40} /></span>}
        </section>

        {orderResult && <div className="sf-inline-state success" role="status" data-testid="status-order-success"><Check size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Request received · <strong>{orderResult.reference}</strong> — {orderResult.message}</div>}
        {orderError && <div className="sf-inline-state error" role="alert" data-testid="status-order-error"><CircleAlert size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} />{orderError}</div>}

        <div className="sf-toolbar">
          <div className="sf-categories" aria-label="Filter products by category">
            <button type="button" className={`sf-chip ${selectedCategory === null ? 'active' : ''}`} onClick={() => setSelectedCategory(null)} aria-pressed={selectedCategory === null} data-testid="filter-store-category-all">All items</button>
            {categories.map(category => <button key={category.id} type="button" className={`sf-chip ${selectedCategory === category.id ? 'active' : ''}`} onClick={() => setSelectedCategory(category.id)} aria-pressed={selectedCategory === category.id} data-testid={`filter-store-category-${category.id}`}>{category.name}<span aria-hidden="true"> · {category.productCount}</span></button>)}
          </div>
          <label className="sf-search"><Search size={14} aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search products" placeholder="Find an item" data-testid="input-storefront-search" /></label>
        </div>

        <div className="sf-catalog-layout">
          <section aria-label="Available products">
            {shownProducts.length ? <div className="sf-product-grid">
              {shownProducts.map(product => {
                const quantity = basket[product.id] ?? 0;
                const out = product.stockStatus === 'out' || product.availableStock <= 0;
                return (
                  <article className="sf-product" key={product.id} data-testid={`card-storefront-product-${product.id}`}>
                    {product.imageAssetId && <FittedImage className="sf-product-photo" src={`/api/storefronts/${encodeURIComponent(slug)}/assets/${product.imageAssetId}`} alt={product.name} fit={product.imageFit} loading="lazy" />}
                    <div className="sf-product-top"><span className="sf-product-icon"><Package size={17} aria-hidden="true" /></span><span className={`sf-stock ${product.stockStatus}`}>{product.stockStatus === 'out' ? 'Unavailable' : product.stockStatus === 'low' ? 'Limited stock' : 'In stock'}</span></div>
                    <h2>{product.name}</h2>
                    <span className="sf-product-category">{product.categoryName || 'General'} · {product.availableStock} {product.unit} available</span>
                    <div className="sf-product-bottom">
                      <div className="sf-price">{currencyPrice(product) ?? 'Price not listed'}<small>{product.sellingPrice === null ? 'Ask seller for pricing' : `per ${product.unit}`}</small></div>
                      <div className="sf-qty-control" aria-label={`Quantity for ${product.name}`}>
                        <button type="button" onClick={() => changeQuantity(product, -1)} disabled={quantity === 0} aria-label={`Remove one ${product.name}`} data-testid={`button-storefront-minus-${product.id}`}><Minus size={13} /></button>
                        <output aria-label={`${quantity} selected`} data-testid={`text-storefront-quantity-${product.id}`}>{quantity}</output>
                        <button type="button" onClick={() => changeQuantity(product, 1)} disabled={out || quantity >= product.availableStock} aria-label={`Add one ${product.name}`} data-testid={`button-storefront-plus-${product.id}`}><Plus size={13} /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div> : <div className="sf-empty"><Package size={23} aria-hidden="true" /><strong>{products.length ? 'No matching items' : 'Nothing on the shelf yet'}</strong><span>{products.length ? 'Try a different search or category.' : 'This seller has not listed any live products.'}</span></div>}
          </section>

          <aside className="sf-basket" aria-label="Delivery request basket">
            <div className="sf-basket-head"><h2>Your request</h2><span className="sf-basket-count">{basketCount} {basketCount === 1 ? 'item' : 'items'}</span></div>
            <div className="sf-basket-body">
              {basketLines.length ? <div className="sf-basket-lines">
                {basketLines.map(product => <div className="sf-basket-line" key={product.id} data-testid={`row-storefront-basket-${product.id}`}><span>{product.name}<small>{basket[product.id]} × {product.unit}</small></span><b>{currencyPrice(product, basket[product.id]) ?? 'Unpriced'}</b></div>)}
              </div> : <div className="sf-basket-empty"><ShoppingBag size={18} style={{ display: 'block', marginBottom: 8 }} />Choose available quantities to start a delivery request.</div>}
              <div className="sf-payment-note"><ShieldCheck size={15} aria-hidden="true" /><span>No online payment. This is a request for the seller to review; payment is arranged offline or on delivery.</span></div>
              <form className="sf-checkout-form" onSubmit={submitOrder}>
                <h3 className="sf-form-heading">Delivery details</h3>
                <label className="sf-field-wrap"><span className="sf-label">Full name</span><input className="sf-field" autoComplete="name" required maxLength={120} value={form.customerName} onChange={event => setField('customerName', event.target.value)} placeholder="Name for the delivery" data-testid="input-order-customer-name" /></label>
                <label className="sf-field-wrap"><span className="sf-label">Email address</span><input className="sf-field" type="email" autoComplete="email" required maxLength={254} value={form.customerEmail} onChange={event => setField('customerEmail', event.target.value)} placeholder="you@example.com" data-testid="input-order-customer-email" /></label>
                <label className="sf-field-wrap"><span className="sf-label">Phone number</span><input className="sf-field" type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" title="Use international format, for example +15551234567" value={form.customerPhone} onChange={event => setField('customerPhone', event.target.value)} placeholder="+15551234567" data-testid="input-order-customer-phone" /></label>
                <label className="sf-field-wrap"><span className="sf-label">Delivery address</span><textarea className="sf-field" autoComplete="street-address" required minLength={5} maxLength={500} value={form.deliveryAddress} onChange={event => setField('deliveryAddress', event.target.value)} placeholder="Street, area, and any useful directions" data-testid="input-order-delivery-address" /></label>
                <button type="submit" className="sf-submit" disabled={!basketLines.length || createOrder.isPending} data-testid="button-submit-storefront-order">{createOrder.isPending ? 'Sending request…' : <>Send delivery request <ArrowRight size={15} aria-hidden="true" /></>}</button>
              </form>
            </div>
          </aside>
        </div>
        <footer style={{ marginTop: 37, paddingTop: 17, borderTop: '1px solid #d5e1d5', color: '#82958a', fontSize: 10 }}>Stock availability reflects the seller’s selected fulfillment location. Your request is not confirmed until reviewed.</footer>
      </div>
    </main>
  );
}

export default StorefrontPage;
