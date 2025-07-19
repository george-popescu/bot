const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// MEXC API credentials
const MEXC_API_KEY = process.env.MEXC_API_KEY;
const MEXC_SECRET_KEY = process.env.MEXC_SECRET_KEY;
const MEXC_BASE_URL = 'https://api.mexc.com/api/v3';

console.log('API Key length:', MEXC_API_KEY?.length);
console.log('Secret Key length:', MEXC_SECRET_KEY?.length);

if (!MEXC_API_KEY || !MEXC_SECRET_KEY) {
  console.error('❌ MEXC API credentials not found in environment variables');
  process.exit(1);
}

// Sign request function
function signRequest(params, secretKey) {
  const queryString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  return crypto
    .createHmac('sha256', secretKey)
    .update(queryString)
    .digest('hex');
}

// Get open orders
async function getOpenOrders() {
  try {
    console.log('🔄 Fetching open orders from MEXC...');
    
    const params = {
      symbol: 'ILMTUSDT',
      timestamp: Date.now(),
    };
    
    const signature = signRequest(params, MEXC_SECRET_KEY);
    params.signature = signature;
    
    const response = await axios.get(`${MEXC_BASE_URL}/openOrders`, {
      params,
      headers: {
        'X-MEXC-APIKEY': MEXC_API_KEY,
      },
    });
    
    console.log(`✅ Found ${response.data.length} open orders:`);
    response.data.forEach((order, index) => {
      console.log(`${index + 1}. Order ID: ${order.orderId} | Side: ${order.side} | Price: ${order.price} | Qty: ${order.origQty} | Status: ${order.status}`);
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching open orders:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    return [];
  }
}

// Cancel specific order
async function cancelOrder(orderId) {
  try {
    console.log(`🔄 Attempting to cancel order: ${orderId}`);
    
    // Use the full order ID as-is (MEXC expects the full ID including prefix)
    const params = {
      symbol: 'ILMTUSDT',
      orderId: orderId, // Use the full order ID as returned by getOpenOrders
      timestamp: Date.now(),
    };
    
    console.log(`📋 Cancel request params:`, params);
    
    const signature = signRequest(params, MEXC_SECRET_KEY);
    const queryString = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&') + `&signature=${signature}`;
    
    const url = `${MEXC_BASE_URL}/order?${queryString}`;
    
    const response = await new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.request(url, {
        method: 'DELETE',
        headers: {
          'X-MEXC-APIKEY': MEXC_API_KEY,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ data: json });
            } else {
              reject({ response: { data: json, status: res.statusCode, statusText: res.statusMessage } });
            }
          } catch (e) {
            reject({ message: `HTTP ${res.statusCode}: ${data}` });
          }
        });
      });
      req.on('error', (error) => reject({ message: error.message }));
      req.end();
    });
    
    console.log(`✅ Order ${orderId} cancelled successfully:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Error cancelling order ${orderId}:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });
    return null;
  }
}

// Place a test order
async function placeTestOrder(side = 'BUY', price = '0.008', quantity = '200') {
  try {
    console.log(`🔄 Placing test ${side} order: ${quantity} ILMT at $${price}`);
    
    const params = {
      symbol: 'ILMTUSDT',
      side: side,
      type: 'LIMIT',
      timeInForce: 'GTC',
      quantity: quantity,
      price: price,
      timestamp: Date.now(),
    };
    
    const signature = signRequest(params, MEXC_SECRET_KEY);
    params.signature = signature;
    
    const response = await axios.post(`${MEXC_BASE_URL}/order`, null, {
      params,
      headers: {
        'X-MEXC-APIKEY': MEXC_API_KEY,
      },
    });
    
    console.log(`✅ Test order placed successfully:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Error placing test order:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    return null;
  }
}

// Main test function
async function testMexcOrders() {
  console.log('🚀 Starting MEXC Orders Test...\n');
  
  // 1. Check current open orders
  console.log('1. Checking current open orders...');
  const openOrders = await getOpenOrders();
  console.log('');
  
  // 2. If we have orders, test cancelling one
  if (openOrders.length > 0) {
    console.log('2. Testing cancel functionality on first order...');
    const firstOrder = openOrders[0];
    await cancelOrder(firstOrder.orderId);
    console.log('');
    
    // Check orders again after cancel
    console.log('3. Checking orders after cancel...');
    await getOpenOrders();
    console.log('');
  } else {
    console.log('2. No orders found, placing a test order...');
    const testOrder = await placeTestOrder('BUY', '0.008', '200');
    
    if (testOrder) {
      console.log('');
      console.log('3. Testing cancel on the test order...');
      await cancelOrder(testOrder.orderId);
      console.log('');
    }
  }
  
  console.log('🎉 Test completed!');
}

// Run the test
testMexcOrders().catch(console.error); 