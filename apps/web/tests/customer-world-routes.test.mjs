import assert from 'node:assert/strict';
import test from 'node:test';

async function navigation() {
  const customerWorld = await import('../src/lib/customer-world.mjs');
  assert.equal(typeof customerWorld.customerWorldViewHref, 'function');
  return customerWorld;
}

function world(journey, customerQuery = 'Bethesda') {
  return {
    request: {
      journey,
      market_id: 'US-MD',
      customer_query: customerQuery,
    },
  };
}

test('exports customer world view href as executable navigation behavior', async () => {
  const customerWorld = await navigation();
  assert.equal(typeof customerWorld.customerWorldViewHref, 'function');
});

for (const [journey, pathname] of [
  ['HOME', '/'],
  ['SEARCH', '/search'],
  ['DELIVERY', '/delivery'],
  ['DISPENSARIES', '/dispensaries'],
]) {
  test(`${journey} retains its distinct customer journey path and filters`, async () => {
    const { customerWorldViewHref } = await navigation();
    const href = customerWorldViewHref(world(journey), 'map');
    const url = new URL(href, 'https://customer.example');
    assert.equal(url.pathname, pathname);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      market: 'US-MD',
      view: 'map',
      query: 'Bethesda',
    });
  });
}

test('customer world view href omits an empty query', async () => {
  const { customerWorldViewHref } = await navigation();
  const url = new URL(customerWorldViewHref(world('DELIVERY', ''), 'list'), 'https://customer.example');
  assert.equal(url.pathname, '/delivery');
  assert.deepEqual(Object.fromEntries(url.searchParams), { market: 'US-MD', view: 'list' });
});

test('customer world view href encodes reserved query characters without changing intent', async () => {
  const { customerWorldViewHref } = await navigation();
  const customerQuery = 'Bethesda & Silver Spring / ?';
  const url = new URL(
    customerWorldViewHref(world('DISPENSARIES', customerQuery), 'map'),
    'https://customer.example',
  );
  assert.equal(url.pathname, '/dispensaries');
  assert.equal(url.searchParams.get('query'), customerQuery);
  assert.equal(url.searchParams.get('market'), 'US-MD');
  assert.equal(url.searchParams.get('view'), 'map');
});
