# Staff startup recovery

Base: live Staff `9dd4d1a211ee6fcc93f075d0bb238619ced6c9a1`. The setup page can render before its application module links. An exact older cached document model reproduces a missing named-export failure before registration installs; an older phone module can also break the previous module-based updater. This is a reproduced failure mode, not a reading of the affected Android phone's cache.

The new classic startup script installs recovery before the module graph and external libraries. Early setup taps and failed or slow startup show a bounded, readable recovery message. The updater has no Firebase, module or dialog-library dependency. It preserves phone registration, Auth, PINs, IndexedDB, local storage, setup drafts and attendance. A completed application announces readiness only after all existing installers finish.

The Staff worker installs one complete, byte-verified static cohort using generated SHA256 and size pins. It never replaces that cohort's modules with unchecked files from another deployment. Dynamic API and third-party requests remain outside its static cache. Incomplete or mismatched downloads cannot activate. Previous caches remain available to older workers.

An update waits for explicit repair. Before skipping waiting, the worker asks every in-scope Staff window whether it is ready, or is the window explicitly repairing, and has no pending protected work. Unknown, half-started, busy or newly opened windows hold activation. Other windows are not reloaded. The repairing page checks attendance, registration, unsent reasons, selected files and connectivity again before reloading. A slow or uncertain operation leaves the current page and saved data intact.

Product scope: `index.html`, `sw.js`, new `staff-startup.js`, and one final readiness line in `app.js`. Existing attendance, authentication, device activation, personal-code, payroll, document and loan logic is unchanged. Cashier, other apps, Firebase functions, Rules, IAM and dependencies are outside the change.

Validation includes native module-link failures without app evaluation, classic recovery with the main application absent, verified-worker/cohort and multi-window activation tests, exact source boundaries, and the normal hosted regression suite. Native browser recovery uses fictional local assets with the actual startup and worker runtime; no Staff credentials or attendance are created.

Generate the shell pins only after all Staff files are final: `node tools/build-staff-shell-cohort.mjs`. Verify them with `--check`. Full regression and installed SDK checks run on the hosted review branch, not on the user's PC.
