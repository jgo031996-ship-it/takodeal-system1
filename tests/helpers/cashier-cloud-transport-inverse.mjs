import {restoreCashierVoidIntegration} from './cashier-void-inverse.mjs';
import assert from 'node:assert/strict';
export const CASHIER_CLOUD_OPTIONS='  experimentalForceLongPolling: true,\n  experimentalAutoDetectLongPolling: false,\n';
export function restoreCashierCloudTransport(source){source=restoreCashierVoidIntegration(source);assert.equal(source.split(CASHIER_CLOUD_OPTIONS).length,2,'Only the reviewed primary Firestore transport options may be added.');return source.replace(CASHIER_CLOUD_OPTIONS,'');}
