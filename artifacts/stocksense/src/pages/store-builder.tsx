import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStorefrontAnalyticsQueryKey,
  getGetStorefrontBuilderQueryKey,
  getListProductsQueryKey,
  useGenerateStorefrontDesign,
  useGenerateStorefrontHero,
  useGetOwnerStorefrontAsset,
  useGetStorefrontAnalytics,
  useGetStorefrontBuilder,
  useListProducts,
  usePublishStorefront,
  useRequestStorefrontAssetUpload,
  useSaveStorefrontDraft,
  useUpdateProduct,
  type Product,
  type StorefrontDesign,
} from '@workspace/api-client-react';
import { ArrowUpRight, Check, ExternalLink, ImagePlus, LoaderCircle, Package, RefreshCw, Sparkles, Store, WandSparkles, X } from 'lucide-react';
import { Shell, PageHeading } from '../components/common';
import { AssetFitButton, DEFAULT_IMAGE_FIT, FittedImage, PhotoFitEditor, type ImageFit } from '../components/photo-fit-editor';
import './store-builder.css';

const REPORTING_PRESETS = [7, 30, 90] as const;
const blankDesign: StorefrontDesign = {
  storeName: '',
  tagline: '',
  description: '',
  theme: 'evergreen',
  layout: 'showcase',
  heroImageAssetId: null,
  heroImageFit: DEFAULT_IMAGE_FIT,
};
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

type PhotoDraft = {
  file: File;
  mode: 'replace' | 'adjust';
  target: { type: 'hero' } | { type: 'product'; productId: number };
  initialFit: ImageFit;
};

function PrivateAssetImage({ assetId, alt, className, fit = DEFAULT_IMAGE_FIT }: { assetId: number; alt: string; className: string; fit?: ImageFit }) {
  const image = useGetOwnerStorefrontAsset(assetId);
  const [source, setSource] = useState('');
  useEffect(() => {
    if (!image.data) {
      setSource('');
      return;
    }
    const objectUrl = URL.createObjectURL(image.data);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.data]);
  if (!source) return <span className={`${className} builder-private-image-placeholder`} role="img" aria-label={alt}>
    {image.isError ? 'Image unavailable' : 'Loading image'}
  </span>;
  return <FittedImage className={className} src={source} alt={alt} fit={fit} loading="eager" />;
}

