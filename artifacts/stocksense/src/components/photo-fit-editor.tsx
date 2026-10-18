import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useGetOwnerStorefrontAsset, type ImageFit } from '@workspace/api-client-react';
import './photo-fit-editor.css';

export type { ImageFit } from '@workspace/api-client-react';

export const DEFAULT_IMAGE_FIT: ImageFit = { x: 0.5, y: 0.5, zoom: 1 };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type FrameSize = { width: number; height: number };

type FittedImageProps = {
  src: string;
  alt: string;
  fit?: ImageFit;
  className?: string;
  loading?: 'eager' | 'lazy';
  onNaturalSize?: (size: { width: number; height: number }) => void;
};

export function FittedImage({
  src,
  alt,
  fit = DEFAULT_IMAGE_FIT,
  className = '',
  loading = 'lazy',
  onNaturalSize,
}: FittedImageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameSize>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<FrameSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => setFrame({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setNatural({ width: 0, height: 0 });
  }, [src]);

  const validFit = {
    x: clamp(Number.isFinite(fit.x) ? fit.x : 0.5, 0, 1),
    y: clamp(Number.isFinite(fit.y) ? fit.y : 0.5, 0, 1),
    zoom: clamp(Number.isFinite(fit.zoom) ? fit.zoom : 1, 1, 3),
  };
  const coverScale = natural.width > 0 && frame.width > 0 && frame.height > 0
    ? Math.max(frame.width / natural.width, frame.height / natural.height) * validFit.zoom
    : 0;
  const imageWidth = natural.width * coverScale;
  const imageHeight = natural.height * coverScale;
  const left = -(imageWidth - frame.width) * validFit.x;
  const top = -(imageHeight - frame.height) * validFit.y;

  return <div ref={frameRef} className={`image-fit-view ${className}`}>
    {src && <img
      src={src}
      alt={alt}
      loading={loading}
      draggable={false}
      onLoad={event => {
        const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
        setNatural(size);
        onNaturalSize?.(size);
      }}
      style={{
        position: 'absolute',
        display: 'block',
        maxWidth: 'none',
        width: imageWidth,
        height: imageHeight,
        left,
        top,
        opacity: coverScale > 0 ? 1 : 0,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />}
  </div>;
}

function fileFromBlob(blob: Blob, assetId: number) {
  const type = ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ? blob.type : 'image/jpeg';
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `storefront-image-${assetId}.${extension}`, { type });
}

export function AssetFitButton({
  assetId,
  onChoose,
  disabled = false,
  children = 'Adjust framing',
  testId,
}: {
  assetId: number;
  onChoose: (file: File) => void;
  disabled?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  const asset = useGetOwnerStorefrontAsset(assetId);
  return <button
    type="button"
    className="btn btn-ghost photo-fit-adjust-button"
    disabled={disabled || !asset.data}
    onClick={() => { if (asset.data) onChoose(fileFromBlob(asset.data, assetId)); }}
    data-testid={testId}
  >
    {asset.isLoading ? 'Loading photo…' : asset.isError ? 'Photo unavailable' : children}
  </button>;
}

type PhotoFitEditorProps = {
  file: File | null;
  open: boolean;
  subject: 'product' | 'hero';
  initialFit: ImageFit;
  onCancel: () => void;
  onApply: (fit: ImageFit) => void;
};

export function PhotoFitEditor({ file, open, subject, initialFit, onCancel, onApply }: PhotoFitEditorProps) {
  const [source, setSource] = useState('');
  const [fit, setFit] = useState<ImageFit>(initialFit);
  const [natural, setNatural] = useState<FrameSize>({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    overflowX: number;
    overflowY: number;
  } | null>(null);

  useEffect(() => {
    if (!file) {
      setSource('');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    setFit(initialFit);
    setNatural({ width: 0, height: 0 });
  }, [file, initialFit]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !natural.width || !natural.height) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = Math.max(bounds.width / natural.width, bounds.height / natural.height) * fit.zoom;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: fit.x,
      y: fit.y,
      overflowX: Math.max(0, natural.width * scale - bounds.width),
      overflowY: Math.max(0, natural.height * scale - bounds.height),
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setFit(current => ({
      ...current,
      x: drag.overflowX > 0 ? clamp(drag.x - (event.clientX - drag.startX) / drag.overflowX, 0, 1) : current.x,
      y: drag.overflowY > 0 ? clamp(drag.y - (event.clientY - drag.startY) / drag.overflowY, 0, 1) : current.y,
    }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const nudge = (x: number, y: number) => setFit(current => ({
    ...current,
    x: clamp(current.x - x * 0.035, 0, 1),
    y: clamp(current.y - y * 0.035, 0, 1),
  }));

  const subjectLabel = subject === 'hero' ? 'storefront hero photo' : 'product photo';
  const frameAspect = subject === 'hero' ? '10 / 3' : '5 / 2';
  const dimensions = natural.width && natural.height ? `${natural.width} × ${natural.height}` : 'Loading image…';
  const mainPreview = <div
    ref={frameRef}
    className="photo-fit-viewport"
    style={{ aspectRatio: frameAspect }}
    onPointerDown={beginDrag}
    onPointerMove={moveDrag}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    data-testid="photo-fit-canvas"
  >
    <FittedImage
      src={source}
      alt=""
      fit={fit}
      loading="eager"
      className="photo-fit-canvas-image"
      onNaturalSize={setNatural}
    />
    <span className="photo-fit-third photo-fit-third-x" aria-hidden="true" />
    <span className="photo-fit-third photo-fit-third-y" aria-hidden="true" />
    <span className="photo-fit-drag-hint">Drag to reposition</span>
  </div>;

  return <Dialog.Root open={open} onOpenChange={nextOpen => { if (!nextOpen) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="photo-fit-overlay" />
      <Dialog.Content className="photo-fit-dialog" aria-describedby="photo-fit-description" data-testid="dialog-photo-fit">
        <header className="photo-fit-header">
          <div>
            <Dialog.Title className="photo-fit-title">Fit {subjectLabel}</Dialog.Title>
            <Dialog.Description id="photo-fit-description" className="photo-fit-description">
              Drag the photo to reposition it. Your framing carries through to the store preview and published page.
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button type="button" className="btn btn-outline icon-btn" aria-label="Close photo fitter" data-testid="button-close-photo-fit"><X size={17} /></button>
          </Dialog.Close>
        </header>
        <div className="photo-fit-content">
          <div className={`photo-fit-preview-layout ${subject === 'hero' ? 'photo-fit-hero-layout' : 'photo-fit-product-layout'}`}>
            <div className="photo-fit-preview-group">
              <span className="photo-fit-preview-label">{subject === 'hero' ? 'Desktop storefront' : 'Desktop product card'}</span>
              {mainPreview}
            </div>
            <div className="photo-fit-preview-group photo-fit-phone-group">
              <span className="photo-fit-preview-label">Phone view</span>
              <div className="photo-fit-phone-viewport" style={{ aspectRatio: subject === 'hero' ? '4 / 3' : '5 / 2' }}>
                <FittedImage src={source} alt="" fit={fit} loading="eager" />
              </div>
            </div>
          </div>
          <div className="photo-fit-controls">
            <div className="photo-fit-zoom-row">
              <label htmlFor="photo-fit-zoom"><span>Zoom</span><output>{fit.zoom.toFixed(1)}×</output></label>
              <button type="button" className="photo-fit-zoom-button" aria-label="Zoom out" onClick={() => setFit(current => ({ ...current, zoom: clamp(current.zoom - 0.1, 1, 3) }))} disabled={fit.zoom <= 1}><ZoomOut size={16} /></button>
              <input
                id="photo-fit-zoom"
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={fit.zoom}
                onChange={event => setFit(current => ({ ...current, zoom: Number(event.target.value) }))}
                data-testid="input-photo-fit-zoom"
              />
              <button type="button" className="photo-fit-zoom-button" aria-label="Zoom in" onClick={() => setFit(current => ({ ...current, zoom: clamp(current.zoom + 0.1, 1, 3) }))} disabled={fit.zoom >= 3}><ZoomIn size={16} /></button>
            </div>
            <div className="photo-fit-position-row">
              <span>Fine-tune position</span>
              <div className="photo-fit-nudge" role="group" aria-label="Move photo in small steps">
                <button type="button" onClick={() => nudge(0, -1)} aria-label="Move photo up"><ArrowUp size={16} /></button>
                <button type="button" onClick={() => nudge(-1, 0)} aria-label="Move photo left"><ArrowLeft size={16} /></button>
                <button type="button" onClick={() => nudge(0, 1)} aria-label="Move photo down"><ArrowDown size={16} /></button>
                <button type="button" onClick={() => nudge(1, 0)} aria-label="Move photo right"><ArrowRight size={16} /></button>
              </div>
            </div>
          </div>
          <div className="photo-fit-meta"><span>{dimensions}</span><span>Preview frame · desktop and phone</span></div>
        </div>
        <footer className="photo-fit-footer">
          <button type="button" className="btn btn-outline" onClick={onCancel} data-testid="button-cancel-photo-fit">Cancel</button>
          <Dialog.Close asChild>
            <button type="button" className="btn btn-primary" onClick={() => onApply(fit)} data-testid="button-apply-photo-fit"><Check size={15} /> Use this framing</button>
          </Dialog.Close>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
