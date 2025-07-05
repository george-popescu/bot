const crypto = require('crypto');
const https = require('https');

// Test credentials (replace with actual values if needed)
const API_KEY = process.env.MEXC_API_KEY || 'your_api_key';
const SECRET_KEY = process.env.MEXC_SECRET_KEY || 'your_secret_key';
const BASE_URL = 'https://api.mexc.com';

function createSignature(params, secretKey) {
  const queryString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  
  console.log('Query string for signature:', queryString);
  
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(queryString)
    .digest('hex');
  
  return signature;
}

async function testMexcOrder() {
  console.log('🧪 Testing MEXC order placement with signature...\n');
  
  // Test order parameters (include recvWindow like official example)
  const params = {
    symbol: 'ILMTUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: '1000',
    price: '0.05',
    recvWindow: '5000',
    timestamp: Date.now()
  };
  
  // Create signature
  const signature = createSignature(params, SECRET_KEY);
  params.signature = signature;
  
  console.log('Order parameters:', params);
  console.log('Signature:', signature);
  console.log('');
  
  // Create query string for URL
  const queryString = Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  
  const url = `${BASE_URL}/api/v3/order?${queryString}`;
  
  console.log('Full URL:', url);
  console.log('');
  
  // Make request
  const options = {
    method: 'POST',
    headers: {
      'X-MEXC-APIKEY': API_KEY,
      // Don't set Content-Type - let the request library handle it
    }
  };
  
  console.log('Making request to MEXC...');
  
  const req = https.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response status:', res.statusCode);
      console.log('Response headers:', res.headers);
      console.log('Response body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ Order placement successful!');
      } else {
        console.log('❌ Order placement failed');
        try {
          const errorData = JSON.parse(data);
          console.log('Error details:', errorData);
        } catch (e) {
          console.log('Raw error:', data);
        }
      }
    });
  });
  
  req.on('error', (error) => {
    console.error('Request error:', error);
  });
  
  req.end();
}

// Only run if API keys are provided
if (API_KEY && SECRET_KEY && API_KEY !== 'your_api_key' && SECRET_KEY !== 'your_secret_key') {
  testMexcOrder();
} else {
  console.log('❌ Please set MEXC_API_KEY and MEXC_SECRET_KEY environment variables');
} 