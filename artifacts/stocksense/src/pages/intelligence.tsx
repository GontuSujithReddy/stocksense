import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboard,
  useListMoves,
  useListOperations,
  useListProducts,
  useListWarehouses,
} from "@workspace/api-client-react";
import type { IntelligenceLocationContext, InventoryAnswer, InventorySignal } from "../lib/inventory-intelligence";
import { deriveInventoryIntelligence, generateDailyInventoryBrief, generateInventoryReport } from "../lib/inventory-intelligence";
import { deterministicInventoryProvider } from "../lib/inventory-question-provider";
import { intelligenceDemoData } from "../lib/intelligence-demo-data";
import { SectionHeadingIcon, Shell, numberText } from "../components/common";
import {
  Activity, AlertCircle, ArrowRight, AudioLines, Barcode, Download, MapPin, Mic,
  Package, Printer, RefreshCw, Search, ShieldCheck, Sparkles, Warehouse, X,
} from "lucide-react";
import "./intelligence.css";

type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative>;
type SpeechRecognitionEvent = { results: ArrayLike<SpeechRecognitionResult> };
type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type BarcodeResult = { rawValue: string };
type BarcodeDetectorInstance = { detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]> };
type BrowserCapabilities = Window & {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorInstance;
};

const signalTitle: Record<InventorySignal["kind"], string> = {
  stockout: "Stock below threshold",
  overstock: "Overstock review",
  "unusual-movement": "Unusual movement",
};
const severityName: Record<InventorySignal["severity"], string> = { critical: "Critical", high: "High", watch: "Review" };
const percentText = (part: number | null) => part === null ? "—" : `${(part * 100).toFixed(0)}%`;

