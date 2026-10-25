# Personal Staff app setup codes

This release adds an Owner-issued, reusable **10-digit Staff app setup code** for each employee. Correct setup codes activate the Staff app automatically; no separate device approval click is required. This code is separate from the daily Staff login PIN and Payslip PIN.

Each employee may have **at most two active Staff app devices**. The limit belongs to the employee account, so replacing the setup code or clearing browser data does not reset it. A reset phone obtains a new identity; its old registration continues to occupy a place until the Owner blocks or deletes it. Blocked/deleted registrations do not occupy an active place. Unblocking a phone must reserve a place again and is refused when two other phones are active. The profile shows the last checked active-device count and offers a separate usage refresh that preserves a newly shown setup code.

## Owner workflow

1. Open **Staff & Security**, then open the employee's profile.
2. In **Staff app setup code**, choose **Generate setup code**. The browser generates ten unbiased cryptographically random digits; leading zeros are retained. Only after HQ confirms the operation is the code shown for private copying.
3. Give the code privately to that employee. It is held in page memory only, never written to a public profile or browser storage, and disappears when the profile closes, the page hides, navigation changes or the Owner account changes. An existing code cannot be retrieved; use **Replace setup code** if another copy is needed.
4. Prepare and distribute codes before using the **Require personal setup codes** rollout control under Staff & Security. Existing phones require one setup-code confirmation because their legacy public device IDs do not establish a trusted staff/device identity.
5. **Replace** or **Disable** stops future setups using the old code. It does not revoke already activated phones. Use **Block** or **Delete** in Staff & POS devices to stop a particular registration at its next verification. To prevent both existing access and new/reset-phone activation, block the relevant phones and disable that employee's setup code.

Only the approved, verified Owner identity can issue/replace/disable codes, change rollout policy or manage protected phone bindings. Legacy POS device controls remain on their existing path. No staff messages are sent automatically.

## Staff workflow

On first protected setup or after clearing the app's site data:

1. Connect to the internet, name the phone and choose the staff account.
2. Enter the personal setup code supplied by the Owner.
3. The server checks the code, active staff profile and device identity, then activates and binds the phone to that staff account. It supplies the branch from the saved profile.
4. Continue with the existing daily Staff login PIN. A different employee's login PIN cannot switch the phone's enrollment.

Routine reopening remembers the device identity and rechecks its server status. Replacing the anonymous identity, editing a local DEV ID, an unconfirmed request or a public fleet row marked Active does not establish a protected binding. A reset/new identity needs the code again. Reinstalling a PWA shortcut may retain browser site data, so reinstalling the icon alone is not a reliable fresh-device event; clearing site data or Owner revocation controls the stored registration.

## Trusted service and private data

- Firebase project: `takodeal-pos`.
- Function: `staffDeviceSetup`, Node 22, `asia-southeast1`.
- Fixed endpoint: `https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDeviceSetup`.
- Exact production browser origins: Owner and Staff. CORS restricts browser use, while Firebase token verification with revocation checking establishes identity. No service-account key is created or delivered to the browser.
- Runtime identity: `staff-device-setup@takodeal-pos.iam.gserviceaccount.com`.
- Runtime bounds: 512 MiB, 1 CPU, concurrency 4, min instances 0, max instances 2, timeout 30 seconds. These bounds do not constitute a hard billing cap.
- Private collections: `staff_setup_credentials`, `staff_app_setup_config`, `staff_app_bindings`, `staff_app_device_index`, `staff_setup_audit`, `staff_setup_operations`, `staff_setup_attempts`, `staff_setup_device_slots`. All client reads and writes are denied; the service supplies limited metadata.
- Credentials use independent salted scrypt verifiers. Plaintext codes are never stored. Immutable audit entries omit codes/verifiers; private operation receipts retain a salted verifier only when necessary to validate an exact uncertain retry.
- Server validation checks exact routes, methods, fields, sizes, origins, verified Owner or anonymous device identity, staff eligibility, expected versions and operation IDs. Activation attempts are limited by verified UID, transport peer and global counters. The transport peer may group users behind the cloud proxy, so the UID/global limits remain essential.
- Enrollment commits the private UID binding, immutable device index, public fleet mirror, operation receipt and audit atomically. Lost acknowledgements retry the same operation. Stale code/policy/device operations do not overwrite or falsely confirm newer decisions. A deleted device index remains reserved.
- Public `pos_devices` mirrors with setup metadata or private index reservations cannot be created, changed, marker-stripped or deleted directly by any client, including Owner. Protected fleet actions must go through the service.

