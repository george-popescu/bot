const crypto = require('crypto');

// Test signature calculation like our service does
function calculateSignature(params, secretKey) {
  const queryString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(queryString)
    .digest('hex');
  
  return { queryString, signature };
}

// Mock secret key (similar format)
const mockSecretKey = 'test_secret_key_123';

console.log('🔍 Testing signature calculation for different methods:\n');

// Test 1: getAccount() - WORKING (no params except timestamp)
console.log('✅ getAccount() - WORKING:');
const accountParams = { timestamp: 1704700000000 };
const accountSig = calculateSignature(accountParams, mockSecretKey);
console.log('  Params:', accountParams);
console.log('  Query string:', accountSig.queryString);
console.log('  Signature:', accountSig.signature);
console.log('');

// Test 2: getMyTrades() - FAILING (has symbol, limit, timestamp)
console.log('❌ getMyTrades() - FAILING:');
const tradesParams = { symbol: 'ILMTUSDT', limit: 500, timestamp: 1704700000000 };
const tradesSig = calculateSignature(tradesParams, mockSecretKey);
console.log('  Params:', tradesParams);
console.log('  Query string:', tradesSig.queryString);
console.log('  Signature:', tradesSig.signature);
console.log('');

// Test 3: placeOrder() - FAILING (has multiple params)
console.log('❌ placeOrder() - FAILING:');
const orderParams = { 
  symbol: 'ILMTUSDT', 
  side: 'BUY', 
  type: 'LIMIT', 
  quantity: '1000', 
  price: '0.05',
  timestamp: 1704700000000,
  recvWindow: 5000
};
const orderSig = calculateSignature(orderParams, mockSecretKey);
console.log('  Params:', orderParams);
console.log('  Query string:', orderSig.queryString);
console.log('  Signature:', orderSig.signature);
console.log('');

console.log('🧪 Key observation:');
console.log('- getAccount() works with simple params');
console.log('- getMyTrades() and placeOrder() fail with complex params');
console.log('- This suggests signature calculation or parameter encoding issue'); 