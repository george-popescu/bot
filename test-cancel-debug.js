const axios = require('axios');
const crypto = require('crypto');

// Configuration
const MEXC_API_KEY = process.env.MEXC_API_KEY || 'your_api_key';
const MEXC_SECRET_KEY = process.env.MEXC_SECRET_KEY || 'your_secret_key';
const MEXC_BASE_URL = 'https://api.mexc.com';

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
    console.log('🔍 Fetching open orders...');
    
    const params = {
      symbol: 'ILMTUSDT',
      timestamp: Date.now(),
    };
    
    const signature = signRequest(params, MEXC_SECRET_KEY);
    params.signature = signature;
    
    const response = await axios.get(`${MEXC_BASE_URL}/api/v3/openOrders`, {
      params,
      headers: {
        'X-MEXC-APIKEY': MEXC_API_KEY,
      },
    });
    
    console.log(`📋 Found ${response.data.length} open orders:`);
    response.data.forEach((order, index) => {
      console.log(`${index + 1}. Order ID: ${order.orderId} | Side: ${order.side} | Price: ${order.price} | Qty: ${order.origQty}`);
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
    
    const params = {
      symbol: 'ILMTUSDT',
      orderId: orderId,
      timestamp: Date.now(),
    };
    
    const signature = signRequest(params, MEXC_SECRET_KEY);
    params.signature = signature;
    
    const response = await axios.delete(`${MEXC_BASE_URL}/api/v3/order`, {
      params,
      headers: {
        'X-MEXC-APIKEY': MEXC_API_KEY,
      },
    });
    
    console.log(`✅ Order ${orderId} cancelled successfully:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Error cancelling order ${orderId}:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
      errorCode: error.code,
      errorType: typeof error,
      errorConstructor: error?.constructor?.name,
      errorKeys: error ? Object.keys(error) : [],
      errorString: String(error),
      errorJSON: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    });
    return null;
  }
}

// Test cancel functionality
async function testCancelFunctionality() {
  console.log('🚀 Starting cancel order debug test...');
  
  // Get current open orders
  const openOrders = await getOpenOrders();
  
  if (openOrders.length === 0) {
    console.log('⚠️ No open orders found to test cancel functionality');
    return;
  }
  
  // Test cancelling the first order
  const firstOrder = openOrders[0];
  console.log(`\n🎯 Testing cancel on first order: ${firstOrder.orderId}`);
  
  const cancelResult = await cancelOrder(firstOrder.orderId);
  
  if (cancelResult) {
    console.log('✅ Cancel test successful');
  } else {
    console.log('❌ Cancel test failed');
  }
  
  // Wait a bit and check orders again
  console.log('\n⏱️ Waiting 2 seconds before checking orders again...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const remainingOrders = await getOpenOrders();
  console.log(`\n📊 Orders remaining after cancel: ${remainingOrders.length}`);
}

// Run the test
if (require.main === module) {
  testCancelFunctionality().catch(console.error);
}

module.exports = { getOpenOrders, cancelOrder, testCancelFunctionality }; 