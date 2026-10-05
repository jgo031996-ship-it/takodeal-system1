import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCartDensity, installCartLayout} from '../Takodeal-POS/cart-layout.js';

test('order spacing shrinks only as far as needed to fit the available height', () => {
  assert.equal(chooseCartDensity(320, [250, 210, 180]), 'comfortable');
  assert.equal(chooseCartDensity(220, [250, 210, 180]), 'compact');
  assert.equal(chooseCartDensity(190, [250, 210, 180]), 'dense');
  assert.equal(chooseCartDensity(100, [250, 210, 180]), 'dense');
  assert.equal(chooseCartDensity(0, [250, 210, 180]), 'comfortable');
});

test('density follows real rendered row sizes and restores comfortable spacing after items are removed', () => {
  let frame, resized, rowCount = 7;
  const observers = [];
  class Observer { constructor(callback) {this.callback = callback; observers.push(this);} observe() {} }
  const list = {
    dataset:{}, children:[], clientHeight:320,
    get scrollHeight() {return rowCount * ({comfortable:70, compact:53, dense:44}[this.dataset.cartDensity] || 70);},
    closest:() => null,
  };
  const doc = {getElementById:id => id === 'cartList' ? list : null};
  const win = {requestAnimationFrame:callback => {frame = callback;}, MutationObserver:Observer, ResizeObserver:Observer, addEventListener:(_name, callback) => {resized = callback;}};
  installCartLayout(doc, win);
  frame();
  assert.equal(list.dataset.cartDensity, 'dense');
  assert.equal(list.dataset.cartOverflow, 'false');
  rowCount = 10;
  observers[0].callback(); frame();
  assert.equal(list.dataset.cartDensity, 'dense');
  assert.equal(list.dataset.cartOverflow, 'true');
  rowCount = 2;
  resized(); frame();
  assert.equal(list.dataset.cartDensity, 'comfortable');
  assert.equal(list.dataset.cartOverflow, 'false');
  const observerCount = observers.length;
  installCartLayout(doc, win);
  assert.equal(observers.length, observerCount);
});

test('compact rows retain all amounts, add-ons and notes and preserve edit and remove controls', () => {
  let frame, keydown, edits = 0;
  const remove = {attributes:{}, setAttribute(name, value) {this.attributes[name] = value;}};
  const row = {
    attributes:{}, dataset:{}, classList:{add() {}},
    children:[
      {textContent:'Octopus Take-Out + 2 cheese No mayo', firstElementChild:{textContent:'Octopus Take-Out'}},
      {textContent:'₱185.00'}, {textContent:'x2'}, {textContent:'₱390.00'}, {querySelector:() => remove},
    ],
    setAttribute(name, value) {this.attributes[name] = value;},
    addEventListener(_name, callback) {keydown = callback;},
    click() {edits++;},
  };
  const before = row.children.map(child => child.textContent);
  const list = {dataset:{}, children:[row], clientHeight:100, scrollHeight:160, closest:() => null};
  class Observer {observe() {}}
  const win = {requestAnimationFrame:callback => {frame = callback;}, MutationObserver:Observer, addEventListener() {}};
  installCartLayout({getElementById:id => id === 'cartList' ? list : null}, win);frame();
  assert.equal(list.dataset.cartDensity, 'dense');
  assert.deepEqual(row.children.map(child => child.textContent), before);
  assert.match(row.attributes['aria-label'], /2 cheese No mayo/);
  assert.equal(remove.attributes['aria-label'], 'Remove Octopus Take-Out');
  keydown({target:row, key:'Enter', preventDefault() {}});
  assert.equal(edits, 1);
  keydown({target:remove, key:'Enter', preventDefault() {throw Error('Remove must keep its own handler.');}});
  assert.equal(edits, 1);
});

test('type and customizations share the metadata space without losing their text on repeated fits', () => {
  let frame, fitAgain, badgeMoved = false, detailsMoved = false;
  const badge = {textContent:'Take-Out'};
  const details = {textContent:'+ 2 cheese Less ice', classList:{add() {}}};
  const description = {
    get textContent() {return 'Octopus' + (badgeMoved ? '' : ' Take-Out') + (detailsMoved ? '' : ' + 2 cheese Less ice');},
    firstElementChild:{textContent:'Octopus'},
    querySelector:selector => selector.includes('span > span') ? (badgeMoved ? null : badge) : (detailsMoved ? null : details),
  };
  const metadata = {textContent:'₱185.00', classList:{add() {}}, nodes:[], append(node) {this.nodes.push(node);if(node === badge) badgeMoved = true;if(node === details) detailsMoved = true;}};
  const row = {dataset:{}, classList:{add() {}}, children:[description,metadata,{textContent:'x2'},{textContent:'₱390.00'},{querySelector:() => null}], attributes:{},setAttribute(name,value) {this.attributes[name] = value;}, addEventListener() {}};
  const list = {dataset:{}, children:[row], clientHeight:100, scrollHeight:40, closest:() => null};
  class Observer {constructor(callback) {fitAgain = callback;} observe() {}}
  installCartLayout({getElementById:id => id === 'cartList' ? list : null}, {requestAnimationFrame:callback => {frame = callback;}, MutationObserver:Observer, addEventListener() {}});
  frame();
  assert.equal(description.textContent, 'Octopus');
  assert.deepEqual(metadata.nodes.map(node => node.textContent), ['Take-Out','+ 2 cheese Less ice']);
  assert.equal(metadata.textContent, '₱185.00');
  assert.match(row.attributes['aria-label'], /Take-Out.*2 cheese Less ice/);
  fitAgain();frame();
  assert.equal(metadata.nodes.length, 2);
  assert.match(row.attributes['aria-label'], /Take-Out.*2 cheese Less ice/);
  assert.equal(row.children[2].textContent, 'x2');
  assert.equal(row.children[3].textContent, '₱390.00');
});
