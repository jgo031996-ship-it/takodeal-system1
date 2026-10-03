import { copyFileSync } from 'node:fs';
// Each app can be deployed as an independent Vercel root. Keep its local import
// available while maintaining one canonical implementation and equality test.
copyFileSync(new URL('../Takodeal-POS/pos-safety.js', import.meta.url), new URL('../takodeal-manager/pos-safety.js', import.meta.url));
