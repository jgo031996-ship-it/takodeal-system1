# Personal-code activation and Pay access

An Owner-issued personal setup code already registers the exact employee and Firebase anonymous phone identity. That active registration now authorizes that employee's private Pay/profile endpoints, including Vault settings, first setup and Forgot PIN. No separate document-upload approval is required for Pay. Document uploads retain their existing separate client and approval.

Authority is checked inside the same transaction as each private read/write. The employee, protected UID, branch, device index, Staff mirror, enabled setup credential, signed slot-registry hash and active slots must agree. Pausing enrollment does not revoke an existing registration. Disabling its credential, blocking/deleting the phone, an inactive employee, a branch mismatch or a damaged registration denies the personal-code path. Existing explicit private-phone grants retain their current behavior.

Vault setup continues to verify the daily Staff PIN. Recovery continues to require the current 10-digit personal setup code and a new separate 6–8 digit Payslip PIN. Recovery preserves PIN version checks, rate limits, retries, salted verifiers and atomic audit writes. It leaves Pay locked until the new Vault PIN is entered. No login PIN, payroll amount, payment state, document grant or Firestore policy is changed by this release.

## Reviewed backend and Staff client

The two functions run in `takodeal-pos`, region `asia-southeast1`, on Node.js 22 (Gen 2). The 17 November production comparison found ten differences from the initial #219 manifest and eight additional deployed files. The new baseline preserves cashier void/correction, Owner desktop authority, prep/review and timeout behavior. The complete inventory has 73 paths. The immutable [live-source baseline](https://github.com/jgo031996-ship-it/takodeal-system1/tree/acee141f515f964d48dfdab97a2230e773fab05d) and [seven-file runtime diff](https://github.com/jgo031996-ship-it/takodeal-system1/compare/acee141f515f964d48dfdab97a2230e773fab05d...e3f30bc9aa2a231f828959aca524797ab2979ec9) identify the proposed runtime changes.

Staff [#238](https://github.com/jgo031996-ship-it/takodeal-system1/pull/238) incorporates #220 on the later deployed Staff line. Hold all Staff production promotions until the two backend revisions and synthetic phone checks below pass.

## Read-only Cloud Shell preflight

Use the reviewed SHA of this release PR, including its updated manifest and checker. In authenticated Cloud Shell set REVIEW_SHA to the full 40-character SHA shown in the release approval. The commands use a fresh directory. Source archives, stages and verification output stay in Cloud Shell.

```sh
(
  set -eu
  test "${#REVIEW_SHA}" -eq 40
  checkout=$(mktemp -d)
  git -C "$checkout" init --quiet
  git -C "$checkout" remote add origin https://github.com/jgo031996-ship-it/takodeal-system1.git
  git -C "$checkout" fetch --quiet --depth 1 origin "$REVIEW_SHA"
  git -C "$checkout" checkout --quiet --detach FETCH_HEAD
  cd "$checkout"
  test "$(git rev-parse HEAD)" = "$REVIEW_SHA"
  python3 tests/personal-vault-release-test.py
  python3 tools/personal-vault-release.py
  echo "Reviewed checkout: $checkout"
)
```

Require exit 0, a READY line for each function, CHECK PASSED and a STAGE directory with ready.json for exactly those two functions. Confirm its candidateSource is `e3f30bc9aa2a231f828959aca524797ab2979ec9`. Confirm ACTIVE Gen 2, nodejs22, the matching entry points and the existing function-specific service accounts. Review memory, CPU, concurrency, min/max instances, ingress, timeout, current traffic and IAM against the existing services. Keep rollback archives and the current revision names private in Cloud Shell. A new revision, missing reviewed path or unexpected file requires a fresh comparison; a partially populated directory cannot be used.

## Production steps requiring Owner approval

1. Immediately before release, repeat preflight on the same SHA. Capture both complete service configurations, IAM policies, traffic and generation-pinned source archives privately. Confirm the active revisions match the reviewed handoff or repeat the review.
2. Deploy just `cashRemittanceReview` from the corresponding staged folder. Verify the new revision is ACTIVE, receives the expected traffic and keeps the previous runtime configuration, identity, IAM and trigger. Then deploy `staffDeviceSetup` from its own staged folder and verify the same properties. Preserve the preflight archive and do not target the entire Firebase project. If either update or verification fails, stop before Staff promotion and review restoring the previously recorded revision or archive.
3. From the reviewed checkout run `python3 tools/personal-vault-release.py --verify-deployed`. This read-only mode downloads the two current fixed source generations. Require a VERIFIED line for each, the final DEPLOYED SOURCE VERIFIED line and exit 0. The staging check accepts baseline or candidate checksums, so use this stricter mode to confirm that all seven edits are actually deployed.
4. Complete the synthetic phone smoke test below using an isolated fixture and the exact #238 Staff preview on the verified services. A production test requires pre-authorized isolated identities and a payroll-excluded fixture. Obtain separate approval before creating or changing any production access. Keep Staff on its existing version until the smoke test passes.
5. Obtain separate approval for publishing the exact Staff commit `4e4c47f331a1a25c7bff48539830259ecef605f6` to the Staff project. Verify the production alias and repeat the own-account check on a clean phone session and an updated session. GitHub merges are a separate decision.

To build each proposed deploy command after approval, set STAGE to the freshly verified directory and NAME to the function in step 2. The source-local selection file excludes itself so that even reviewed dotfiles are included. Run for one service at a time.

```sh
test -f "$STAGE/ready.json"
case "$NAME" in cashRemittanceReview|staffDeviceSetup) ;; *) exit 1 ;; esac
printf '%s\n' '.vault-release-upload-ignore' '.git/' 'node_modules/' > "$STAGE/$NAME/.vault-release-upload-ignore"
gcloud functions deploy "$NAME" --gen2 --project=takodeal-pos --region=asia-southeast1 \
  --runtime=nodejs22 --entry-point="$NAME" --source="$STAGE/$NAME" --ignore-file=.vault-release-upload-ignore
gcloud functions describe "$NAME" --v2 --project=takodeal-pos --region=asia-southeast1 \
  --format='table(name,state,buildConfig.runtime,serviceConfig.revision,serviceConfig.serviceAccountEmail)'
```

## Synthetic acceptance

Use two fictional staff identities A and B with separate disposable device identities and a read-only dummy payslip. Use an emulator or isolated test project for revocation, enrollment switches, bad-slot and retry tests. No customer, real employee or production payroll entries are needed.

* On A's phone enter the Owner-issued synthetic personal code, complete activation, verify the employee and device, and open private Pay. On a new Vault enter A's daily Staff PIN and choose a separate 6–8 digit Vault PIN. Lock the app and unlock the dummy detailed payslip. Check its period, gross pay, earnings, deductions and net pay against the fixture.
* Choose Forgot PIN on that same activated phone. Use A's current 10-digit setup code and choose a new Vault PIN. The flow should complete without an HQ/manager approval. Pay must stay locked until A enters the new PIN. Confirm the former Vault PIN fails and a retry cannot duplicate the recovery audit.
* Confirm B sees only B's information. Check a disabled personal credential, a blocked phone, a foreign device and a mismatched staff ID are denied. In the test project pause new enrollment and verify A can still recover on the already activated device. Check the former private-phone approval path too.
* Record only revision identifiers, pass/fail, redacted request IDs and fixture totals. Keep all PINs and codes out of screenshots, shell history and logs. Verify paid amounts, settlement status and payroll record counts match their fixture snapshots.
