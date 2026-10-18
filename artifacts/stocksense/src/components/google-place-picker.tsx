import { useEffect, useRef, useState } from 'react';
import { getListGooglePlaceSuggestionsQueryKey, useGetGooglePlacesConfig, useListGooglePlaceSuggestions, useResolveGooglePlace, type GooglePlaceResult } from '@workspace/api-client-react';

type Pin = { latitude: number; longitude: number };
type MapApi = {
  Map: new (element: HTMLElement, options: object) => {
    panTo: (pin: { lat: number; lng: number }) => void;
    setZoom: (zoom: number) => void;
    addListener: (event: string, callback: (event: { latLng?: { lat: () => number; lng: () => number } }) => void) => void;
  };
  Marker: new (options: object) => { setPosition: (pin: { lat: number; lng: number }) => void; setMap: (map: object | null) => void };
};
declare global { interface Window { google?: { maps: MapApi }; gm_authFailure?: () => void } }

let mapsScript: Promise<MapApi> | null = null;
function loadGoogleMap(key: string): Promise<MapApi> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!mapsScript) mapsScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.onerror = () => { mapsScript = null; reject(new Error('Google map failed to load. Check the browser key and allowed website domains.')); };
    window.gm_authFailure = () => { mapsScript = null; reject(new Error('Google Maps authorization failed. Check the browser key, Maps JavaScript API, billing, and website restrictions.')); };
    script.onload = () => window.google?.maps ? resolve(window.google.maps) : reject(new Error('Google Maps is unavailable.'));
    document.head.appendChild(script);
  });
  return mapsScript;
}

export type ConfirmedGoogleSelection = { result: GooglePlaceResult; source: { placeId: string } | { pin: Pin } };

export function GooglePlacePicker({ onConfirm, onEdit }: { onConfirm: (selection: ConfirmedGoogleSelection) => void; onEdit: () => void }) {
  const config = useGetGooglePlacesConfig();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [candidate, setCandidate] = useState<{ placeId: string } | { pin: Pin } | null>(null);
  const [preview, setPreview] = useState<GooglePlaceResult | null>(null);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState('');
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<MapApi['Map']> | null>(null);
  const marker = useRef<InstanceType<MapApi['Marker']> | null>(null);
  const requestId = useRef(0);
  const resolve = useResolveGooglePlace();
  const suggestions = useListGooglePlaceSuggestions({ query: debounced }, { query: { queryKey: getListGooglePlaceSuggestionsQueryKey({ query: debounced }), enabled: config.data?.enabled === true && debounced.length >= 3, retry: false, staleTime: 60_000 } });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!config.data?.enabled || !config.data.browserKey || !mapElement.current) return;
    let active = true;
    loadGoogleMap(config.data.browserKey).then(api => {
      if (!active || !mapElement.current || map.current) return;
      const instance = new api.Map(mapElement.current, { center: { lat: 39.5, lng: -98.35 }, zoom: 4, mapTypeControl: false, streetViewControl: false });
      const pin = new api.Marker({ map: instance });
      map.current = instance;
      marker.current = pin;
      instance.addListener('click', event => {
        if (!event.latLng) return;
        const selected = { latitude: event.latLng.lat(), longitude: event.latLng.lng() };
        pin.setPosition({ lat: selected.latitude, lng: selected.longitude });
        requestId.current++;
        setCandidate({ pin: selected });
        setPreview(null);
        onEdit();
        setError('');
      });
    }).catch(reason => { if (active) setMapError(String(reason)); });
    return () => { active = false; marker.current?.setMap(null); marker.current = null; map.current = null; };
  }, [config.data?.enabled, config.data?.browserKey, onEdit]);

  const choosePlace = (placeId: string) => {
    const id = ++requestId.current;
    setCandidate({ placeId });
    setPreview(null);
    onEdit();
    setError('');
    resolve.mutate({ data: { placeId } }, {
      onSuccess: result => {
        if (id !== requestId.current) return;
        setPreview(result);
        const pin = { lat: result.latitude, lng: result.longitude };
        map.current?.panTo(pin);
        map.current?.setZoom(16);
        marker.current?.setPosition(pin);
      },
      onError: reason => { if (id === requestId.current) setError(String(reason)); },
    });
  };
  const previewPin = () => {
    if (!candidate || !('pin' in candidate)) return;
    const id = ++requestId.current;
    resolve.mutate({ data: candidate }, {
      onSuccess: result => { if (id === requestId.current) setPreview(result); },
      onError: reason => { if (id === requestId.current) setError(String(reason)); },
    });
  };

  if (config.isLoading) return <p className="location-note" role="status">Checking Google Maps availability…</p>;
  if (config.isError) return <p className="location-error" role="alert">Google Maps availability could not be checked. Manual address entry still works. <button type="button" className="btn btn-outline" onClick={() => config.refetch()}>Retry</button></p>;
  if (!config.data?.enabled) return <p className="location-note">Google place suggestions and pin selection are unavailable until the Maps browser and server keys are configured. You can still save a typed address or device coordinates.</p>;

  return <div className="google-place-picker">
    <h5>Choose a Google place or map pin</h5>
    <p className="location-note">Search after 3 characters (maximum 120). Up to 30 Google lookups per minute per account; Google Maps may also apply your project's billing quotas. Nothing is saved until you confirm below and save the location.</p>
    <input className="field" value={search} maxLength={120} onChange={event => { requestId.current++; setSearch(event.target.value); setCandidate(null); setPreview(null); onEdit(); }} placeholder="Search places on Google Maps" aria-label="Search Google places" />
    {suggestions.isFetching && <p className="location-note" role="status">Searching Google Places…</p>}
    {suggestions.isError && <p className="location-error" role="alert">{String(suggestions.error)}</p>}
    {debounced.length >= 3 && !suggestions.isFetching && !suggestions.isError && <div className="google-suggestions" role="listbox" aria-label="Google place suggestions">
      {suggestions.data?.length ? suggestions.data.map(item => <button role="option" aria-selected={candidate !== null && 'placeId' in candidate && candidate.placeId === item.placeId} type="button" key={item.placeId} onClick={() => choosePlace(item.placeId)}>{item.text}</button>) : <p className="location-note">No Google places found. You can still type an address manually.</p>}
    </div>}
    <div className="location-map"><div ref={mapElement} className="google-map-canvas" aria-label="Google map; click to choose a pin" /><div className="location-map-caption">Click the map to place an exact pin. Google finds a nearby address for that pin; check it before confirming.</div></div>
    {mapError && <p className="location-error" role="alert">{mapError}</p>}
    {'pin' in (candidate ?? {}) && !preview && <button type="button" className="btn btn-soft" disabled={resolve.isPending} onClick={previewPin}>Find address at pin</button>}
    {resolve.isPending && <p className="location-note" role="status">Checking with Google…</p>}
    {error && <p className="location-error" role="alert">{error}</p>}
    {preview && candidate && <div className="google-place-confirm"><p><strong>Google result:</strong> {preview.address}<br />Pin: {preview.latitude.toFixed(5)}, {preview.longitude.toFixed(5)}</p><button type="button" className="btn btn-soft" onClick={() => { onConfirm({ result: preview, source: candidate }); setError(''); }}>Confirm this place & pin</button></div>}
    <p className="location-note">Place information and maps © Google. A manually typed address is not verified by Google.</p>
  </div>;
}