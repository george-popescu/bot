const crypto = require('crypto');

const SECRET = process.env.MEXC_SECRET_KEY || 'your_secret_key';

// Test the exact same parameters as the working manual test
const params = {
  symbol: 'ILMTUSDT',
  side: 'BUY',
  type: 'LIMIT',
  quantity: '1000',
  price: '0.05',
  recvWindow: '5000',
  timestamp: Date.now()
};

console.log('🧪 Testing signature calculation...\n');

// Method 1: Our service method (current)
console.log('1. Our service method:');
const queryString1 = Object.keys(params)
  .sort()
  .map((key) => `${key}=${params[key]}`)
  .join('&');

console.log('Query string:', queryString1);

const signature1 = crypto
  .createHmac('sha256', SECRET)
  .update(queryString1)
  .digest('hex');

console.log('Signature:', signature1);
console.log('');

// Method 2: Manual test method (working)
console.log('2. Manual test method:');
const queryString2 = Object.keys(params)
  .sort()
  .map(k => `${k}=${params[k]}`)
  .join('&');

console.log('Query string:', queryString2);

const signature2 = crypto
  .createHmac('sha256', SECRET)
  .update(queryString2)
  .digest('hex');

console.log('Signature:', signature2);
console.log('');

// Compare
console.log('3. Comparison:');
console.log('Query strings match:', queryString1 === queryString2);
console.log('Signatures match:', signature1 === signature2);

if (signature1 === signature2) {
  console.log('✅ Signatures are identical!');
} else {
  console.log('❌ Signatures differ!');
  console.log('Difference might be in parameter values or secret key');
} 