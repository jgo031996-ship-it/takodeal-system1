import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../takodeal-manager/operations-model.js',import.meta.url));
for(const folder of ['Takodeal-POS','Customer','takodeal-franchise'])await writeFile(new URL('../'+folder+'/operations-model.js',import.meta.url),source);
console.log('Synchronized operations calculations for all four apps.');
