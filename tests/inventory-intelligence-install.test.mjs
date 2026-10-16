import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installInventoryIntelligence} from '../takodeal-manager/inventory-intelligence.js';

function fixture(){
 const links=[],d={head:{append:node=>links.push(node)},createElement:tag=>({tagName:tag.toUpperCase()}),
  getElementById:id=>links.find(node=>node.id===id)||null,querySelectorAll:()=>[]};
 return {d,links};
}

test('installing the intelligence workspace actually attaches its existing stylesheet once',()=>{
 const {d,links}=fixture(),w={};
 const installed=installInventoryIntelligence(w,d);
 assert.equal(links.length,1);assert.equal(links[0].tagName,'LINK');assert.equal(links[0].rel,'stylesheet');
 assert.equal(links[0].href,'./inventory-intelligence.css');
 // The href must resolve to the shipped stylesheet that supplies the missing
 // card/grid rules, not merely a service-worker cache entry or an empty file.
 const stylesheet=readFileSync(new URL('../takodeal-manager/'+links[0].href,import.meta.url),'utf8');
 assert.match(stylesheet,/\.inventory-intelligence\s+\.inventory-workspace-kpis\s*\{[^}]*display:grid/);
 assert.equal(installInventoryIntelligence(w,d),installed);assert.equal(links.length,1);
});

test('a second workspace installer reuses the stylesheet already linked in this document',()=>{
 const {d,links}=fixture(),existing={id:'inventoryIntelligenceStyle',tagName:'LINK',rel:'stylesheet',href:'./inventory-intelligence.css'};links.push(existing);
 installInventoryIntelligence({},d);assert.equal(links.length,1);assert.equal(links[0],existing);
});
