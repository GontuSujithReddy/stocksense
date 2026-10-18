import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardQueryKey,
  getGetProductQueryKey,
  getListMovesQueryKey,
  getListOperationsQueryKey,
  getListProductsQueryKey,
  useCreateOperation,
  useListLocations,
  useValidateOperation,
  type Product,
} from '@workspace/api-client-react';
import { Field, Modal, QueryError } from './common';

const MAX_STOCK = 100_000_000;
const MAX_DECIMALS = 6;

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'The stock count could not be saved.';
}

export function ProductStockCountModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const locations = useListLocations();
  const createAdjustment = useCreateOperation();
  const validateAdjustment = useValidateOperation();
  const [locationId, setLocationId] = useState('');
  const [countedQuantity, setCountedQuantity] = useState('');
  const [error, setError] = useState('');
  const [createdOperationId, setCreatedOperationId] = useState<number | null>(null);
  const [locationInitialized, setLocationInitialized] = useState(false);

  const quantityAt = (id: number) =>
    product.locationStocks.find(stock => stock.locationId === id)?.quantity ?? 0;

  useEffect(() => {
    if (locationInitialized || !locations.data?.length) return;
    const preferredLocation = product.defaultLocationId &&
      locations.data.some(location => location.id === product.defaultLocationId)
      ? product.defaultLocationId
      : locations.data[0].id;
    setLocationId(String(preferredLocation));
    setCountedQuantity(String(quantityAt(preferredLocation)));
    setLocationInitialized(true);
  }, [locationInitialized, locations.data, product]);

  const selectedLocationId = Number(locationId);
  const selectedLocation = locations.data?.find(location => location.id === selectedLocationId);
  const currentLocationQuantity = selectedLocation ? quantityAt(selectedLocation.id) : 0;
  const parsedQuantity = countedQuantity.trim() === '' ? Number.NaN : Number(countedQuantity);
  const quantityIsValid = Number.isFinite(parsedQuantity) &&
    parsedQuantity >= 0 &&
    parsedQuantity <= MAX_STOCK &&
    Math.round(parsedQuantity * 10 ** MAX_DECIMALS) / 10 ** MAX_DECIMALS === parsedQuantity;
  const quantityIsUnchanged = quantityIsValid && parsedQuantity === currentLocationQuantity;
  const projectedTotal = quantityIsValid
    ? product.totalStock - currentLocationQuantity + parsedQuantity
    : null;
  const busy = createAdjustment.isPending || validateAdjustment.isPending;

  const refreshInventory = () => {
    void queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(product.id) });
    void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMovesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOperationsQueryKey() });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedLocation) {
      setError('Choose a location for this stock count.');
      return;
    }
    if (!quantityIsValid) {
      setError('Enter a count from 0 to 100,000,000 with at most six decimal places.');
      return;
    }
    if (quantityIsUnchanged) {
      setError('This count matches the current quantity at this location. Enter a different count to make an adjustment.');
      return;
    }

    setError('');
    try {
      const adjustment = await createAdjustment.mutateAsync({
        data: {
          type: 'adjustment',
          contact: 'Product stock count',
          sourceLocationId: selectedLocation.id,
          destinationLocationId: null,
          lines: [{ productId: product.id, countedQuantity: parsedQuantity }],
        },
      });
      setCreatedOperationId(adjustment.id);
      try {
        await validateAdjustment.mutateAsync({ id: adjustment.id });
        refreshInventory();
        onClose();
      } catch (validationError) {
        refreshInventory();
        setError(`The adjustment was saved but not applied: ${readableError(validationError)}`);
      }
    } catch (creationError) {
      setError(readableError(creationError));
    }
  };

  return <Modal title="Edit actual stock" onClose={onClose}>
    {locations.isError
      ? <QueryError retry={() => { void locations.refetch(); }} />
      : <form onSubmit={submit}>
        <p className="subtle" style={{ fontSize: 13, lineHeight: 1.65, margin: '0 0 18px' }}>
          Enter the physically counted quantity at one location. Stock at other locations stays unchanged, and the product total updates automatically. The count is recorded as a stock adjustment.
        </p>
        {locations.isLoading
          ? <p className="subtle">Loading locations…</p>
          : locations.data?.length
            ? <>
              <Field label="Location *">
                <select
                  className="field"
                  value={locationId}
                  disabled={busy || createdOperationId !== null}
                  onChange={event => {
                    const nextLocationId = Number(event.target.value);
                    setLocationId(event.target.value);
                    setCountedQuantity(String(quantityAt(nextLocationId)));
                    setError('');
                  }}
                  data-testid="select-product-stock-count-location"
                >
                  {locations.data.map(location => <option key={location.id} value={location.id}>
                    {location.warehouseName} / {location.name}
                  </option>)}
                </select>
              </Field>
              <div className="grid-fields" style={{ marginTop: 15 }}>
                <Field label={`Counted quantity (${product.unit}) *`}>
                  <input
                    className="field"
                    type="number"
                    min="0"
                    max={MAX_STOCK}
                    step="any"
                    inputMode="decimal"
                    required
                    value={countedQuantity}
                    disabled={busy || createdOperationId !== null}
                    onChange={event => { setCountedQuantity(event.target.value); setError(''); }}
                    data-testid="input-product-stock-count"
                  />
                </Field>
                <div className="product-form-summary" role="status" data-testid="product-stock-count-preview">
                  <strong>Current here: {new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(currentLocationQuantity)} {product.unit}</strong>
                  <span>
                    {projectedTotal === null
                      ? 'Enter a valid count to preview the product total.'
                      : `Product total after adjustment: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(projectedTotal)} ${product.unit}`}
                  </span>
                </div>
              </div>
              {quantityIsUnchanged && !createdOperationId && <p className="product-form-help">This matches the current count at this location; no adjustment is needed.</p>}
            </>
            : <p className="product-form-warning" role="status">Create a storage location in Settings before recording a stock count.</p>}
        {error && <p className="location-error" role="alert" data-testid="status-product-stock-count-error">{error}</p>}
        {createdOperationId !== null
          ? <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 24 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
            <Link
              href={`/operations/${createdOperationId}`}
              className="btn btn-primary"
              onClick={onClose}
              data-testid="link-review-stock-adjustment"
            >
              Review adjustment
            </Link>
          </div>
          : <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 24 }}>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !selectedLocation || locations.isLoading || locations.isError || quantityIsUnchanged}
              data-testid="button-save-product-stock-count"
            >
              {busy ? 'Applying count…' : 'Save stock count'}
            </button>
          </div>}
      </form>}
  </Modal>;
}
