# Google place picking in StockSense

Manual address entry and browser device coordinates work without Google credentials.

To enable search suggestions and a clickable Google map in the Products location creator:

1. Enable billing on a Google Maps Platform project and enable **Places API (New)**, **Geocoding API**, and **Maps JavaScript API**.
2. Create **two separate API keys** in Google Cloud Console:
   - A server key restricted to Places API (New) and Geocoding API, with the appropriate server application restrictions for the deployment environment.
   - A browser key restricted to Maps JavaScript API and to your app's permitted development and published website referrers.
3. In Replit Secrets, set `GOOGLE_MAPS_SERVER_KEY` to the server key and `GOOGLE_MAPS_BROWSER_KEY` to the browser key. Do not put either key into source control or a chat message. The browser key is intentionally sent to signed-in browsers when the feature is enabled; restrict its referrers and API access accordingly.
4. Restart the API Server workflow after changing secrets. When either key is absent, Google search and pin picking remain unavailable and the manual form stays usable.

The server enforces 30 Google lookups per account per minute, in addition to Google project's own quotas/billing. It resolves Google selections again when the location is saved; unconfirmed previews do not create locations. Editing a saved location's address or coordinates removes its Google place attribution.