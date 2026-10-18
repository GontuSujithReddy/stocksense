import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Camera, ScanBarcode, X } from 'lucide-react';
import { startBarcodeScanner } from '../lib/barcode-scanner';
import './barcode-scanner.css';

type Props = { onScan: (code: string) => void; onClose: () => void; onRestoreFocus: () => void };

// Mount the camera effect inside the portal, after the video element exists.
function CameraScanner({ onScan }: Pick<Props, 'onScan'>) {
  const video = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onScan });
  handlers.current = { onScan };
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'starting' | 'reading' | 'error'>('starting');
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (!video.current) return;
    setStatus('starting');
    setError('');
    setHelp(false);
    const scanner = startBarcodeScanner(video.current, {
      onDetected: code => handlers.current.onScan(code),
      onReady: () => setStatus('reading'),
      onError: message => { setError(message); setStatus('error'); },
    });
    const helpTimer = setTimeout(() => setHelp(true), 12000);
    return () => { clearTimeout(helpTimer); scanner.stop(); };
  }, [attempt]);

  return <>
        <div className={`sku-scanner-preview ${status === 'error' ? 'has-error' : ''}`}>
          <video ref={video} muted playsInline autoPlay aria-label="Live barcode camera preview" data-testid="sku-scanner-video" />
          {status !== 'error' && <div className="sku-scanner-guide" aria-hidden="true"><span /></div>}
          {status !== 'reading' && <div className="sku-scanner-placeholder"><Camera size={32} aria-hidden="true" /><span>{status === 'starting' ? 'Starting camera…' : 'Camera unavailable'}</span></div>}
        </div>
        {status === 'error'
          ? <p className="sku-scanner-error" role="alert" data-testid="sku-scanner-error">{error}</p>
          : <p className="sku-scanner-status" role="status">{status === 'starting' ? 'Allow camera access when your browser asks.' : help ? 'No barcode found yet. Move closer, improve the lighting, and keep the full barcode inside the frame.' : 'Keep the barcode steady and fully visible inside the frame.'}</p>}
        <p className="sku-scanner-privacy">Camera frames stay on this device. EAN, UPC, Code 128, Code 39 and ITF labels are supported.</p>
        <div className="sku-scanner-actions">
          {status === 'error' && <button type="button" className="btn btn-primary" onClick={() => setAttempt(value => value + 1)} data-testid="button-retry-scanner">Retry camera</button>}
          <Dialog.Close className="btn btn-outline" data-testid="button-cancel-scanner">Cancel scan</Dialog.Close>
        </div>
  </>;
}

export function BarcodeScanner({ onScan, onClose, onRestoreFocus }: Props) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="sku-scanner-overlay" />
      <Dialog.Content className="sku-scanner-dialog" data-testid="sku-scanner-dialog"
        onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
        <div className="sku-scanner-heading">
          <span className="sku-scanner-icon"><ScanBarcode size={22} aria-hidden="true" /></span>
          <div><div className="eyebrow">PRODUCT / SKU</div><Dialog.Title>Scan a barcode</Dialog.Title></div>
          <Dialog.Close className="btn btn-outline icon-btn" aria-label="Close barcode scanner" data-testid="button-close-scanner"><X size={17} /></Dialog.Close>
        </div>
        <Dialog.Description className="sku-scanner-description">Point your camera at a product barcode. The scanned code fills SKU for you to review before saving.</Dialog.Description>
        <CameraScanner onScan={onScan} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}