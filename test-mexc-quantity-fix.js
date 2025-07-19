const { formatMexcQuantity, formatMexcPrice } = require('./dist/mexc/utils/mexc-formatting.utils');

console.log('🧪 Testing MEXC quantity precision fix...\n');

// Test various quantities that would fail with .toFixed(8)
const testCases = [
  { description: '10 USDT at 0.008807 price', quantity: 10 / 0.008807, expected: '1135.46' },
  { description: '50 USDT at 0.008807 price', quantity: 50 / 0.008807, expected: '5677.30' },
  { description: '100 USDT at 0.008807 price', quantity: 100 / 0.008807, expected: '11354.60' },
  { description: 'Simple 1000 ILMT', quantity: 1000, expected: '1000.00' },
  { description: 'Simple 50 ILMT', quantity: 50, expected: '50.00' },
  { description: 'Decimal 123.456789', quantity: 123.456789, expected: '123.46' },
];

console.log('📊 Quantity formatting tests:');
testCases.forEach(({ description, quantity, expected }) => {
  const formatted = formatMexcQuantity(quantity);
  const status = formatted === expected ? '✅' : '❌';
  console.log(`${status} ${description}`);
  console.log(`   Input: ${quantity}`);
  console.log(`   Expected: ${expected}`);
  console.log(`   Got: ${formatted}`);
  console.log(`   Old format (.toFixed(8)): ${quantity.toFixed(8)}`);
  console.log('');
});

// Test price formatting
console.log('💰 Price formatting tests:');
const priceTests = [
  { description: 'Current price 0.008807', price: 0.008807, expected: '0.008807' },
  { description: 'Higher price 0.012345', price: 0.012345, expected: '0.012345' },
  { description: 'Very low price 0.000001', price: 0.000001, expected: '0.000001' },
  { description: 'High precision 0.0088074567', price: 0.0088074567, expected: '0.008807' },
];

priceTests.forEach(({ description, price, expected }) => {
  const formatted = formatMexcPrice(price);
  const status = formatted === expected ? '✅' : '❌';
  console.log(`${status} ${description}`);
  console.log(`   Input: ${price}`);
  console.log(`   Expected: ${expected}`);
  console.log(`   Got: ${formatted}`);
  console.log(`   Old format (.toFixed(8)): ${price.toFixed(8)}`);
  console.log('');
});

console.log('🎯 Summary:');
console.log('- MEXC ILMTUSDT requires max 2 decimal places for quantities');
console.log('- MEXC ILMTUSDT requires max 6 decimal places for prices');
console.log('- Using .toFixed(8) was causing "quantity scale is invalid" errors');
console.log('- New formatting functions should resolve the precision issues');
console.log('');
console.log('✅ Test completed! The quantity precision fix should resolve the MEXC API error.'); 