# Checklist Sticky for Mac

Apple Silicon desktop app for the same checklist as the website. The window is a normal Dock app: it resizes, minimizes, zooms, and can go full screen. **Keep Window on Top** (or the pin button) floats it above other windows. A normal window is two columns, with Tasks on the left and Payroll and Bills on the right. Full screen forces four columns and larger text. List collapse, list order, and task order stay on this Mac (`localStorage`), the same way the website keeps them in the browser. The checklist file itself is still `Checklist Sticky/checklist.json` on OneDrive.

This build is for Apple Silicon (arm64). It asks for macOS 13 or later, which includes the Mac this was requested for. It is not a link to the website.

## Install

1. Download `Checklist-Sticky-mac-arm64.dmg` or `Checklist-Sticky-mac-arm64.zip` from the **macOS desktop** workflow on this pull request (the Actions artifact, not a GitHub Release).
2. Open the disk image, or unzip the archive, and move **Checklist Sticky** to Applications.
3. The first time, macOS Gatekeeper will say the app is from an unidentified developer. The app is ad-hoc signed on the Mac builder and is **not notarized**. Right-click the app, choose **Open**, then **Open** again. Leave Gatekeeper on. Do not disable System Integrity Protection or run `spctl --master-disable`.

There is no Developer ID certificate in this build, so it cannot be notarized. A later build can be signed and notarized if an Apple Developer ID Application certificate and an app-specific notarization password are provided to the Mac workflow. Those secrets are not in this repository.

## Sign in

The app does not embed Microsoft’s website and it does not contain a client secret. **Sign in to OneDrive…** opens your usual browser to `login.microsoftonline.com`, then a loopback page on `http://127.0.0.1` returns the authorization code to the app (PKCE, public client). Tokens are stored with the macOS Keychain (`safeStorage`). If the Keychain is unavailable, they stay in memory until quit and are not written as plaintext.

Until the Entra app registration allows that redirect, sign-in cannot succeed. Use **Use sample checklist** instead. That mode loads the synthetic `sample-checklist.json` already in this repo and never calls Microsoft Graph.

To allow the real checklist, in the existing app registration (the public client id in `config.js`):

1. Authentication → Add a platform → **Mobile and desktop applications**.
2. Add the redirect URI `http://localhost`. The port is ignored for `localhost`; the app listens on 127.0.0.1 and `[::1]` only.
3. Allow public client flows. Do **not** create a client secret.
4. Keep the delegated **Files.ReadWrite** permission and personal Microsoft accounts, which the website already uses.

The app only reads and conditionally updates `Checklist Sticky/checklist.json`. If that file is missing, it shows the same explanation as the website and does not create one. It never deletes OneDrive files. Saves send `If-Match` and merge on a conflict, using the same `merge.js` as the website.

Browser layout preferences do not move into the app, because they live in that browser’s `localStorage`. The defaults match the website: Tasks left, Payroll and Bills right. After you arrange lists on the Mac, that arrangement stays on the Mac.

## Develop

From `desktop/`, `npm test` runs the merge-independent desktop tests and a jsdom pass over the real page (sample data only). `npm run demo` opens the sample checklist and does not contact Microsoft. `npm run smoke` checks the two-column sample layout and fails if the window tries to reach Microsoft.

`npm run pack:mac` needs network once to fetch the Electron arm64 Mac binary. On Linux it can assemble the `.app` and zip it, but that zip is unsigned, so this repository does not publish it. Apple Silicon will not treat an unsigned binary as a normal app. The **macOS desktop** workflow runs on the macOS 27 Apple Silicon image (`xcode-27`), ad-hoc signs the bundle, and runs `--smoke` inside the `.app`. That job is the launch check. It is not a claim that the app was opened on a specific Mac running 27.2 until the log shows that version.

The packaged page is loaded from `checklist://app/` with a content security policy that blocks remote documents. The `?demo` query is a fail-safe so a missing preload bridge cannot fall through to an in-window Microsoft login.
