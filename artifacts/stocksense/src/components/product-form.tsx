import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useGetOwnerStorefrontAsset, useListCategories, useRequestStorefrontAssetUpload, type Product, type ProductInput, type ProductUpdate } from '@workspace/api-client-react';
import { Field, Modal } from './common';
import { ProductLocationPicker } from './product-location-picker';
import { ScanBarcode } from 'lucide-react';
import { BarcodeScanner } from './barcode-scanner';
import { AssetFitButton, DEFAULT_IMAGE_FIT, FittedImage, PhotoFitEditor, type ImageFit } from './photo-fit-editor';

const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
const currencyCodes = Intl.supportedValuesOf('currency');
const featured = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'AED', 'CAD', 'AUD'];
const currencies = [
  ...featured.filter(code => currencyCodes.includes(code)),
  ...currencyCodes.filter(code => !featured.includes(code)).sort((a, b) =>
    (currencyNames.of(a) || a).localeCompare(currencyNames.of(b) || b)),
];
const unitOptions = ['units', 'pieces', 'boxes', 'kg', 'litres', 'pairs'];
const allowedImageTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
const quantityText = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);

function PrivateProductPhoto({ assetId, alt, fit }: { assetId: number; alt: string; fit: ImageFit }) {
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
  if (source) return <FittedImage className="product-photo-preview" src={source} alt={alt} fit={fit} loading="eager" />;
  return <div className="product-photo-placeholder" role="img" aria-label={alt}>
    {image.isLoading ? 'Loading photo…' : image.isError ? 'Photo unavailable' : 'Preparing photo…'}
  </div>;
}

