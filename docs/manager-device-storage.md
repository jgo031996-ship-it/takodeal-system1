# Manager login and device storage

Open the Manager app online once, then use **Install app** on the login screen. Edge/Chrome offer an install action; Safari uses Share → Add to Home Screen. An already installed app gets the same update after reopening.

The green login screen loads independently of the large Manager workspace. Google account access is checked once against the server. The configured PIN starts the workspace, then the dashboard starts its live subscriptions. Report exports and maps load when used. Wrong PINs do not start tab data downloads.

The service worker saves the app shell, scripts, styles, logos, and versioned third-party libraries. It serves saved files on later launches without downloading each file again. Updates replace the app-file cache as a generation. It does not cache Firestore requests, authentication responses, or business APIs.

Menu and recipe reference data additionally use an IndexedDB store keyed by authenticated user ID, with the same 15-minute freshness window as the shared memory cache. Edits invalidate both caches, including notifications from another tab. The reference store does not contain account profiles, PINs, cash, stock balances, attendance or payroll. Firestore's existing persistent SDK cache remains enabled for normal data synchronization.

An offline launch can display saved app files, but a new unlock needs a connection to verify current account access. No cached permissions, default PIN, or universal override can unlock it. Slow verification times out and offers Retry. Existing PINs and permissions are unchanged.

The **Device storage protected** indicator is shown only when the browser confirms persistent storage. Otherwise the app uses available device cache and the browser manages its space. Clearing site data or uninstalling/removing app data can remove those files. No changes are made to Cashier's saved orders or its storage.
