const crypto = require('crypto');
const https = require('https');

const API_KEY = process.env.MEXC_API_KEY || 'your_api_key';
const SECRET = process.env.MEXC_SECRET_KEY || 'your_secret_key';
const BASE = 'https://api.mexc.com';
const ENDPOINT = '/api/v3/order';

async function placeOrder() {
  console.log('🧪 Testing MEXC order placement with OFFICIAL example format...\n');
  
  const params = {
    symbol: 'ILMTUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: '1000',
    price: '0.05',
    recvWindow: '5000',
    timestamp: Date.now()
  };

  // Construiește stringul semnăturii (exact ca în exemplul oficial)
  const qs = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');

  console.log('Query string for signature:', qs);

  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(qs)
    .digest('hex');

  console.log('Signature:', signature);

  const fullQS = `${qs}&signature=${signature}`;
  
  console.log('Full query string:', fullQS);
  console.log('');

  const url = `${BASE}${ENDPOINT}?${fullQS}`;
  
  console.log('Full URL:', url);
  console.log('');

  // Make request exactly like official example
  const options = {
    method: 'POST',
    headers: {
      'X-MEXC-APIKEY': API_KEY
      // No Content-Type header
    }
  };

  console.log('Making POST request with headers:', options.headers);
  console.log('');

  const req = https.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response status:', res.statusCode);
      console.log('Response body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ Order placement successful!');
        try {
          const responseData = JSON.parse(data);
          console.log('Order details:', responseData);
        } catch (e) {
          console.log('Raw response:', data);
        }
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
if (API_KEY && SECRET && API_KEY !== 'your_api_key' && SECRET !== 'your_secret_key') {
  placeOrder().catch(console.error);
} else {
  console.log('❌ Please set MEXC_API_KEY and MEXC_SECRET_KEY environment variables');
} 