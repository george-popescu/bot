const crypto = require('crypto');

// Our current implementation
function createSignature(params, secretKey) {
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

// Test with real MEXC API requirements
function testMexcSignature() {
  const mockSecretKey = 'test_secret_key';
  const timestamp = Date.now();
  
  console.log('🔍 Testing MEXC signature formats:\n');
  
  // Test 1: Simple case like getAccount()
  const accountParams = { timestamp };
  const accountSig = createSignature(accountParams, mockSecretKey);
  console.log('✅ getAccount() format:');
  console.log('  Query string:', accountSig.queryString);
  console.log('  Signature:', accountSig.signature);
  console.log('');
  
  // Test 2: Complex POST request like placeOrder()
  const orderParams = {
    symbol: 'ILMTUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: '1000',
    price: '0.05',
    timeInForce: 'GTC',
    timestamp,
    recvWindow: 5000
  };
  
  const orderSig = createSignature(orderParams, mockSecretKey);
  console.log('❌ placeOrder() format:');
  console.log('  Query string:', orderSig.queryString);
  console.log('  Signature:', orderSig.signature);
  console.log('');
  
  // Test 3: Check if special characters need different encoding
  const specialParams = {
    symbol: 'ILMT_USDT', // Check underscore
    side: 'BUY',
    type: 'LIMIT',
    quantity: '1000.50', // Check decimal
    price: '0.05000000', // Check trailing zeros
    timestamp
  };
  
  const specialSig = createSignature(specialParams, mockSecretKey);
  console.log('🧪 Special characters test:');
  console.log('  Query string:', specialSig.queryString);
  console.log('  Signature:', specialSig.signature);
  console.log('');
  
  console.log('💡 Key observations:');
  console.log('1. MEXC might expect different parameter ordering');
  console.log('2. URL encoding might be handled differently');
  console.log('3. POST vs GET signature calculation might differ');
  console.log('4. recvWindow parameter might be causing issues');
  console.log('');
  
  // Test 4: Different encoding approaches
  console.log('🔄 Testing different encoding approaches:');
  
  // Without URL encoding
  const noEncodeQuery = Object.keys(orderParams)
    .sort()
    .map((key) => `${key}=${orderParams[key]}`)
    .join('&');
  
  const noEncodeSig = crypto
    .createHmac('sha256', mockSecretKey)
    .update(noEncodeQuery)
    .digest('hex');
  
  console.log('  Without URL encoding:', noEncodeQuery);
  console.log('  Signature:', noEncodeSig);
  
  // With minimal params (remove recvWindow)
  const minimalParams = {
    symbol: 'ILMTUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: '1000',
    price: '0.05',
    timestamp
  };
  
  const minimalSig = createSignature(minimalParams, mockSecretKey);
  console.log('  Minimal params:', minimalSig.queryString);
  console.log('  Signature:', minimalSig.signature);
}

testMexcSignature(); 