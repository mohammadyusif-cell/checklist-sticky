# Checklist Sticky - web / iPhone version
Static site (no server code). Reads/writes his OneDrive file `Checklist Sticky/checklist.json` through Microsoft Graph (MSAL.js, sign-in with his Microsoft account).
- config.js: set `clientId` (Entra app registration: SPA platform, redirect URI = the site URL, "Personal Microsoft accounts" allowed, delegated Files.ReadWrite).
- Without a clientId (or with ?demo) it runs on sample-checklist.json in this browser only (synthetic data).
- merge.js: 3-way merge by item id (same rules as the PC app). Tests: `node merge.test.js`.
- Saves use If-Match (eTag); on a conflict it reloads, merges, and saves again. Polls every 15 s while open.
- Never deploy webtest/ (it holds a copy of real data for local testing).
- List layout is per device (localStorage, never checklist.json): `cs.collapsed` (tap a list header to collapse/expand), `cs.listOrder` (top-to-bottom list order), `cs.listCols2` / `cs.listCols4` (column a list sits in, 2- and 4-column layouts). Reorder mode (⇅) shows list arrows on each header plus Collapse all / Expand all / Reset order. Lists missing from a saved order are put back at their default spot.
