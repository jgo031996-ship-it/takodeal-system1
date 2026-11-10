// Owner advances to the reviewed 5928116 document protocol; this branch does not publish Staff.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const documentReleasePins={
  "owner": {
    "document-metadata-client.js": "50792a6b71069a8073984b07ae3064cda6707a8304b7a6b37f49b93dbcdf305b",
    "staff-document-broker.js": "97912c77fe5b99d516dea75acd6f89f56ee776bd64ffc98e334be63b35369ca9",
    "staff-document-hq.js": "b24af4afea723e2b800c5f487c149528714c81bffc154243cce49b7f6f192ec1",
    "staff-document-model.js": "36a93814df7b71843264cb5fa2e8bf37dfd6b8e599d9f85e9eae8af9c9d6c2a4",
    "staff-document-store.js": "b491fccdb5969edff8298dfbeb1d6d31497e8768f20dba686a7491c70fc4074e",
    "staff-documents.js": "cb691cfea041de244a36fff1b282fa0d2d3f40f0f673428e3a11cd89bf9dee09"
  },
  "staff": {
    "document-metadata-client.js": "59ecb8c1d0c990b76b0afe6e20595ef6cfcd70ad268937f774b2d12b94ca0b7d",
    "staff-document-broker.js": "27b858f830bf69b8e6b739b91f8bf476259fdba4a169dfb7af42e0ba39f97e9e",
    "staff-document-model.js": "96f03e0eaa725187ae5cfbd535187aa8ca8c7b23034c40f068d1bc0c4c58ac62",
    "staff-document-store.js": "348bc6edec3b73f63a47004bbff1f9236cb675eba9a7290214b416f5f72a1c27",
    "staff-documents.js": "33d22a80dae70e15fc14670cea7e551ab1c8b1921556b9bc0f2c69dad19e9f42"
  }
};
export function assertDocumentReleaseCopies(names){for(const name of names)for(const [cohort,app]of [['owner','takodeal-manager'],['staff','takodeal-staff']]){const expected=documentReleasePins[cohort][name];assert.ok(expected,name+' reviewed '+cohort+' pin');assert.equal(createHash('sha256').update(readFileSync(new URL('../../'+app+'/'+name,import.meta.url))).digest('hex'),expected,app+'/'+name+' remains on its reviewed release');}}
