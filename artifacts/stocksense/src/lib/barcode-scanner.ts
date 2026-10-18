export type ScanCallbacks = {
  onDetected: (text: string) => void;
  onReady: () => void;
  onError: (message: string) => void;
};
type Controls = { stop: () => void };
type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorConstructor = {
  new(options: { formats: string[] }): Detector;
  getSupportedFormats: () => Promise<string[]>;
};
export type ScanEnvironment = {
  getStream: () => Promise<MediaStream>;
  getDetector: () => Promise<Detector | null>;
  startFallback: (stream: MediaStream, video: HTMLVideoElement, detected: (text: string) => void) => Promise<Controls>;
};

const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

async function getDetector(): Promise<Detector | null> {
  const Constructor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (!Constructor) return null;
  try {
    const supported = await Constructor.getSupportedFormats();
    // Do not silently lose common product formats on a partial native implementation.
    if (!formats.every(format => supported.includes(format))) return null;
    return new Constructor({ formats: formats.filter(format => supported.includes(format)) });
  } catch {
    return null;
  }
}

async function startFallback(stream: MediaStream, video: HTMLVideoElement, detected: (text: string) => void): Promise<Controls> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'), import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 500 });
  return reader.decodeFromStream(stream, video, result => {
    // No barcode / checksum errors are normal while aiming; only decoded results are used.
    if (result) detected(result.getText());
  });
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow camera access in your browser, then retry, or enter the SKU manually.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera was found. Connect a camera and retry, or enter the SKU manually.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera could not start. Close other apps using it and retry, or enter the SKU manually.';
  return 'The scanner could not start. Retry, or close it and enter the SKU manually.';
}

/**
 * Returns cleanup immediately, even while browser permission is pending.
 * Frames and decoded codes stay in the browser; this performs no network calls.
 */
export function startBarcodeScanner(
  video: HTMLVideoElement,
  callbacks: ScanCallbacks,
  environment?: ScanEnvironment,
): Controls {
  let stopped = false;
  let stream: MediaStream | null = null;
  let decoder: Controls | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    decoder?.stop();
    stream?.getTracks().forEach(track => track.stop());
    if (video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  };
  const detected = (text: string) => {
    if (stopped || !text.trim()) return;
    stop();
    // Keep leading zeros and the exact decoded text; never convert a SKU to a number.
    callbacks.onDetected(text);
  };
  const runtime: ScanEnvironment = environment ?? {
    getStream: () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera scanning is unavailable. Open StockSense in a secure browser tab, or enter the SKU manually.');
      }
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    },
    getDetector,
    startFallback,
  };
  const fallback = async () => {
    const controls = await runtime.startFallback(stream!, video, detected);
    if (stopped) controls.stop();
    else {
      decoder = controls;
      callbacks.onReady();
    }
  };
  void (async () => {
    try {
      stream = await runtime.getStream();
      if (stopped) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const detector = await runtime.getDetector();
      if (stopped) return;
      if (!detector) {
        await fallback();
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (stopped) return;
      callbacks.onReady();
      const poll = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            const results = await detector.detect(video);
            if (results[0]?.rawValue) detected(results[0].rawValue);
          }
        } catch {
          // A broken native implementation still gets the real local decoder.
          if (!stopped) {
            try { await fallback(); } catch (error) { fail(error); }
          }
          return;
        }
        if (!stopped) timer = setTimeout(() => void poll(), 180);
      };
      void poll();
    } catch (error) { fail(error); }
  })();
  function fail(error: unknown) {
    if (stopped) return;
    stop();
    const unavailable = error instanceof Error && error.message.startsWith('Camera scanning is unavailable.');
    callbacks.onError(unavailable ? error.message : cameraErrorMessage(error));
  }
  return { stop };
}