Code issuance/rotation is independent of current phone status. Blocked/deleted protected devices remain protected when the global rollout is paused. Legacy mode is returned only for an unbound/unreserved device while the explicit trusted policy is disabled; network errors never grant legacy fallback.

The two-device counter is a private per-employee slot registry read and updated in the same transaction as activation, blocking, unblocking or deletion. Concurrent requests compete for the same registry; retries do not allocate another place. Rotation never clears it. Each tracked active place is checked against the exact private UID binding, immutable device index and fleet mirror. A missing or inconsistent registry fails closed, instead of assuming zero. The initial two-device deployment requires verified empty protected credential/binding collections with rollout disabled; existing untracked credentials require a separately reviewed migration. No query/list permission is added to the runtime role.

## Cloud release order

1. Verify exact candidate source/dependency/test hashes and current production baseline. The dedicated runtime identity and function do not exist in the read-only prerequisite check dated October 25, 2026. Existing anonymous Firebase sign-in and billing are enabled.
2. Provision the dedicated runtime identity with the reviewed narrow custom role below. Preserve existing IAM bindings and unrelated services. Do not use the project's broad default runtime identity as a shortcut.
3. Deploy only the `staff-device-setup` codebase using `firebase.staff-device-setup.json`; no other function or Storage policy is part of this release. Verify service identity, scaling, token handling and exact-origin transport using sample accounts only.
4. Publish the reviewed Firestore rule changes: private setup collections plus deny-only protection of enrolled Staff fleet mirrors. The change does not migrate legacy staff/payroll/financial authorization.
5. Publish Owner and Staff app files and cache updates. Verify exact public asset hashes. Keep rollout disabled while codes are prepared. Do not silently generate real staff codes, enroll phones or enable rollout during deployment.
6. The Owner issues/distributes real codes and enables the requirement when ready. Test one explicitly designated staff/device under Owner supervision before wider use. Do not use real payroll or attendance mutations for security tests.

The runtime needs `datastore.databases.get` for transaction begin/rollback, `datastore.entities.get`, `datastore.entities.create`, `datastore.entities.update`, `datastore.entities.delete`, and `firebaseauth.users.get` for revoked-token verification. It needs no Storage access, query/list permission, Auth create/update/delete permission or service-account key. Firestore IAM does not restrict these permissions by collection like client Rules; the reviewed fixed service paths enforce the narrower application boundary. Deployment/build/invoker permissions are separate and must be reviewed without broadening the runtime role.

## Scope and verification

This implements protected **device enrollment and app gating**. It does not claim to repair all legacy publicly readable/writable staff, payroll, attendance or financial collections found in the separate full audit. PIN-sharing and malicious physical device control also remain outside a setup code's guarantees. A separate identity/authorization migration is still needed before describing the whole Staff system as secured.

Verification uses synthetic accounts, the actual client transports and service core, isolated browser fixtures, the full local Firestore Rules emulator and the real installed Admin/Functions SDK with network and credential reads blocked. Existing production phones, codes, staff profiles, payroll, stock, attendance and permissions are not changed by local tests. Production activation/IAM/routing tests remain release checks; local seams are not evidence that a cloud deployment already exists.

Official references: [Firebase anonymous identity](https://firebase.google.com/docs/auth/web/anonymous-auth), [revoked-token verification](https://firebase.google.com/docs/auth/admin/manage-sessions), [HTTP functions](https://firebase.google.com/docs/functions/http-events), [Firestore server IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam), [function runtime identity](https://firebase.google.com/docs/functions/manage-functions).
