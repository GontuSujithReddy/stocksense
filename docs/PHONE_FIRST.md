# Phone-first experience

## Primary phone loop

1. Open Intelligence and scan the highest-priority review signal.
2. Inspect current stock, reorder point, recorded movement, and location.
3. Ask a short typed or spoken question.
4. Confirm the supporting evidence.
5. Continue to the existing product or operation flow to make a change.

The web app remains usable on desktop for wider inventory review and report inspection. It does not require a laptop for the core review-and-action path.

## Browser capabilities

### Voice query

- Uses the browser's native SpeechRecognition or webkitSpeechRecognition API when exposed.
- Starts only after the user activates the microphone control.
- Sends the transcript through the same deterministic inventory rules used for typed questions.
- If unsupported or denied, keeps the typed question available and explains the limitation.

### Camera barcode scan

- Uses `getUserMedia` and `BarcodeDetector` only when the browser exposes both APIs.
- Starts only after the user asks to scan and grants camera access.
- Matches the decoded text against product SKUs; it does not recognize product images.
- Stops camera tracks when scanning ends or the page is left.
- If unsupported, denied, or unmatched, the user can search by SKU.

### Daily brief playback

- Uses browser `speechSynthesis` when available and after a user action.
- The text brief remains readable even when playback is unavailable.

## Installable app

- A web manifest and app icons allow supported mobile browsers to offer home-screen installation.
- Sign-in and live inventory require a network connection. StockSense does not cache private inventory or claim offline operation.

## Accessibility and reliability

- Keep touch targets large enough for phone use.
- Keep controls labeled for assistive technology and usable from a keyboard.
- Preserve visible focus and status text; do not communicate risk by color alone.
- Respect reduced-motion preferences.
- Keep loading, empty, error, and retry states distinct.
- Never interpret a failed inventory query as an empty workspace.

## Office Kit

StockSense does not integrate directly with Office Kit. Phone capture/voice and quick review can complement a separate phone/laptop bridge. Users can export a report or open a detail view on a larger screen using the capabilities provided by their device and browser.