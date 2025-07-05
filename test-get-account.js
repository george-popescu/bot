const crypto = require('crypto');
const https = require('https');

// Test credentials
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

async function testGetAccount() {
  console.log('🧪 Testing MEXC GET request (getAccount) with signature...\n');
  
  // Test parameters for GET request - only timestamp for getAccount
  const params = {
    timestamp: Date.now()
  };
  
  // Create signature
  const signature = createSignature(params, SECRET_KEY);
  params.signature = signature;
  
  console.log('GET parameters:', params);
  console.log('Signature:', signature);
  console.log('');
  
  // Create query string for URL
  const queryString = Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  
  const url = `${BASE_URL}/api/v3/account?${queryString}`;
  
  console.log('Full URL:', url);
  console.log('');
  
  // Make GET request
  const options = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-MEXC-APIKEY': API_KEY,
    }
  };
  
  console.log('Making GET request to MEXC...');
  
  const req = https.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response status:', res.statusCode);
      console.log('Response headers:', JSON.stringify(res.headers, null, 2));
      console.log('Response body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ GET request successful!');
        try {
          const responseData = JSON.parse(data);
          console.log('Account data received:', responseData);
        } catch (e) {
          console.log('Raw response:', data);
        }
      } else {
        console.log('❌ GET request failed');
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
  testGetAccount();
} else {
  console.log('❌ Please set MEXC_API_KEY and MEXC_SECRET_KEY environment variables');
} 