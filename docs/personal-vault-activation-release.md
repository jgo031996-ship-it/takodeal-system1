# Personal-code activation and Pay access

An Owner-issued personal setup code already registers the exact employee and Firebase anonymous phone identity. That active registration now authorizes that employee's private Pay/profile endpoints, including Vault settings, first setup and Forgot PIN. No separate document-upload approval is required for Pay. Document uploads retain their existing separate client and approval.

Authority is checked inside the same transaction as each private read/write. The employee, protected UID, branch, device index, Staff mirror, enabled setup credential, signed slot-registry hash and active slots must agree. Pausing enrollment does not revoke an existing registration. Disabling its credential, blocking/deleting the phone, an inactive employee, a branch mismatch or a damaged registration denies the personal-code path. Existing explicit private-phone grants retain their current behavior.

Vault setup continues to verify the daily Staff PIN. Recovery continues to require the current 10-digit personal setup code and a new separate 6–8 digit Payslip PIN. Recovery preserves PIN version checks, rate limits, retries, salted verifiers and atomic audit writes. It leaves Pay locked until the new Vault PIN is entered. No login PIN, payroll amount, payment state, document grant or Firestore policy is changed by this release.

## Release dependencies

Deploy the reviewed `functions/cash-remittance-review` and `functions/staff-device-setup` sources to project `takodeal-pos`, region `asia-southeast1`, preserving the existing runtime settings and service accounts. Inspect the currently deployed source/config before publishing; the independent app Git branches are not interchangeable backend deployment sources.

The paired Staff client is `fix/staff-personal-vault`, based on the deployed Staff branch `fix/staff-self-repair-swaps`. Do not promote that client until both backend functions are confirmed updated. Otherwise an already activated primary phone may be selected before its backend authorizes private Pay.

Validate with synthetic identities: activate an Owner-issued code, pause new enrollment, open Vault setup, create a separate PIN, reopen Pay, recover with the current personal code, and verify that Pay remains locked after recovery. Reject a different staff ID/device, disabled credential, blocked phone and changed registration. Do not use real employee PINs in logs or screenshots.

Local backend validation: 157 directly relevant tests pass, including the personal-phone authority, private profile/Vault, payroll, loans, setup-code and recovery tests. Production activation still requires an authenticated Firebase deployment connection.
