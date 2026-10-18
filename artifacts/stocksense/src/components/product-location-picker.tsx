import { useCallback, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateLocation, useListLocations, useListWarehouses, getListLocationsQueryKey, type Location } from '@workspace/api-client-react';
import { ArrowUpRight, Crosshair, MapPin, Plus, Search, X } from 'lucide-react';
import { Field } from './common';
import { GooglePlacePicker, type ConfirmedGoogleSelection } from './google-place-picker';

type Coordinates = { latitude: number; longitude: number };

export function ProductLocationPicker({ value, onChange, onCreationPendingChange, forStartingStock = false }: { value: number | null; onChange: (id: number | null) => void; onCreationPendingChange: (pending: boolean) => void; forStartingStock?: boolean }) {
  const queryClient = useQueryClient();
  const locations = useListLocations();
  const warehouses = useListWarehouses();
  const create = useCreateLocation();
  const [newLocation, setNewLocation] = useState<Location | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [mapQuery, setMapQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [googleSelection, setGoogleSelection] = useState<ConfirmedGoogleSelection | null>(null);
  const creatingRef = useRef(false);
  const confirmedRef = useRef(false);
  const clearGoogleSelection = useCallback(() => {
    if (confirmedRef.current) {
      setAddress('');
      setCoordinates(null);
      setMapQuery('');
    }
    confirmedRef.current = false;
    setGoogleSelection(null);
  }, []);

  const options = locations.data ?? [];
  const selected = options.find(location => location.id === value) ?? (newLocation?.id === value ? newLocation : null);
  const searchAddress = () => {
    if (!address.trim()) { setError('Enter an address to search on the map.'); return; }
    setMapQuery(address.trim());
    setError('');
  };
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Your browser does not support location sharing. You can still type an address.'); return; }
    setError('');
    setLocating(true);
    clearGoogleSelection();
    navigator.geolocation.getCurrentPosition(
      position => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setCoordinates(next);
        setAddress('');
        setMapQuery(`${next.latitude},${next.longitude}`);
        setLocating(false);
      },
      geoError => {
        setLocating(false);
        setError(geoError.code === 1 ? 'Location permission was denied. You can type an address instead.' : 'Could not find your location. Try again or type an address.');
      },
      { enableHighAccuracy: false, timeout: 12000 }
    );
  };
  const saveLocation = () => {
    if (creatingRef.current) return;
    if (!warehouseId || !name.trim() || !code.trim()) {
      setError('Choose a warehouse and enter a location name and code.');
      return;
    }
    setError('');
    creatingRef.current = true;
    onCreationPendingChange(true);
    create.mutate({
      data: {
        warehouseId: Number(warehouseId),
        name: name.trim(),
        code: code.trim(),
        kind: 'internal',
        parentId: null,
        address: googleSelection?.result.address ?? (address.trim() || null),
        latitude: googleSelection?.result.latitude ?? coordinates?.latitude ?? null,
        longitude: googleSelection?.result.longitude ?? coordinates?.longitude ?? null,
        ...(!googleSelection ? {} : 'placeId' in googleSelection.source
          ? { googlePlaceId: googleSelection.source.placeId }
          : { googlePin: googleSelection.source.pin }),
      },
    }, {
      onSuccess: location => {
        setNewLocation(location);
        onChange(location.id);
        setExpanded(false);
        confirmedRef.current = false;
        setGoogleSelection(null);
        setAddress('');
        setCoordinates(null);
        setMapQuery('');
        setName('');
        setCode('');
        queryClient.invalidateQueries({ queryKey: getListLocationsQueryKey() });
      },
      onError: reason => setError(String(reason)),
      onSettled: () => {
        creatingRef.current = false;
        onCreationPendingChange(false);
      },
    });
  };

  return <section className="product-location" aria-labelledby="product-location-title">
    <div className="product-location-heading">
      <span className="product-location-icon"><MapPin size={18} /></span>
       <div><h3 id="product-location-title">{forStartingStock ? 'Where is starting stock stored?' : 'Default storage location'}</h3><p>{forStartingStock ? 'Starting stock is recorded here. Changing this place later does not move existing stock.' : 'Choose where this product normally belongs. Changing this does not move stock already on hand.'}</p></div>
    </div>
    <div className="location-choice">
       <Field label="Select a saved storage location">
        <select className="field" aria-label="Saved default storage location" value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)} data-testid="select-product-default-location">
          <option value="">No default location</option>
          {newLocation && !options.some(location => location.id === newLocation.id) && <option value={newLocation.id}>{newLocation.warehouseName} / {newLocation.name}</option>}
          {options.map(location => <option key={location.id} value={location.id}>{location.warehouseName} / {location.name}</option>)}
        </select>
      </Field>
      <button type="button" className="btn btn-outline" onClick={() => { setExpanded(!expanded); setError(''); }} aria-expanded={expanded} data-testid="button-add-product-location">
        {expanded ? <X size={15} /> : <Plus size={15} />}{expanded ? 'Close' : 'Add a location'}
      </button>
    </div>
    {locations.isLoading && <p className="location-note" role="status">Loading saved locations…</p>}
    {locations.isError && <p className="location-error" role="alert">Saved locations could not be loaded. <button type="button" className="btn btn-outline" onClick={() => locations.refetch()}>Retry</button></p>}
    {selected && !expanded && <div className="location-selected" data-testid="text-selected-product-location"><strong>{selected.warehouseName} / {selected.name}</strong>{selected.address ? ` · ${selected.address}` : ''}</div>}
    {expanded && <div className="location-create" onKeyDown={event => {
      if (event.target instanceof HTMLElement && event.target.closest('.google-place-picker')) return;
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        if (!create.isPending && warehouses.data?.length) saveLocation();
      }
    }}>
      <h4 className="location-create-title">Add your own storage place</h4>
      {warehouses.isLoading ? <p className="location-note" role="status">Loading warehouses…</p> : warehouses.isError ? <p className="location-error" role="alert">Warehouses could not be loaded. <button type="button" className="btn btn-outline" onClick={() => warehouses.refetch()}>Retry</button></p> : !warehouses.data?.length ? <p className="location-note">A location needs a warehouse first. <Link href="/settings?add=warehouse" style={{ color: '#205856', fontWeight: 700, textDecoration: 'underline' }} data-testid="link-create-warehouse">Create a warehouse in Settings</Link>, then come back here.</p> : <>
        <div className="grid-fields">
          <Field label="Warehouse *"><select className="field" value={warehouseId} onChange={event => setWarehouseId(event.target.value)} aria-label="Warehouse for new location" data-testid="select-new-location-warehouse"><option value="">Choose warehouse</option>{warehouses.data.map(warehouse => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select></Field>
          <Field label="Location name *"><input className="field" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. North storage room" aria-label="New location name" data-testid="input-new-location-name" /></Field>
          <Field label="Location code *"><input className="field mono" value={code} onChange={event => setCode(event.target.value)} placeholder="e.g. NORTH-01" aria-label="New location code" data-testid="input-new-location-code" /></Field>
        </div>
        <div className="location-address"><Field label="Street address (optional)"><input className="field" value={address} onChange={event => { clearGoogleSelection(); setAddress(event.target.value); setCoordinates(null); setMapQuery(''); }} placeholder="Street, city, and postal code" aria-label="New location street address" data-testid="input-new-location-address" /></Field></div>
        <p className="location-note">Type an address to save it as written, or choose and confirm a Google result below. Typed addresses are not Google-verified.</p>
        <GooglePlacePicker onEdit={clearGoogleSelection} onConfirm={selection => { confirmedRef.current = true; setGoogleSelection(selection); setAddress(selection.result.address); setCoordinates({ latitude: selection.result.latitude, longitude: selection.result.longitude }); setMapQuery(''); setError(''); }} />
        {googleSelection && <p className="location-selected" role="status">Google place confirmed for this form: {googleSelection.result.address}. Save & select location to store it.</p>}
        <div className="location-actions">
          <button type="button" className="btn btn-soft" onClick={searchAddress} data-testid="button-search-location-map"><Search size={15} />Search on map</button>
          <button type="button" className="btn btn-outline" onClick={useCurrentLocation} disabled={locating} data-testid="button-use-current-location"><Crosshair size={15} />{locating ? 'Finding location…' : 'Use my current location'}</button>
          {mapQuery && <a className="btn btn-outline" href={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer" data-testid="link-open-location-google-maps">Open in Google Maps <ArrowUpRight size={14} /></a>}
        </div>
        {coordinates && !googleSelection && <p className="location-note" data-testid="text-location-coordinates">Coordinates ready to save: {coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}. A street address is not filled in automatically.</p>}
        {mapQuery && <div className="location-map"><iframe title="Google Maps preview of the searched place" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`} /><div className="location-map-caption">Map preview only. Check that this is the place you meant.</div></div>}
        {error && <p className="location-error" role="alert" data-testid="status-location-error">{error}</p>}
        <div className="location-create-footer"><p className="location-note">Save this place first, then save the product. No stock is moved by adding a location.</p><button type="button" className="btn btn-primary" onClick={saveLocation} disabled={create.isPending} data-testid="button-save-new-location">{create.isPending ? 'Saving location…' : 'Save & select location'}</button></div>
      </>}
      {(!warehouses.data?.length || warehouses.isError) && error && <p className="location-error" role="alert">{error}</p>}
    </div>}
  </section>;
}