export function ProductForm({ product, onClose, onSave, onEditStock, busy, error }: { product?: Product; onClose: () => void; onSave: (data: ProductInput | ProductUpdate) => void; onEditStock?: () => void; busy: boolean; error?: string }) {
  const categories = useListCategories();
  const assetUpload = useRequestStorefrontAssetUpload();
  const [name, setName] = useState(product?.name || '');
  const [sku, setSku] = useState(product?.sku || '');
  const [imageAssetId, setImageAssetId] = useState<number | null>(product?.imageAssetId ?? null);
  const [imageFit, setImageFit] = useState<ImageFit>(product?.imageFit ?? DEFAULT_IMAGE_FIT);
  const [photoDraft, setPhotoDraft] = useState<{ file: File; mode: 'replace' | 'adjust' } | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState('');
  const skuInput = useRef<HTMLInputElement>(null);
  const scanButton = useRef<HTMLButtonElement>(null);
  const scanned = useRef(false);
  const [categoryId, setCategoryId] = useState(product?.categoryId?.toString() || '');
  const [unitChoice, setUnitChoice] = useState(product?.unit && !unitOptions.includes(product.unit) ? 'other' : product?.unit || 'units');
  const [customUnit, setCustomUnit] = useState(product?.unit && !unitOptions.includes(product.unit) ? product.unit : '');
  const [alertEnabled, setAlertEnabled] = useState((product?.reorderPoint ?? 0) > 0);
  const [reorderPoint, setReorderPoint] = useState(product?.reorderPoint ? String(product.reorderPoint) : '');
  const [currencyCode, setCurrencyCode] = useState(product?.currencyCode || 'USD');
  const [sellingPrice, setSellingPrice] = useState(product?.sellingPrice == null ? '' : String(product.sellingPrice));
  const [initialStock, setInitialStock] = useState('');
  const [defaultLocationId, setDefaultLocationId] = useState<number | null>(product?.defaultLocationId ?? null);
  const [validation, setValidation] = useState('');
  const [locationPending, setLocationPending] = useState(false);
  const locationPendingRef = useRef(false);
  const unit = unitChoice === 'other' ? customUnit.trim() : unitChoice;
  const enteredQuantity = initialStock.trim() === '' ? 0 : Number(initialStock);
  const displayedQuantity = Number.isFinite(enteredQuantity) && enteredQuantity >= 0 && enteredQuantity <= 100_000_000 ? quantityText(enteredQuantity) : '—';
  const alertQuantity = alertEnabled && reorderPoint.trim() !== '' ? Number(reorderPoint) : null;
  const displayedAlert = alertQuantity !== null && Number.isFinite(alertQuantity) && alertQuantity > 0 ? quantityText(alertQuantity) : null;
  const stockForPreview = product?.totalStock ?? enteredQuantity;
  const previewStatus = !Number.isFinite(stockForPreview) || stockForPreview < 0 || stockForPreview > 100_000_000
    ? null : stockForPreview <= 0 ? 'Out of stock'
      : alertEnabled && !displayedAlert ? null
        : displayedAlert && stockForPreview <= alertQuantity! ? 'Low stock' : 'Healthy';
  const onLocationPendingChange = (pending: boolean) => {
    locationPendingRef.current = pending;
    setLocationPending(pending);
  };

  const openNewPhoto = (file: File) => {
    if (!allowedImageTypes.includes(file.type as typeof allowedImageTypes[number])) {
      setImageError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size < 1 || file.size > 12 * 1024 * 1024) {
      setImageError('Choose an image smaller than 12 MB.');
      return;
    }
    setImageError('');
    setPhotoDraft({ file, mode: 'replace' });
  };

  const uploadImage = async (file: File, fit: ImageFit) => {
    setImageUploading(true);
    try {
      const { uploadURL, imageAssetId: uploadedId } = await assetUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type as typeof allowedImageTypes[number] },
      });
      const response = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) throw new Error('The image could not be uploaded. Try again.');
      setImageAssetId(uploadedId);
      setImageFit(fit);
    } catch (uploadError) {
      setImageError(uploadError instanceof Error ? uploadError.message : 'The image could not be uploaded. Try again.');
    } finally {
      setImageUploading(false);
    }
  };

  const applyPhotoFit = (fit: ImageFit) => {
    const draft = photoDraft;
    setPhotoDraft(null);
    if (!draft) return;
    if (draft.mode === 'adjust') {
      setImageFit(fit);
      setImageError('');
    } else {
      void uploadImage(draft.file, fit);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (imageUploading) {
      setValidation('Wait for the image upload to finish before saving the product.');
      return;
    }
    if (locationPendingRef.current) {
      setValidation('Wait for the location to finish saving before saving the product.');
      return;
    }
    const openingQuantity = enteredQuantity;
    if (!unit) {
      setValidation('Choose how you count this product, or enter a name for your custom unit.');
      return;
    }
    if (/^[\d.,\s]+$/.test(unit.trim())) {
      setValidation('The unit must be a word like pieces or boxes. Enter the number you own under Starting quantity.');
      return;
    }
    if (!Number.isFinite(openingQuantity) || openingQuantity < 0 ||
      openingQuantity > 100_000_000 || Math.round(openingQuantity * 1_000_000) / 1_000_000 !== openingQuantity) {
      setValidation('Opening stock must be from 0 to 100,000,000 with at most six decimal places.');
      return;
    }
    if (!product && openingQuantity > 0 && defaultLocationId === null) {
      setValidation('Choose where your starting stock is stored before creating the product.');
      return;
    }
    if (alertEnabled && (reorderPoint.trim() === '' || !Number.isFinite(Number(reorderPoint)) || Number(reorderPoint) <= 0)) {
      setValidation('Enter a low-stock alert quantity greater than zero, or choose No low-stock alert.');
      return;
    }
    const price = sellingPrice.trim() === '' ? null : Number(sellingPrice);
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
    const factor = 10 ** digits;
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000 || Math.round(price * factor) / factor !== price)) {
      setValidation(`Enter a ${currencyCode} price from 0 to 1,000,000 with no more than ${digits} decimal places.`);
      return;
    }
    setValidation('');
    const data = {
      name: name.trim(),
      sku: sku.trim(),
      categoryId: categoryId ? Number(categoryId) : null,
      imageAssetId,
      imageFit,
      defaultLocationId,
      unit: unit.trim() || 'units',
      reorderPoint: alertEnabled ? Number(reorderPoint) : 0,
      sellingPrice: price,
      currencyCode,
    };
    onSave(product ? data : { ...data, ...(openingQuantity > 0 ? { initialStock: openingQuantity, initialLocationId: defaultLocationId } : {}) });
  };

  return <Modal title={product ? 'Edit product' : 'New product'} onClose={onClose}>
    <form onSubmit={submit}>
      <section className="product-form-section" aria-labelledby="product-basics-heading">
        <h3 id="product-basics-heading">1. What is the product?</h3>
        <div className="grid-fields">
          <Field label="Product name *"><input className="field" required value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Pallet wrap" data-testid="input-product-name" /></Field>
          <div className="field-group">
            <label className="label" htmlFor="product-sku">SKU (your product code) *</label>
            <div className="product-sku-input">
              <input id="product-sku" ref={skuInput} className="field mono" required value={sku} onChange={event => { setSku(event.target.value); setScanNotice(''); }} placeholder="e.g. WRAP-001" data-testid="input-product-sku" />
              <button ref={scanButton} type="button" className="btn btn-outline" disabled={busy} aria-label="Scan a product barcode into SKU" data-testid="button-scan-sku" onClick={() => { scanned.current = false; setScanning(true); }}><ScanBarcode size={17} aria-hidden="true" /> Scan</button>
            </div>
            {scanNotice && <p className="product-sku-notice" role="status" data-testid="sku-scan-success">{scanNotice}</p>}
          </div>
          <Field label="Category"><select className="field" value={categoryId} onChange={event => setCategoryId(event.target.value)} data-testid="select-product-category"><option value="">Uncategorized</option>{categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="Count this product in"><select className="field" value={unitChoice} onChange={event => { setUnitChoice(event.target.value); setValidation(''); }} data-testid="select-product-unit">{unitOptions.map(option => <option key={option} value={option}>{option}</option>)}<option value="other">Other — type my own</option></select></Field>
          {unitChoice === 'other' && <Field label="Your unit name *"><input className="field" required value={customUnit} onChange={event => setCustomUnit(event.target.value)} placeholder="e.g. rolls" data-testid="input-product-unit" /></Field>}
        </div>
        <p className="product-form-help">A unit is a word (pieces, boxes, kg). It is not the number you have.</p>
      </section>

      <section className="product-form-section" aria-labelledby="product-image-heading">
        <h3 id="product-image-heading">Product photo (optional)</h3>
        <div className="product-photo-field">
          {imageAssetId !== null
            ? <PrivateProductPhoto assetId={imageAssetId} alt={`${name || 'Product'} photo`} fit={imageFit} />
            : <div className="product-photo-placeholder" aria-hidden="true">No photo</div>}
          <div className="product-photo-actions">
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={busy || imageUploading}
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                  if (file) openNewPhoto(file);
              }}
              data-testid="input-product-image"
            />
            <button type="button" className="btn btn-outline" disabled={busy || imageUploading} onClick={() => imageInput.current?.click()}>
              {imageUploading ? 'Uploading…' : imageAssetId !== null ? 'Replace photo' : 'Upload photo'}
            </button>
            {imageAssetId !== null && <AssetFitButton
              assetId={imageAssetId}
              onChoose={file => setPhotoDraft({ file, mode: 'adjust' })}
              disabled={busy || imageUploading}
              testId="button-adjust-product-photo"
            />}
            {imageAssetId !== null && <button type="button" className="btn btn-ghost" disabled={busy || imageUploading} onClick={() => { setImageAssetId(null); setImageFit(DEFAULT_IMAGE_FIT); setImageError(''); }}>
              Remove photo
            </button>}
          </div>
        </div>
        <p className="product-form-help">PNG, JPEG, or WebP up to 12 MB. Your photo is private until it is used by a published storefront.</p>
        {imageError && <p className="product-form-warning" role="alert" data-testid="status-product-image-error">{imageError}</p>}
      </section>

      <section className="product-form-section" aria-labelledby="product-stock-heading">
        <h3 id="product-stock-heading">2. How many do you actually have?</h3>
        {product ? <div className="product-form-count" data-testid="product-existing-stock"><strong>{quantityText(product.totalStock)} {unit}</strong><span>currently on hand across all locations. Product details do not change that count.</span>{onEditStock && <button type="button" className="btn btn-outline" onClick={onEditStock} data-testid="button-edit-stock-from-product-form">Edit actual stock</button>}</div> :
          <><Field label="Starting quantity (actual stock, not the warning level)"><input className="field" type="number" min="0" step="any" inputMode="decimal" value={initialStock} onChange={event => setInitialStock(event.target.value)} placeholder="0 if you have none yet" data-testid="input-initial-stock" /></Field><p className="product-form-help">For example, if you own 24 pieces, enter 24 here. Leave blank for zero.</p></>}
        <ProductLocationPicker forStartingStock={!product} value={defaultLocationId} onChange={id => { setDefaultLocationId(id); setValidation(''); }} onCreationPendingChange={onLocationPendingChange} />
        {!product && enteredQuantity > 0 && defaultLocationId === null && <p className="product-form-warning" role="status">Choose a location above to record this starting quantity.</p>}
        {product && <p className="product-form-help">Use Edit actual stock to correct a count at a specific location. To receive new stock, use Add stock on the product page; a receipt updates the count after validation.</p>}
      </section>

      <section className="product-form-section" aria-labelledby="product-alert-heading">
        <h3 id="product-alert-heading">3. When should we warn you?</h3>
        <Field label="Low-stock alert"><select className="field" value={alertEnabled ? 'on' : 'off'} onChange={event => { setAlertEnabled(event.target.value === 'on'); setValidation(''); }} data-testid="select-product-alert"><option value="off">No low-stock alert</option><option value="on">Warn me when stock gets low</option></select></Field>
        {alertEnabled && <div className="product-form-alert-input"><Field label="Warn when on-hand quantity is this number or lower"><input className="field" type="number" min="0" step="any" required value={reorderPoint} onChange={event => setReorderPoint(event.target.value)} placeholder="e.g. 55" data-testid="input-reorder-point" /></Field></div>}
        <p className="product-form-help">This is only a warning level, not stock you have or an automatic order. At zero on hand, the product shows Out of stock.</p>
        <div className="product-form-summary" role="status" data-testid="product-stock-explanation">
          <strong>{product ? `On hand now: ${quantityText(product.totalStock)} ${unit}` : `On hand after creation: ${displayedQuantity} ${unit}`}</strong>
          <span>{displayedAlert ? `Low-stock warning: when on hand is ${displayedAlert} ${unit} or less (but more than zero).` : 'No low-stock warning set.'}</span>
          <span>{previewStatus ? `Stock status ${product ? 'after saving' : 'at creation'}: ${previewStatus}.` : 'Enter a valid quantity and warning level to preview the stock status.'}</span>
          <small>On hand comes from recorded quantities at locations. The warning level is never added to it.</small>
        </div>
      </section>

      <section className="product-form-section" aria-labelledby="product-price-heading">
        <h3 id="product-price-heading">4. Selling price (optional)</h3>
        <div className="grid-fields">
          <Field label="Currency"><select className="field" value={currencyCode} onChange={event => { setCurrencyCode(event.target.value); setSellingPrice(''); setValidation(''); }} data-testid="select-product-currency">{currencies.map(code => <option value={code} key={code}>{code} — {currencyNames.of(code) || code}</option>)}</select></Field>
          <Field label={`Selling price per unit (${currencyCode})`}><input className="field" type="number" min="0" step="any" inputMode="decimal" value={sellingPrice} onChange={event => setSellingPrice(event.target.value)} placeholder="e.g. 24.99" data-testid="input-product-selling-price" /></Field>
        </div>
        <p className="product-form-help">Changing currency clears the price; it does not convert it.</p>
      </section>
      {(validation || error) && <p className="location-error" role="alert" data-testid="status-form-error">{validation || error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 25, flexWrap: 'wrap' }}><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || locationPending || imageUploading} type="submit" data-testid="button-save-product">{busy ? 'Saving…' : locationPending ? 'Saving location…' : imageUploading ? 'Uploading photo…' : product ? 'Save changes' : 'Create product'}</button></div>
    </form>
    {scanning && <BarcodeScanner
      onScan={code => { scanned.current = true; setSku(code); setScanNotice('Barcode scanned. Review the SKU before saving.'); setScanning(false); }}
      onClose={() => setScanning(false)}
      onRestoreFocus={() => { (scanned.current ? skuInput.current : scanButton.current)?.focus(); }}
    />}
    <PhotoFitEditor
      file={photoDraft?.file ?? null}
      open={Boolean(photoDraft)}
      subject="product"
      initialFit={photoDraft?.mode === 'adjust' ? imageFit : DEFAULT_IMAGE_FIT}
      onCancel={() => setPhotoDraft(null)}
      onApply={applyPhotoFit}
    />
  </Modal>;
}