function downloadReport(report: string) {
  const file = new Blob([`StockSense inventory intelligence report\n${new Date().toLocaleString()}\n\n${report}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stocksense-inventory-brief-${new Date().toISOString().slice(0, 10)}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function IntelligencePage() {
  const dashboard = useGetDashboard();
  const productsQuery = useListProducts();
  const movesQuery = useListMoves();
  const warehousesQuery = useListWarehouses();
  const operationsQuery = useListOperations();
  const [demoMode, setDemoMode] = useState(false);
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<InventoryAnswer | null>(null);
  const [contextLocation, setContextLocation] = useState<IntelligenceLocationContext | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const locationName = params.get("location");
    return locationName
      ? { locationName, warehouseName: params.get("warehouse") ?? undefined }
      : null;
  });
  const [voiceStatus, setVoiceStatus] = useState("");
  const [cameraStatus, setCameraStatus] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const scannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const products = demoMode ? intelligenceDemoData.products : productsQuery.data ?? [];
  const moves = demoMode ? intelligenceDemoData.moves : movesQuery.data ?? [];
  const intelligence = useMemo(() => deriveInventoryIntelligence(products, moves), [products, moves]);
  const dailyBrief = useMemo(() => generateDailyInventoryBrief(products, intelligence), [products, intelligence]);
  const briefSummary = intelligence.signals.length
    ? `${new Set(intelligence.signals.map((signal) => signal.productId)).size} ${new Set(intelligence.signals.map((signal) => signal.productId)).size === 1 ? "product needs" : "products need"} review. Start with ${intelligence.signals[0].productName}: ${signalTitle[intelligence.signals[0].kind].toLowerCase()}.`
    : "No products currently meet a review rule. Continue recording stock movements for a clearer picture.";
  const params = new URLSearchParams(window.location.search);
  const productParam = Number(params.get("product"));
  const operationParam = Number(params.get("operation"));
  const contextOperation = !demoMode && !contextLocation && Number.isFinite(operationParam) && operationParam > 0
    ? operationsQuery.data?.find((operation) => operation.id === operationParam)
    : undefined;
  const contextProductId = Number.isFinite(productParam) && productParam > 0
    ? productParam
    : contextOperation?.lines[0]?.productId;
  const contextProduct = products.find((item) => item.id === contextProductId);
  const term = search.trim().toLowerCase();

  const productResults = useMemo(() => products.filter((item) =>
    !term || `${item.name} ${item.sku} ${item.locationStocks.map((stock) => `${stock.locationName} ${stock.warehouseName}`).join(" ")}`.toLowerCase().includes(term),
  ).slice(0, 5), [products, term]);
  const warehouseResults = useMemo(() => (demoMode ? [] : warehousesQuery.data ?? []).filter((item) =>
    !term || `${item.name} ${item.code} ${item.address ?? ""}`.toLowerCase().includes(term),
  ).slice(0, 4), [demoMode, warehousesQuery.data, term]);
  const locationResults = useMemo(() => {
    const matches = new Map<string, { location: string; warehouse: string; quantity: number }>();
    products.forEach((product) => product.locationStocks.forEach((stock) => {
      if (!term || `${stock.locationName} ${stock.warehouseName}`.toLowerCase().includes(term)) {
        const key = `${stock.warehouseName}::${stock.locationName}`;
        const existing = matches.get(key);
        matches.set(key, { location: stock.locationName, warehouse: stock.warehouseName, quantity: (existing?.quantity ?? 0) + stock.quantity });
      }
    }));
    return [...matches.values()].slice(0, 5);
  }, [products, term]);
  const operationResults = useMemo(() => (demoMode ? [] : operationsQuery.data ?? []).filter((operation) =>
    !term || `${operation.reference} ${operation.type} ${operation.contact ?? ""} ${operation.sourceLocationName ?? ""} ${operation.destinationLocationName ?? ""} ${operation.lines.map((line) => `${line.productName} ${line.sku}`).join(" ")}`.toLowerCase().includes(term),
  ).slice(0, 4), [demoMode, operationsQuery.data, term]);
  const locationTotals = useMemo(() => {
    const totals = new Map<string, { locationName: string; warehouseName: string; quantity: number }>();
    products.forEach((product) => product.locationStocks.forEach((stock) => {
      const key = `${stock.warehouseName}::${stock.locationName}`;
      const current = totals.get(key);
      totals.set(key, {
        locationName: stock.locationName,
        warehouseName: stock.warehouseName,
        quantity: (current?.quantity ?? 0) + stock.quantity,
      });
    }));
    return [...totals.values()].sort((a, b) => b.quantity - a.quantity);
  }, [products]);
  const maxLocationStock = Math.max(1, ...locationTotals.map((location) => location.quantity));
  const queryErrors = [
    !demoMode && productsQuery.isError ? { name: "Products", retry: () => { void productsQuery.refetch(); } } : null,
    !demoMode && movesQuery.isError ? { name: "Stock movements", retry: () => { void movesQuery.refetch(); } } : null,
    !demoMode && warehousesQuery.isError ? { name: "Warehouses", retry: () => { void warehousesQuery.refetch(); } } : null,
    !demoMode && operationsQuery.isError ? { name: "Operations", retry: () => { void operationsQuery.refetch(); } } : null,
    dashboard.isError ? { name: "Dashboard totals", retry: () => { void dashboard.refetch(); } } : null,
  ].filter((item): item is { name: string; retry: () => void } => item !== null);
  const essentialLoading = !demoMode && (productsQuery.isLoading || movesQuery.isLoading);
  const essentialError = !demoMode && (productsQuery.isError || movesQuery.isError);
  const productsReady = demoMode || !!productsQuery.data;
  const movesReady = demoMode || !!movesQuery.data;

  const askQuestion = async (
    text = question,
    productId?: number,
    locationOverride?: IntelligenceLocationContext,
  ) => {
    if (!productsReady || !movesReady) return;
    const clean = text.trim() || (contextProductId ? "What needs attention?" : "What needs attention?");
    setQuestion(clean);
    const operationContext = productId === undefined && !locationOverride ? contextOperation : undefined;
    const locationContext = locationOverride
      ?? (!operationContext && productId === undefined ? contextLocation ?? undefined : undefined);
    const result = await deterministicInventoryProvider.answer({
      question: clean,
      products,
      moves,
      intelligence,
      contextProductId: productId ?? (operationContext || locationContext ? undefined : contextProductId),
      contextOperation: operationContext,
      contextLocation: locationContext,
    });
    setAnswer(result);
  };
  const selectLocationContext = (location: IntelligenceLocationContext) => {
    const unchanged = contextLocation?.locationName === location.locationName
      && contextLocation?.warehouseName === location.warehouseName;
    if (unchanged) {
      void askQuestion(`What should I review at ${location.locationName}?`, undefined, location);
      return;
    }
    setContextLocation(location);
  };
  const stopCamera = () => {
    if (scannerTimer.current) clearTimeout(scannerTimer.current);
    scannerTimer.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recognitionRef.current?.stop();
    if (scannerTimer.current) clearTimeout(scannerTimer.current);
  }, []);

  useEffect(() => {
    if (!productsReady || !movesReady) return;
    const activeProduct = products.find((product) => product.id === contextProductId);
    if (!contextOperation && !contextLocation && !activeProduct) return;

    const clean = contextOperation
      ? `Explain operation ${contextOperation.reference}`
      : contextLocation
        ? `What should I review at ${contextLocation.locationName}?`
        : `What should I know about ${activeProduct?.name}?`;
    let cancelled = false;
    setQuestion(clean);
    void deterministicInventoryProvider.answer({
      question: clean,
      products,
      moves,
      intelligence,
      contextProductId: contextOperation || contextLocation ? undefined : contextProductId,
      contextOperation,
      contextLocation: contextOperation ? undefined : contextLocation ?? undefined,
    }).then((result) => {
      if (!cancelled) setAnswer(result);
    });
    return () => { cancelled = true; };
  }, [contextOperation, contextLocation, contextProductId, productsReady, movesReady, products, moves, intelligence]);

  const readBrief = () => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setVoiceStatus("Read aloud is unavailable in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(briefSummary);
    utterance.onend = () => setVoiceStatus("Brief finished.");
    window.speechSynthesis.speak(utterance);
    setVoiceStatus("Reading the daily brief.");
  };

  const startVoiceQuery = () => {
    const browser = window as BrowserCapabilities;
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("Voice recognition is unavailable here. Type a question instead.");
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = navigator.language || "en-US";
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript ?? "";
        setQuestion(transcript);
        setVoiceStatus(transcript ? `Heard: “${transcript}”` : "No words were detected. Type a question instead.");
        if (transcript) askQuestion(transcript);
      };
      recognition.onerror = () => setVoiceStatus("Voice recognition could not start. Type a question instead.");
      recognition.onend = () => { recognitionRef.current = null; };
      recognitionRef.current = recognition;
      setVoiceStatus("Listening. Speak your inventory question.");
      recognition.start();
    } catch {
      setVoiceStatus("Voice recognition could not start. Type a question instead.");
    }
  };

  const startCameraScan = async () => {
    const browser = window as BrowserCapabilities;
    if (!browser.BarcodeDetector) {
      setCameraError("Barcode scanning is not supported in this browser. Search the product SKU instead.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser. Search the product SKU instead.");
      return;
    }
    setCameraError("");
    setCameraStatus("Requesting camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      setCameraStatus("Point the camera at a product barcode.");
      window.setTimeout(() => {
        if (!videoRef.current || !streamRef.current || !browser.BarcodeDetector) return;
        videoRef.current.srcObject = streamRef.current;
        void videoRef.current.play().catch(() => setCameraError("Camera preview could not start. Check browser permissions and try again."));
        const detector = new browser.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
        const scan = async () => {
          if (!videoRef.current || !streamRef.current) return;
          if (videoRef.current.readyState < 2) {
            scannerTimer.current = setTimeout(() => void scan(), 450);
            return;
          }
          try {
            const results = await detector.detect(videoRef.current);
            const value = results[0]?.rawValue;
            if (value) {
              const scannerProducts = demoMode ? products : productsQuery.data ?? [];
              const matched = scannerProducts.find((product) => product.sku.toLowerCase() === value.toLowerCase());
              setSearch(value);
              setCameraStatus(matched
                ? `Matched ${matched.name} (${matched.sku})${demoMode ? " · demo only" : ""}.`
                : `No ${demoMode ? "demo" : "live"} product matches barcode “${value}”. Search by SKU instead.`);
              stopCamera();
              if (matched) void askQuestion(`What should I know about ${matched.name}?`, matched.id);
              return;
            }
          } catch {
            setCameraError("The barcode could not be read. Move closer, improve lighting, or search the product SKU.");
            stopCamera();
            return;
          }
          scannerTimer.current = setTimeout(() => void scan(), 450);
        };
        void scan();
      }, 100);
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      setCameraError(denied
        ? "Camera permission was denied. Allow access in browser settings or search the product SKU."
        : "Camera could not be opened. Check the device and browser permissions, then try again.");
      setCameraStatus("");
      stopCamera();
    }
  };

  const reportText = generateInventoryReport(products, intelligence);
  const reportWithSource = `${demoMode ? "DEMO DATA · synthetic browser-only examples; not live inventory.\n\n" : "LIVE WORKSPACE DATA.\n\n"}${reportText}`;
  const retryAll = () => queryErrors.forEach(({ retry }) => retry());

  return (
    <Shell title="Inventory intelligence">
      <main className="page intel-page" data-testid="page-inventory-intelligence">
        <div className="intel-topline">
          <div className="eyebrow intel-eyebrow">STOCKSENSE / INVENTORY INTELLIGENCE</div>
          <label className="intel-demo-toggle" data-testid="toggle-demo-data">
            <input type="checkbox" checked={demoMode} onChange={(event) => { setDemoMode(event.target.checked); setAnswer(null); }} />
            DEMO DATA
          </label>
        </div>
        <header className="intel-heading">
          <div className="section-heading-copy">
            <SectionHeadingIcon section="intelligence"/>
            <div>
              <h1 className="display">Know what needs a look.</h1>
              <p>One clear read on stock risk, movement exceptions, and the next useful action.</p>
            </div>
          </div>
          <div className="intel-head-actions">
            <button type="button" className="btn btn-outline" onClick={() => downloadReport(reportWithSource)} data-testid="button-download-intelligence-report"><Download size={15} /> Download report</button>
            <button type="button" className="btn btn-soft" onClick={() => window.print()} data-testid="button-print-intelligence-report"><Printer size={15} /> Print</button>
          </div>
        </header>

        {demoMode && <div className="intel-demo-banner" role="status" data-testid="status-demo-mode">
          <Sparkles size={17} aria-hidden="true" /><div><strong>DEMO DATA · synthetic examples only</strong><span>These sample products and movements exist only in this browser view. Nothing is saved; sample IDs never open live product records.</span></div>
        </div>}

        <section className="intel-hero" aria-label="Daily inventory brief and health estimate">
          <article className="intel-brief" data-testid="panel-daily-brief">
            <div className="intel-brief-top"><span className="intel-brief-label">Shift brief · {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
              <div className="intel-brief-actions">
                <button type="button" className="btn" onClick={readBrief} data-testid="button-read-brief"><AudioLines size={14} /> Read brief</button>
                <button type="button" className="btn" aria-label="Download daily brief" onClick={() => downloadReport(`${demoMode ? "DEMO DATA · synthetic browser-only examples; not live inventory.\n\n" : "LIVE WORKSPACE DATA.\n\n"}${dailyBrief}`)} data-testid="button-download-brief"><Download size={14} /></button>
              </div>
            </div>
            {essentialLoading ? <div className="intel-skeleton" aria-label="Loading daily brief"><i /></div>
              : essentialError ? <p className="intel-brief-text">Live stock context is unavailable. Retry the product and movement lists to build the brief.</p>
                : <p className="intel-brief-text" data-testid="text-daily-brief">{briefSummary}</p>}
            <div className="intel-brief-foot">{demoMode ? "SYNTHETIC DEMO RECORDS" : "LIVE WORKSPACE RECORDS · RULE-BASED"}</div>
            {voiceStatus && <div role="status" className="intel-brief-foot" data-testid="status-read-brief">{voiceStatus}</div>}
          </article>
          <article className="intel-health" data-testid="panel-inventory-health">
            <div>
              <div className="intel-section-label">Inventory health · estimate</div>
              <div className="intel-score-row"><div className="intel-score" data-testid="text-health-score">{intelligence.health.available && !essentialLoading && !essentialError ? intelligence.health.score : "—"}<small>/100</small></div><span className="intel-score-mark"><ShieldCheck size={24} /></span></div>
              <p className="intel-health-note">{essentialLoading ? "Loading the records required for an estimate." : essentialError ? "Live product or movement data could not be loaded." : intelligence.health.note}</p>
            </div>
            {intelligence.health.available && !essentialError && <div className="intel-health-bars" aria-label="Health estimate rule breakdown">
              {[["Out of stock", intelligence.health.breakdown.outOfStockShare], ["Below reorder", intelligence.health.breakdown.lowStockShare], ["Unusual moves", intelligence.health.breakdown.unusualMovementShare]].map(([label, share]) => {
                const value = share as number | null;
                return <div className="intel-health-line" key={label as string}><span>{label as string}</span><div className="intel-health-track"><i style={{ width: `${(value ?? 0) * 100}%` }} /></div><b>{percentText(value)}</b></div>;
              })}
            </div>}
          </article>
        </section>

        <section className="intel-metrics" aria-label="Inventory summary" data-testid="section-intelligence-summary">
          <div className="intel-metric"><strong>{essentialLoading || essentialError ? "—" : numberText(products.length)}</strong><span>Products checked</span></div>
          <div className="intel-metric"><strong>{essentialLoading || essentialError ? "—" : numberText(intelligence.totalUnits)}</strong><span>Units on hand</span></div>
          <div className="intel-metric"><strong>{essentialLoading || essentialError ? "—" : numberText(intelligence.signals.length)}</strong><span>Review signals</span></div>
          <div className="intel-metric"><strong>{(movesQuery.isLoading || movesQuery.isError) && !demoMode ? "—" : numberText(intelligence.recentMoveCount)}</strong><span>Moves · 30 days</span></div>
        </section>
        {!essentialLoading && !essentialError && products.length > 0 && moves.length === 0 && <div className="intel-state" style={{ marginBottom: 20 }} data-testid="state-empty-movements"><div><strong>No stock movements recorded.</strong>Movement-rate cover and unusual-movement checks need a recorded ledger history.</div></div>}

        <section aria-label="Review signals">
          <div className="intel-toolbar">
            <div><div className="intel-section-label">Review queue</div><h2 className="display">Three ways stock asks for attention</h2></div>
            <label className="intel-search"><Search size={15} aria-hidden="true" /><input className="field" type="search" aria-label="Search products, locations, warehouses and operations" placeholder="Search products, locations, operations" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-intelligence" /></label>
          </div>
          {essentialLoading ? <div className="intel-skeleton" aria-label="Loading inventory signals"><i /><i /><i /></div>
              : essentialError ? <div className="intel-state" role="alert" data-testid="state-intelligence-error"><div><strong>Live signals could not be calculated.</strong>
                {productsQuery.isError && <div className="intel-source-error">Product catalog unavailable. <button type="button" className="btn btn-outline" onClick={() => void productsQuery.refetch()} data-testid="button-retry-intelligence-products"><RefreshCw size={13} /> Retry products</button></div>}
                {movesQuery.isError && <div className="intel-source-error">Stock movement history unavailable. <button type="button" className="btn btn-outline" onClick={() => void movesQuery.refetch()} data-testid="button-retry-intelligence-moves"><RefreshCw size={13} /> Retry movements</button></div>}
              </div></div>
              : intelligence.signals.length ? <div className="intel-signals" data-testid="list-intelligence-signals">
                {intelligence.signals.filter((signal) => !term || `${signal.productName} ${signal.sku} ${signal.kind} ${signal.location} ${signal.reason}`.toLowerCase().includes(term)).map((signal) => {
                  const liveProduct = demoMode ? undefined : products.find((item) => item.id === signal.productId);
                  const realOperation = !demoMode && signal.operationId !== null;
                  return <article className="intel-signal" data-severity={signal.severity} key={signal.id} data-testid={`signal-${signal.kind}-${signal.productId}`}>
                    <i className="intel-signal-bar" aria-hidden="true" />
                    <div className="intel-signal-main">
                      <div className="intel-signal-top"><span className="intel-kind">{signalTitle[signal.kind]}</span><span className="intel-severity">{severityName[signal.severity]}</span></div>
                      <h3>{signal.productName}</h3><div className="intel-signal-meta"><span className="mono">{signal.sku}</span> · {numberText(signal.stock)} {signal.unit} · <MapPin size={11} aria-hidden="true" /> {signal.location}</div>
                      <p className="intel-signal-reason">{signal.reason}</p>
                      <ul className="intel-evidence">{signal.evidence.map((item, index) => <li key={`${signal.id}-${index}`}>{item}</li>)}</ul>
                      <p className="intel-recommendation">Next: {signal.recommendation}</p>
                    </div>
                    <div className="intel-signal-actions">
                      {liveProduct
                        ? <Link className="btn btn-outline" href={`/products/${liveProduct.id}`} data-testid={`link-intelligence-product-${signal.productId}`}><Package size={14} /> Product</Link>
                        : <button type="button" className="btn btn-outline" onClick={() => askQuestion(`What should I know about ${signal.productName}?`, signal.productId)} data-testid={`button-demo-context-${signal.productId}`}><Package size={14} /> Explain</button>}
                      {realOperation && <Link className="btn btn-soft" href={`/operations/${signal.operationId}`} data-testid={`link-intelligence-operation-${signal.operationId}`}>Operation <ArrowRight size={13} /></Link>}
                    </div>
                  </article>;
                })}
              </div> : <div className="intel-state" data-testid="state-empty-signals"><div><strong>{term ? "No signals match this search." : "No current review signals."}</strong>{term ? "Try another product, location, or operation term." : "Nothing met the current deterministic review rules."}</div>{term && <button type="button" className="btn btn-outline" onClick={() => setSearch("")} data-testid="button-clear-intelligence-search">Clear search</button>}</div>}
        </section>

        <div className="intel-content-grid">
          <section className="intel-panel" aria-label="Search loaded workspace records">
            <div className="intel-panel-title"><div><div className="intel-section-label">Find in workspace</div><h2 className="display">Products, places, operations</h2></div><Search size={17} color="#8295a8" /></div>
            {term ? <>
              <div className="intel-section-label">Products · {productsQuery.isLoading && !demoMode ? "loading" : productResults.length}</div>
              <div className="intel-search-results">{productResults.map((product) => demoMode
                ? <button type="button" className="intel-result" key={product.id} onClick={() => askQuestion(`What should I know about ${product.name}?`, product.id)} data-testid={`button-search-demo-product-${product.id}`}><span><strong>{product.name}</strong><small>{product.sku} · DEMO ONLY</small></span><ArrowRight size={14} /></button>
                : <Link className="intel-result" key={product.id} href={`/products/${product.id}`} data-testid={`link-search-product-${product.id}`}><span><strong>{product.name}</strong><small>{product.sku} · {numberText(product.totalStock)} {product.unit}</small></span><ArrowRight size={14} /></Link>)}
              {!productResults.length && <p className="subtle">No matching products.</p>}</div>
              <div className="intel-section-label" style={{ marginTop: 16 }}>Locations · {productsQuery.isLoading && !demoMode ? "loading" : locationResults.length}</div>
              <div className="intel-search-results">{locationResults.map((item) => <button type="button" className="intel-result" key={`${item.warehouse}::${item.location}`} onClick={() => selectLocationContext({ locationName: item.location, warehouseName: item.warehouse })} data-testid={`result-search-location-${item.location.replace(/\W+/g, "-").toLowerCase()}`}><span><strong>{item.location}</strong><small>{item.warehouse} · {numberText(item.quantity)} units</small></span><span className="intel-result-action">Analyze <ArrowRight size={13} /></span></button>)}{!locationResults.length && <p className="subtle">{productsQuery.isError && !demoMode ? "Location search unavailable." : "No matching stocked locations."}</p>}</div>
              <div className="intel-section-label" style={{ marginTop: 16 }}>Warehouses · {demoMode ? "hidden" : warehousesQuery.isLoading ? "loading" : warehouseResults.length}</div>
              <div className="intel-search-results">{demoMode ? <p className="subtle">Live workspace warehouses are hidden in demo mode.</p> : <>{warehouseResults.map((warehouse) => <div className="intel-result" key={warehouse.id} data-testid={`result-search-warehouse-${warehouse.id}`}><span><strong>{warehouse.name}</strong><small>{warehouse.code} · {warehouse.locationCount} locations</small></span><Warehouse size={14} /></div>)}{!warehouseResults.length && <p className="subtle">{warehousesQuery.isError ? "Warehouse search unavailable." : "No matching warehouses."}</p>}</>}</div>
              <div className="intel-section-label" style={{ marginTop: 16 }}>Operations · {demoMode ? "hidden" : operationsQuery.isLoading ? "loading" : operationResults.length}</div>
              <div className="intel-search-results">{demoMode ? <p className="subtle">Live workspace operations are hidden in demo mode.</p> : <>{operationResults.map((operation) => <Link className="intel-result" key={operation.id} href={`/operations/${operation.id}`} data-testid={`link-search-operation-${operation.id}`}><span><strong>{operation.reference} · {operation.type}</strong><small>{operation.status} · {operation.lines.map((line) => line.productName).join(", ") || "No product lines"}</small></span><ArrowRight size={14} /></Link>)}{!operationResults.length && <p className="subtle">{operationsQuery.isError ? "Operation search unavailable." : "No matching operations."}</p>}</>}</div>
            </> : <div className="intel-state"><div><strong>Search loaded records</strong>Find products by name or SKU, warehouse locations, and operation references or line items.</div></div>}
          </section>
          <section className="intel-panel" aria-label="Stock by location">
            <div className="intel-panel-title"><div><div className="intel-section-label">Storage picture</div><h2 className="display">Stock by location</h2></div><MapPin size={17} color="#8295a8" /></div>
            {productsQuery.isError && !demoMode ? <div className="intel-state" role="alert"><div><strong>Location breakdown unavailable.</strong>Retry the product list.</div><button type="button" className="btn btn-outline" onClick={() => void productsQuery.refetch()} data-testid="button-retry-locations">Retry</button></div>
              : !productsReady ? <div className="intel-skeleton"><i /></div> : locationTotals.length ? <div className="intel-locations" data-testid="list-stock-locations">
              {locationTotals.slice(0, 8).map((location) => <button type="button" className="intel-location-row" key={`${location.warehouseName}::${location.locationName}`} onClick={() => selectLocationContext({ locationName: location.locationName, warehouseName: location.warehouseName })} data-testid={`location-stock-${`${location.warehouseName}-${location.locationName}`.replace(/\W+/g, "-").toLowerCase()}`}><span>{location.locationName}<small>{location.warehouseName}</small></span><div className="intel-location-bar"><i style={{ width: `${(location.quantity / maxLocationStock) * 100}%` }} /></div><b>{numberText(location.quantity)}</b></button>)}
              <div className="intel-section-label" style={{ marginTop: 7 }}>{new Set(products.flatMap((product) => product.locationStocks.map((stock) => stock.warehouseName))).size} warehouses · {locationTotals.length} stocked locations</div>
            </div> : <div className="intel-state"><div><strong>No location stock recorded.</strong>Locations appear as stock is recorded against products.</div></div>}
          </section>
        </div>

        <section className="intel-ask" aria-label="Ask about inventory">
          <div className="intel-panel">
            <div className="intel-section-label">Ask the inventory rules</div>
            <h2 className="display" style={{ margin: "5px 0 0", font: "700 21px 'Syne',sans-serif", letterSpacing: "-.04em", color: "#243c56" }}>A straight answer from recorded data.</h2>
            {contextProduct && <p className="intel-camera-status" data-testid="text-intelligence-context">Context: {contextProduct.name} · {contextProduct.sku}{demoMode ? " · DEMO" : ""}</p>}
            {contextOperation && <p className="intel-camera-status">Operation context: {contextOperation.reference}</p>}
            {contextLocation && <p className="intel-camera-status" data-testid="text-intelligence-location-context">Location context: {contextLocation.warehouseName ? `${contextLocation.warehouseName} · ` : ""}{contextLocation.locationName} <button type="button" className="btn btn-outline" onClick={() => { setContextLocation(null); setAnswer(null); }}>Clear</button></p>}
            <form className="intel-ask-form" onSubmit={(event) => { event.preventDefault(); askQuestion(); }}>
              <input className="field" type="text" value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Ask an inventory question" placeholder="Which item needs attention?" data-testid="input-inventory-question" />
              <button type="submit" className="btn btn-primary" disabled={essentialLoading || essentialError} data-testid="button-ask-inventory"><Activity size={15} /> Ask</button>
            </form>
            <div className="intel-ask-tools">
              <button type="button" className="btn btn-outline" onClick={startVoiceQuery} data-testid="button-voice-query"><Mic size={15} /> Ask by voice</button>
              <button type="button" className="btn btn-outline" onClick={cameraOn ? stopCamera : startCameraScan} data-testid="button-camera-scan">{cameraOn ? <X size={15} /> : <Barcode size={15} />}{cameraOn ? "Stop scan" : "Scan SKU"}</button>
              <button type="button" className="btn btn-soft" onClick={() => askQuestion("Which products are overstock candidates?")} data-testid="button-ask-overstock">Overstock review</button>
            </div>
            {(voiceStatus || cameraStatus || cameraError) && <p className="intel-camera-status" role="status" data-testid="status-device-capability">{cameraError || cameraStatus || voiceStatus}</p>}
            {cameraOn && <div className="intel-camera" data-testid="panel-camera-scan"><video ref={videoRef} muted playsInline aria-label="Live barcode camera preview" /><p className="intel-camera-status">Camera is active only for this scan. No image is uploaded.</p></div>}
          </div>
          <div aria-live="polite">
            {answer ? <article className="intel-answer" data-testid="panel-inventory-answer">
              <div className="intel-answer-tag">{answer.providerLabel}</div><h3>{answer.answer}</h3><p>{answer.why}</p>
              <ul>{answer.evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul><p><strong>Next:</strong> {answer.action}</p>
              {answer.productId && (demoMode
                ? <span className="intel-section-label">DEMO PRODUCT · no live record link</span>
                : <Link className="btn btn-outline" href={`/products/${answer.productId}`} data-testid={`link-answer-product-${answer.productId}`}>Open product <ArrowRight size={13} /></Link>)}
              {answer.operationId && <Link className="btn btn-outline" href={`/operations/${answer.operationId}`} data-testid={`link-answer-operation-${answer.operationId}`}>Open operation <ArrowRight size={13} /></Link>}
              {answer.locationName && <div className="intel-section-label" data-testid="text-answer-location">LOCATION · {answer.locationName}</div>}
            </article> : <div className="intel-answer"><div className="intel-answer-tag">Deterministic inventory rules</div><p>Answers use the same visible stock, movement, and review rules shown above. No external model or service is used.</p></div>}
          </div>
        </section>

        {queryErrors.length > 0 && <div className="intel-state" role="status" style={{ marginTop: 16 }} data-testid="status-partial-data"><div><strong>Some live sections are unavailable.</strong>{queryErrors.map((item) => item.name).join(", ")} could not be loaded. Other available data remains visible.</div><button type="button" className="btn btn-outline" onClick={retryAll} data-testid="button-retry-partial-data"><RefreshCw size={14} /> Retry all</button></div>}
        {!products.length && !essentialLoading && !essentialError && <div className="intel-state" style={{ marginTop: 16 }} data-testid="state-empty-products"><div><strong>No products to review yet.</strong>Add products and record movements to build an inventory intelligence view.</div><Link className="btn btn-primary" href="/products" data-testid="link-add-intelligence-products">Open products</Link></div>}
        <p className="intel-health-note" style={{ marginTop: 17 }}><AlertCircle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />Signals are review prompts based on recorded inventory; they do not change stock or operations.</p>
      </main>
    </Shell>
  );
}