function money(value: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currencyCode} ${value.toFixed(2)}`;
  }
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values.length > 1
    ? values.map((value, index) => `${(index / (values.length - 1)) * 100},${43 - (value / max) * 37}`).join(' ')
    : '0,42 100,42';
  return <svg className="builder-sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Daily order requests trend"><polyline points={points} /></svg>;
}

function StorePreview({ design, slug, publishedSlug, hasPublishedDesign, products, productsLoading, productsError, retryProducts, onUploadProduct, onFitProduct, photoBusy }: { design: StorefrontDesign; slug: string | null; publishedSlug: string | null; hasPublishedDesign: boolean; products: Product[] | undefined; productsLoading: boolean; productsError: boolean; retryProducts: () => void; onUploadProduct: (productId: number) => void; onFitProduct: (productId: number, file: File) => void; photoBusy: boolean }) {
  const previewProducts = (products ?? []).slice(0, 3);
  const storeName = design.storeName.trim() || 'Your store name';
  return (
    <div className="builder-preview-sticky">
      <div className="builder-preview-head">
        <strong>Live design preview</strong>
        <span>Only visible to you until published</span>
      </div>
      <div className="builder-preview-frame">
        <div className="builder-preview-browser"><i /><i /><i /><span>{slug ? `stocksense.store/${slug}` : 'your-store.stocksense'}</span></div>
        <div className={`builder-preview-store theme-${design.theme}`}>
          <div className="builder-preview-nav">
            <span className="builder-preview-brand"><i><Store size={13} /></i>{storeName}</span>
            <small>{design.layout === 'catalog' ? 'SHOP ALL' : design.layout === 'editorial' ? 'OUR STORY' : 'CURATED FOR YOU'}</small>
          </div>
          <section className={`builder-preview-hero ${design.heroImageAssetId ? 'has-image' : ''}`}>
            {design.heroImageAssetId && <PrivateAssetImage assetId={design.heroImageAssetId} alt="Storefront hero image" className="builder-preview-hero-photo" fit={design.heroImageFit ?? DEFAULT_IMAGE_FIT} />}
            <span className="builder-preview-kicker">INDEPENDENT / SELLER-REVIEWED REQUESTS</span>
            <h2>{design.storeName || 'A storefront, made yours.'}</h2>
            {design.tagline && <span className="builder-preview-tagline">{design.tagline}</span>}
            <p>{design.description || 'Your store introduction will appear here. Tell customers what makes your selection worth a closer look.'}</p>
            <span className="builder-preview-cta">Browse available items <ArrowUpRight size={12} /></span>
          </section>
          <section className="builder-preview-products">
            <div className="builder-preview-products-top"><h3>{design.layout === 'editorial' ? 'Selected for today' : 'Your catalog'}</h3><small>CATALOG PREVIEW</small></div>
            {productsLoading ? <div className="builder-preview-items" role="status" aria-label="Loading live products">{[0, 1, 2].map(item => <div className="builder-preview-item" key={item}><div className="skeleton" style={{ height: 48 }} /><div className="skeleton" style={{ height: 8, marginTop: 8, width: '70%' }} /></div>)}</div>
              : productsError ? <div className="builder-empty" role="alert">Live inventory could not be loaded. <button className="btn btn-outline" onClick={retryProducts} data-testid="button-retry-builder-products">Retry</button></div>
              : previewProducts.length ? <div className="builder-preview-items">
              {previewProducts.map(product => <article className="builder-preview-item" key={product.id}>
                <div className="builder-preview-item-art">{product.imageAssetId
                  ? <PrivateAssetImage assetId={product.imageAssetId} alt={`${product.name} photo`} className="builder-preview-item-photo" fit={product.imageFit} />
                  : <Package size={19} />}</div>
                <strong>{product.name}</strong><span>{product.sellingPrice === null ? 'Price not listed' : money(product.sellingPrice, product.currencyCode)}</span>
                <div className="builder-product-photo-actions">
                  <button type="button" className="builder-product-photo-entry" onClick={() => onUploadProduct(product.id)} disabled={photoBusy} data-testid={`button-upload-product-photo-${product.id}`}>{product.imageAssetId ? 'Replace photo' : 'Add product photo'}</button>
                  {product.imageAssetId !== null && <AssetFitButton assetId={product.imageAssetId} onChoose={file => onFitProduct(product.id, file)} disabled={photoBusy} testId={`button-fit-product-photo-${product.id}`} />}
                </div>
              </article>)}
            </div> : <div className="builder-empty" style={{ padding: '15px 8px' }}>Current catalog items appear here. Customer availability is calculated from the selected fulfillment location when the storefront is live.</div>}
          </section>
        </div>
      </div>
      <div className="builder-publish-bar">
        <div className="builder-publish-copy"><strong>{slug ? `stocksense.store/${slug}` : 'Choose your storefront address'}</strong><span>{slug ? 'Public shoppers see the last published version.' : 'A short, memorable address customers can revisit.'}</span></div>
        {hasPublishedDesign && publishedSlug && <Link href={`/store/${publishedSlug}`} className="btn btn-outline" target="_blank" rel="noreferrer" data-testid="link-preview-public-store">Preview published <ExternalLink size={14} /></Link>}
      </div>
    </div>
  );
}

export default function StoreBuilderPage() {
  const queryClient = useQueryClient();
  const builderQuery = useGetStorefrontBuilder({ query: { queryKey: getGetStorefrontBuilderQueryKey() } });
  const productsQuery = useListProducts(undefined, { query: { queryKey: getListProductsQueryKey() } });
  const [periodDays, setPeriodDays] = useState(30);
  const [customReportingWindow, setCustomReportingWindow] = useState(false);
  const [customReportingDays, setCustomReportingDays] = useState('30');
  const analyticsQuery = useGetStorefrontAnalytics({ periodDays }, { query: { queryKey: getGetStorefrontAnalyticsQueryKey({ periodDays }) } });
  const generateDesign = useGenerateStorefrontDesign();
  const generateHero = useGenerateStorefrontHero();
  const saveDraft = useSaveStorefrontDraft();
  const publishStore = usePublishStorefront();
  const requestUpload = useRequestStorefrontAssetUpload();
  const updateProduct = useUpdateProduct();
  const [design, setDesign] = useState<StorefrontDesign>(blankDesign);
  const [prompt, setPrompt] = useState('');
  const [heroPrompt, setHeroPrompt] = useState('');
  const [slug, setSlug] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [uploadedName, setUploadedName] = useState('');
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null>(null);
  const initialized = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<{ type: 'hero' } | { type: 'product'; productId: number }>({ type: 'hero' });

  useEffect(() => {
    if (!builderQuery.data || initialized.current) return;
    initialized.current = true;
    const initialDesign = builderQuery.data.draftDesign ?? builderQuery.data.publishedDesign ?? blankDesign;
    setDesign({ ...initialDesign, heroImageFit: initialDesign.heroImageFit ?? DEFAULT_IMAGE_FIT });
    setSlug(builderQuery.data.slug ?? '');
    setLocationId(builderQuery.data.fulfillmentLocationId ?? '');
  }, [builderQuery.data]);

  useEffect(() => {
    const result = analyticsQuery.data;
    if (!result || result.maxPeriodDays === 0) return;
    if (result.periodDays !== periodDays) {
      setPeriodDays(result.periodDays);
      setCustomReportingWindow(!REPORTING_PRESETS.includes(result.periodDays as typeof REPORTING_PRESETS[number]));
      setCustomReportingDays(String(result.periodDays));
    }
  }, [analyticsQuery.data, periodDays]);

  const isValidSlug = slugPattern.test(slug);
  const analytics = analyticsQuery.data;
  const dailyValues = useMemo(() => analytics?.daily.map(item => item.orderCount) ?? [], [analytics?.daily]);
  const maxCurrencyValue = Math.max(1, ...(analytics?.ordersByCurrency ?? []).map(row => row.requestedValue));
  const maxReportingDays = analytics?.maxPeriodDays ?? 90;
  const availableReportingPresets = REPORTING_PRESETS.filter(days => days <= maxReportingDays);
  const reportingWindowValue = analytics?.maxPeriodDays === 0
    ? 'unavailable'
    : customReportingWindow || !availableReportingPresets.includes(periodDays as typeof REPORTING_PRESETS[number])
      ? 'custom'
      : String(periodDays);

  const updateDesign = <K extends keyof StorefrontDesign>(key: K, value: StorefrontDesign[K]) => {
    setDesign(current => ({ ...current, [key]: value }));
    setMessage('');
  };

  const handleGenerateDesign = () => {
    const text = prompt.trim();
    if (text.length < 8) {
      setErrorMessage('Add a little more detail—at least 8 characters—so the builder has a clear direction.');
      return;
    }
    setErrorMessage('');
    setMessage('');
    generateDesign.mutate({ data: { prompt: text } }, {
      onSuccess: result => {
        setDesign({ ...result, heroImageFit: result.heroImageFit ?? DEFAULT_IMAGE_FIT });
        setMessage('Draft generated. Review the details and save when they feel right.');
        setErrorMessage('');
      },
      onError: () => setErrorMessage('We could not generate a design just now. Your current draft is safe—try again.'),
    });
  };

  const handleGenerateHero = () => {
    const text = heroPrompt.trim();
    if (text.length < 8) {
      setErrorMessage('Describe the storefront image in at least 8 characters.');
      return;
    }
    setErrorMessage('');
    setMessage('');
    generateHero.mutate({ data: { prompt: text } }, {
      onSuccess: result => {
        updateDesign('heroImageAssetId', result.imageAssetId);
        updateDesign('heroImageFit', DEFAULT_IMAGE_FIT);
        setMessage('Hero image added to this draft. Save the draft to keep it.');
      },
      onError: () => setErrorMessage('The image could not be generated. Your design draft has not changed.'),
    });
  };

  const openProductPhoto = (productId: number) => {
    uploadTarget.current = { type: 'product', productId };
    fileInput.current?.click();
  };
  const openHeroPhoto = () => {
    uploadTarget.current = { type: 'hero' };
    fileInput.current?.click();
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = uploadTarget.current;
    event.target.value = '';
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setErrorMessage('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size < 1 || file.size > 12 * 1024 * 1024) {
      setErrorMessage('Images must be 12 MB or smaller.');
      return;
    }
    setErrorMessage('');
    setMessage('');
    setPhotoDraft({ file, mode: 'replace', target, initialFit: DEFAULT_IMAGE_FIT });
  };

  const applyPhotoFit = async (fit: ImageFit) => {
    const draft = photoDraft;
    setPhotoDraft(null);
    if (!draft) return;
    setErrorMessage('');
    setMessage('');
    if (draft.mode === 'adjust') {
      if (draft.target.type === 'hero') {
        updateDesign('heroImageFit', fit);
        setMessage('Hero framing updated in the preview. Save the draft to keep it.');
        return;
      }
      try {
        await updateProduct.mutateAsync({ id: draft.target.productId, data: { imageFit: fit } });
        void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setMessage('Product photo framing saved. Inventory and product details were not changed.');
      } catch {
        setErrorMessage('The product photo framing could not be saved. Try again.');
      }
      return;
    }

    try {
      const { file, target: uploadDestination } = draft;
      const signed = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' } });
      const uploadResponse = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploadResponse.ok) throw new Error('Upload failed');
      if (uploadDestination.type === 'hero') {
        updateDesign('heroImageAssetId', signed.imageAssetId);
        updateDesign('heroImageFit', fit);
        setUploadedName(file.name);
        setMessage(`${file.name} uploaded to this draft. Save the draft to keep the image.`);
      } else {
        await updateProduct.mutateAsync({ id: uploadDestination.productId, data: { imageAssetId: signed.imageAssetId, imageFit: fit } });
        void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setMessage(`${file.name} is attached to the product. Product inventory details were not changed.`);
      }
    } catch {
      setErrorMessage('The image upload did not complete. Please try again.');
    }
  };

  const handleSaveDraft = () => {
    setErrorMessage('');
    setMessage('');
    saveDraft.mutate({ data: { ...design, heroImageFit: design.heroImageFit ?? DEFAULT_IMAGE_FIT } }, {
      onSuccess: () => {
        setMessage('Draft saved. It is not public until you publish it.');
        void queryClient.invalidateQueries({ queryKey: getGetStorefrontBuilderQueryKey() });
      },
      onError: () => setErrorMessage('Draft could not be saved. Check the store name and text lengths, then try again.'),
    });
  };

  const handlePublish = () => {
    if (!isValidSlug) {
      setErrorMessage('Use a 3–40 character address with lowercase letters, numbers, and internal hyphens.');
      return;
    }
    if (!locationId) {
      setErrorMessage('Choose a fulfillment location before publishing.');
      return;
    }
    if (!design.storeName.trim()) {
      setErrorMessage('Add a store name before publishing.');
      return;
    }
    setPublishConfirm(false);
    setErrorMessage('');
    setMessage('');
    saveDraft.mutate({ data: { ...design, heroImageFit: design.heroImageFit ?? DEFAULT_IMAGE_FIT } }, {
      onSuccess: () => publishStore.mutate({ data: { slug, fulfillmentLocationId: Number(locationId) } }, {
        onSuccess: () => {
          setMessage('Your storefront is published. Customers can now view the published design and request available items.');
          void queryClient.invalidateQueries({ queryKey: getGetStorefrontBuilderQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetStorefrontAnalyticsQueryKey({ periodDays }) });
        },
        onError: () => setErrorMessage('The draft was saved, but publishing did not complete. Try publishing again.'),
      }),
      onError: () => setErrorMessage('The draft could not be saved, so nothing was published. Review it and try again.'),
    });
  };

  if (builderQuery.isLoading) {
    return <Shell title="Store builder"><main className="page builder-page" role="status" aria-label="Loading store builder"><div className="skeleton" style={{ height: 90, width: '45%', marginBottom: 22 }} /><div className="builder-grid"><div className="builder-card" style={{ height: 580 }} /><div className="builder-card" style={{ height: 580 }} /></div></main></Shell>;
  }
  if (builderQuery.isError || !builderQuery.data) {
    return <Shell title="Store builder"><main className="page builder-page"><PageHeading eyebrow="STOCKSENSE / STOREFRONT" title="Store builder" description="Design a storefront that stays connected to live inventory." /><div className="panel empty" role="alert"><div className="empty-icon"><RefreshCw size={21} /></div><h2 className="display" style={{ fontSize: 22 }}>Could not load store builder</h2><p>Your draft and inventory have not been changed.</p><button className="btn btn-primary" onClick={() => void builderQuery.refetch()} data-testid="button-retry-store-builder">Try again</button></div></main></Shell>;
  }

  const locations = builderQuery.data.locations;
  const isBusy = generateDesign.isPending || generateHero.isPending || requestUpload.isPending || updateProduct.isPending || saveDraft.isPending || publishStore.isPending;
  const publishBusy = saveDraft.isPending || publishStore.isPending;
  const analyticsError = analyticsQuery.isError;

  return (
    <Shell title="Store builder">
      <main className="page builder-page">
        <header className="builder-intro">
          <div className="builder-intro-copy">
            <div className="eyebrow">STOCKSENSE / STORE WORKSHOP</div>
            <h1>Make your stock<br />easy to find.</h1>
            <p>Shape a storefront around the products you actually have. Save privately, check the preview, then publish when you’re ready.</p>
          </div>
          <div className="builder-online"><i /> Connected to live inventory</div>
        </header>

        <div className="builder-grid">
          <div className="builder-controls">
            <section className="builder-card" aria-labelledby="builder-generate-title">
              <div className="builder-card-head"><span className="builder-step">01</span><div><h2 id="builder-generate-title">Start with a direction</h2><p>Tell the AI what your shop feels like. It returns a validated design draft—not a published page.</p></div></div>
              <div className="builder-card-content">
                <label className="builder-field"><span className="builder-field-label">Describe the store you want</span><textarea className="field builder-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A neighborhood pantry for thoughtfully sourced staples. Warm, direct, and focused on what’s fresh today." maxLength={2000} data-testid="input-store-design-prompt" /></label>
                <div className="builder-form-actions"><button className="btn btn-primary" onClick={handleGenerateDesign} disabled={generateDesign.isPending || prompt.trim().length < 8} data-testid="button-generate-store-design">{generateDesign.isPending ? <><LoaderCircle size={15} className="spin" /> Building draft…</> : <><Sparkles size={15} /> Generate a draft</>}</button><span className="subtle" style={{ fontSize: 10 }}>{prompt.length}/2000</span></div>
                {generateDesign.isPending && <div className="builder-note" role="status">Reading your direction and shaping the store’s tone and layout…</div>}
              </div>
            </section>

            <section className="builder-card" aria-labelledby="builder-edit-title">
              <div className="builder-card-head"><span className="builder-step">02</span><div><h2 id="builder-edit-title">Tune the design</h2><p>Every field remains yours to edit. Changes stay in this preview until saved.</p></div></div>
              <div className="builder-card-content">
                <div className="builder-fields">
                  <label className="builder-field"><span className="builder-field-label">Store name</span><input className="field" value={design.storeName} maxLength={80} onChange={event => updateDesign('storeName', event.target.value)} placeholder="Name your store" data-testid="input-store-name" /></label>
                  <label className="builder-field"><span className="builder-field-label">Tagline</span><input className="field" value={design.tagline} maxLength={120} onChange={event => updateDesign('tagline', event.target.value)} placeholder="A short line customers will remember" data-testid="input-store-tagline" /></label>
                  <label className="builder-field"><span className="builder-field-label">About this store</span><textarea className="field" value={design.description} maxLength={500} onChange={event => updateDesign('description', event.target.value)} placeholder="Introduce your selection and how customers can request a delivery." data-testid="input-store-description" /></label>
                  <div className="builder-pair">
                    <div><span className="builder-field-label">Color world</span><div className="builder-choice-row" role="group" aria-label="Store theme">
                      {(['evergreen', 'ocean', 'sunrise'] as const).map(theme => <button key={theme} className={`builder-choice builder-theme-choice ${design.theme === theme ? 'selected' : ''}`} onClick={() => updateDesign('theme', theme)} aria-pressed={design.theme === theme} data-testid={`button-theme-${theme}`}><i className={`builder-swatch ${theme}`} />{theme}</button>)}
                    </div></div>
                    <div><span className="builder-field-label">Page rhythm</span><div className="builder-choice-row" role="group" aria-label="Store layout">
                      {(['showcase', 'catalog', 'editorial'] as const).map(layout => <button key={layout} className={`builder-choice ${design.layout === layout ? 'selected' : ''}`} onClick={() => updateDesign('layout', layout)} aria-pressed={design.layout === layout} data-testid={`button-layout-${layout}`}>{layout}</button>)}
                    </div></div>
                  </div>
                  <div>
                    <span className="builder-field-label">Hero image</span>
                    <div className="builder-upload">
                      <span className="builder-upload-mark"><ImagePlus size={17} /></span>
                      <span className="builder-upload-copy"><strong>{uploadedName || (design.heroImageAssetId ? 'Hero image attached' : 'Give the first view a focal point')}</strong><span>PNG, JPEG, WebP · up to 12 MB</span></span>
                      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} aria-label="Upload storefront hero image" data-testid="input-store-hero-upload" />
                      <button className="btn btn-outline" onClick={openHeroPhoto} disabled={requestUpload.isPending || updateProduct.isPending} data-testid="button-upload-store-hero">{requestUpload.isPending ? 'Uploading…' : 'Upload'}</button>
                      {design.heroImageAssetId !== null && <AssetFitButton
                        assetId={design.heroImageAssetId}
                        onChoose={file => setPhotoDraft({ file, mode: 'adjust', target: { type: 'hero' }, initialFit: design.heroImageFit ?? DEFAULT_IMAGE_FIT })}
                        disabled={requestUpload.isPending || updateProduct.isPending}
                        testId="button-fit-store-hero"
                      />}
                    </div>
                    <div className="builder-pair" style={{ marginTop: 10 }}>
                      <input className="field" value={heroPrompt} maxLength={1000} onChange={event => setHeroPrompt(event.target.value)} placeholder="Or describe a hero image to generate" aria-label="Describe generated hero image" data-testid="input-store-hero-prompt" />
                      <button className="btn btn-soft" onClick={handleGenerateHero} disabled={generateHero.isPending || heroPrompt.trim().length < 8} data-testid="button-generate-store-hero">{generateHero.isPending ? <><LoaderCircle size={14} className="spin" /> Creating…</> : <><WandSparkles size={14} /> Generate image</>}</button>
                    </div>
                  </div>
                  <div className="builder-form-actions" style={{ borderTop: '1px solid #e4ebe1', paddingTop: 15 }}>
                    <button className="btn btn-primary" onClick={handleSaveDraft} disabled={isBusy || !design.storeName.trim()} data-testid="button-save-store-draft">{saveDraft.isPending ? 'Saving draft…' : <><Check size={15} /> Save draft</>}</button>
                    <Link href="/products" className="btn btn-outline" data-testid="link-manage-store-products"><Package size={14} /> Add product details</Link>
                  </div>
                  <p className="builder-note">Product photos and opening-stock confirmation live in Products. This builder does not change product records or availability.</p>
                </div>
              </div>
            </section>

            <section className="builder-card" aria-labelledby="builder-publish-title">
              <div className="builder-card-head"><span className="builder-step">03</span><div><h2 id="builder-publish-title">Set the address and publish</h2><p>Publishing is a separate, explicit step. Requests are reviewed by you—no online payment is taken.</p></div></div>
              <div className="builder-card-content">
                <div className="builder-fields">
                  <label className="builder-field"><span className="builder-field-label">Store address</span><div style={{ display: 'flex', alignItems: 'center', gap: 0 }}><span style={{ padding: '11px 10px', border: '1px solid #cddbd2', borderRight: 0, borderRadius: '9px 0 0 9px', background: '#eef3ea', color: '#648076', font: '10px Space Mono,monospace' }}>store/</span><input className="field" style={{ borderRadius: '0 9px 9px 0' }} value={slug} maxLength={40} onChange={event => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="your-shop" data-testid="input-store-slug" /></div><small className="builder-note" style={{ display: 'block' }}>{slug.length === 0 ? '3–40 characters · lowercase letters, numbers, internal hyphens' : isValidSlug ? 'Address looks good.' : 'Use 3–40 characters, beginning and ending with a letter or number.'}</small></label>
                  <label className="builder-field"><span className="builder-field-label">Fulfillment location</span><select className="field" value={locationId} onChange={event => setLocationId(event.target.value ? Number(event.target.value) : '')} data-testid="select-store-location"><option value="">Choose an inventory location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name} · {location.warehouseName}</option>)}</select>{locations.length === 0 && <small className="builder-note">Create a location in Settings before publishing.</small>}</label>
                  {message && <div className="builder-note" role="status" data-testid="status-store-builder-message">{message}{builderQuery.data.slug && <span> <Link className="builder-published-link" href={`/store/${builderQuery.data.slug}`} target="_blank" rel="noreferrer">View published store</Link></span>}</div>}
                  {errorMessage && <div className="builder-inline-error" role="alert" data-testid="status-store-builder-error">{errorMessage}</div>}
                  <div className="builder-form-actions">
                    <button className="btn btn-primary" onClick={() => setPublishConfirm(true)} disabled={publishBusy || !design.storeName.trim() || !isValidSlug || !locationId} data-testid="button-open-publish-confirm">{publishBusy ? 'Publishing…' : <><ExternalLink size={14} /> Publish storefront</>}</button>
                    {builderQuery.data.publishedDesign && <span className="subtle" style={{ fontSize: 10 }}>A published design is live</span>}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <StorePreview
            design={design}
            slug={slug || null}
            publishedSlug={builderQuery.data.slug}
            hasPublishedDesign={Boolean(builderQuery.data.publishedDesign)}
            products={productsQuery.data}
            productsLoading={productsQuery.isLoading}
            productsError={productsQuery.isError}
            retryProducts={() => void productsQuery.refetch()}
            onUploadProduct={openProductPhoto}
            onFitProduct={(productId, file) => setPhotoDraft({
              file,
              mode: 'adjust',
              target: { type: 'product', productId },
              initialFit: productsQuery.data?.find(product => product.id === productId)?.imageFit ?? DEFAULT_IMAGE_FIT,
            })}
            photoBusy={requestUpload.isPending || updateProduct.isPending}
          />
        </div>

        {publishConfirm && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPublishConfirm(false); }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="publish-confirm-title">
            <div className="dialog-header"><div><div className="eyebrow">FINAL CHECK</div><h2 id="publish-confirm-title" className="display" style={{ fontSize: 24, margin: '5px 0 0' }}>Publish this storefront?</h2></div><button className="btn btn-outline icon-btn" onClick={() => setPublishConfirm(false)} aria-label="Close publish confirmation" data-testid="button-close-publish-confirm"><X size={16} /></button></div>
            <div className="dialog-body"><p style={{ fontSize: 13, lineHeight: 1.65, color: '#607b71', margin: 0 }}>This will make the saved design available at <strong>/store/{slug}</strong>, using inventory from <strong>{locations.find(location => location.id === locationId)?.name}</strong>. Customers can submit delivery requests for seller review; publishing does not take payment.</p></div>
            <div className="dialog-footer"><button className="btn btn-outline" onClick={() => setPublishConfirm(false)} data-testid="button-cancel-publish">Keep editing</button><button className="btn btn-primary" onClick={handlePublish} disabled={publishBusy} data-testid="button-confirm-publish">{publishBusy ? 'Publishing…' : 'Publish now'}</button></div>
          </div>
        </div>}

        <section className="builder-analytics" aria-labelledby="store-analytics-title">
          <div className="builder-section-heading">
            <div><div className="eyebrow">SELLER OPERATIONS / NO PAYMENT PROCESSING</div><h2 id="store-analytics-title">Storefront request activity</h2><p>Customer requests and their requested value, based on your operation records.</p></div>
            <label className="builder-field builder-period">
              <span className="builder-field-label">Reporting window</span>
              <div className={`builder-reporting-controls ${analytics?.maxPeriodDays === 0 ? 'builder-reporting-controls-unavailable' : ''}`}>
                <select
                  className="field"
                  value={reportingWindowValue}
                  disabled={!analytics || analyticsQuery.isError || analytics.maxPeriodDays === 0}
                  onChange={event => {
                    if (event.target.value === 'custom') {
                      const initialDays = Math.max(1, Math.min(periodDays, maxReportingDays));
                      setCustomReportingWindow(true);
                      setCustomReportingDays(String(initialDays));
                      setPeriodDays(initialDays);
                    } else if (event.target.value !== 'unavailable') {
                      setCustomReportingWindow(false);
                      setPeriodDays(Number(event.target.value));
                    }
                  }}
                  data-testid="select-store-analytics-period"
                >
                  {analytics?.maxPeriodDays === 0
                    ? <option value="unavailable">Publish storefront to start reports</option>
                    : <>
                      {availableReportingPresets.map(days => <option key={days} value={days}>Last {days} days</option>)}
                      <option value="custom">Custom days…</option>
                    </>}
                </select>
                {reportingWindowValue === 'custom' && analytics && analytics.maxPeriodDays > 0 && <input
                  className="field"
                  type="number"
                  min={1}
                  max={analytics.maxPeriodDays}
                  step={1}
                  value={customReportingDays}
                  aria-label="Custom reporting window in days"
                  onChange={event => {
                    const value = event.target.value;
                    setCustomReportingDays(value);
                    const parsedDays = Number(value);
                    if (!value || !Number.isSafeInteger(parsedDays) || parsedDays < 1) return;
                    const boundedDays = Math.min(parsedDays, analytics.maxPeriodDays);
                    setCustomReportingDays(String(boundedDays));
                    setPeriodDays(boundedDays);
                  }}
                  data-testid="input-store-analytics-custom-days"
                />}
              </div>
              {analytics && analytics.maxPeriodDays > 0
                ? <small className="builder-note">Custom reports can cover up to {analytics.maxPeriodDays} days since the storefront was created.</small>
                : <small className="builder-note">Reporting starts when you publish a storefront.</small>}
            </label>
          </div>
          {analyticsQuery.isLoading ? <div className="builder-metric-grid" role="status" aria-label="Loading storefront analytics">{[0, 1, 2, 3].map(value => <div key={value} className="builder-metric"><div className="skeleton" style={{ height: 12, width: '65%' }} /><div className="skeleton" style={{ height: 29, width: '40%', marginTop: 12 }} /></div>)}</div>
            : analyticsError || !analytics ? <div className="builder-card empty" role="alert"><h3 className="display" style={{ fontSize: 19 }}>Request analytics are unavailable</h3><p>Store design is unaffected. Retry to refresh the reporting window.</p><button className="btn btn-outline" onClick={() => void analyticsQuery.refetch()} data-testid="button-retry-store-analytics">Retry analytics</button></div>
              : <>
                <div className="builder-metric-grid">
                  <article className="builder-metric" data-testid="metric-store-order-requests"><small>Order requests</small><strong>{analytics.orderCount.toLocaleString()}</strong><em>{analytics.maxPeriodDays > 0 ? `Submitted in the last ${analytics.periodDays} days` : 'Publish your storefront to start reporting'}</em></article>
                  <article className="builder-metric" data-testid="metric-store-pending-review"><small>Pending seller review</small><strong>{analytics.pendingReviewCount.toLocaleString()}</strong><em>Requests awaiting your decision</em></article>
                  <article className="builder-metric" data-testid="metric-store-completed-operations"><small>Completed operations</small><strong>{analytics.completedOperationCount.toLocaleString()}</strong><em>Delivery operations marked complete</em></article>
                  <article className="builder-metric" data-testid="metric-store-canceled-unpriced"><small>Canceled / unpriced</small><strong>{analytics.canceledOrderCount.toLocaleString()} <span style={{ color: '#a9b7a8', fontWeight: 400 }}>/</span> {analytics.unpricedOrderCount.toLocaleString()}</strong><em>Canceled requests / requests without prices</em></article>
                </div>
                <div className="builder-analytics-grid">
                  <article className="builder-analytics-card">
                    <h3>Requested value by currency</h3><p>Separate totals are shown by currency; these are not paid revenue.</p>
                    {analytics.daily.length ? <Sparkline values={dailyValues} /> : <div className="builder-empty">No request activity recorded in this window.</div>}
                    {analytics.ordersByCurrency.length ? <div className="builder-currency-list">{analytics.ordersByCurrency.map(row => <div className="builder-currency-row" key={row.currencyCode} data-testid={`row-store-currency-${row.currencyCode}`}><strong>{row.currencyCode}</strong><span>{row.orderCount} {row.orderCount === 1 ? 'request' : 'requests'}</span><b>{money(row.requestedValue, row.currencyCode)}</b><i><span style={{ width: `${Math.max(2, row.requestedValue / maxCurrencyValue * 100)}%` }} /></i></div>)}</div> : <div className="builder-empty">No priced order requests in this window.</div>}
                    <div className="builder-disclaimer">Requested value is an estimate from order requests, not a record of payments or collected revenue. Customers arrange payment with the seller outside this storefront.</div>
                  </article>
                  <article className="builder-analytics-card">
                    <h3>Most requested products</h3><p>Ranked by request count; values are shown only where available.</p>
                    {analytics.topProducts.length ? <div className="builder-top-products">{analytics.topProducts.map((product, index) => <div className="builder-top-product" key={product.productId} data-testid={`row-top-store-product-${product.productId}`}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span><strong>{product.productName}</strong><small>{product.orderCount} requests · {product.quantity} requested</small></span><b>{money(product.requestedValue, product.currencyCode)}</b></div>)}</div> : <div className="builder-empty">Products will appear here when customers request them.</div>}
                    {analytics.daily.length > 0 && <div style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid #e4ebe1', display: 'flex', justifyContent: 'space-between', color: '#84978b', fontSize: 9 }}><span>DAILY REQUESTS</span><span>{analytics.daily.length} days tracked</span></div>}
                  </article>
                </div>
              </>}
        </section>
        <div className="builder-note" style={{ marginTop: 18 }}>Stock and product details are always sourced from your inventory. Complete product setup and confirm opening stock from <Link href="/products" style={{ color: '#285950', textDecoration: 'underline' }}>Products</Link>.</div>
      </main>
      <PhotoFitEditor
        file={photoDraft?.file ?? null}
        open={Boolean(photoDraft)}
        subject={photoDraft?.target.type === 'hero' ? 'hero' : 'product'}
        initialFit={photoDraft?.initialFit ?? DEFAULT_IMAGE_FIT}
        onCancel={() => setPhotoDraft(null)}
        onApply={applyPhotoFit}
      />
    </Shell>
  );
}
