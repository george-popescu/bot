const { Spot } = require('mexc-api-sdk');

const API_KEY = process.env.MEXC_API_KEY || 'your_api_key';
const SECRET = process.env.MEXC_SECRET_KEY || 'your_secret_key';

async function testMexcSdk() {
  console.log('🧪 Testing MEXC SDK...\n');
  
  // Initialize SDK client
  const client = new Spot({
    apiKey: API_KEY,
    apiSecret: SECRET,
    baseURL: 'https://api.mexc.com'
  });

  try {
    // Test 1: Ping
    console.log('1. Testing ping...');
    await client.ping();
    console.log('✅ Ping successful');

    // Test 2: Server Time
    console.log('2. Testing server time...');
    const timeResponse = await client.time();
    console.log('✅ Server time:', new Date(timeResponse.serverTime));

    // Test 3: Book Ticker (check different syntax)
    console.log('3. Testing book ticker...');
    try {
      // Try different methods based on SDK documentation
      const bookTicker1 = await client.bookTicker('ILMTUSDT');
      console.log('✅ Book ticker (method 1):', bookTicker1);
    } catch (e1) {
      console.log('Method 1 failed:', e1.message);
      try {
        const bookTicker2 = await client.bookTicker({ symbol: 'ILMTUSDT' });
        console.log('✅ Book ticker (method 2):', bookTicker2);
      } catch (e2) {
        console.log('Method 2 failed:', e2.message);
        try {
          const bookTicker3 = await client.ticker24hr('ILMTUSDT');
          console.log('✅ 24hr ticker instead:', bookTicker3);
        } catch (e3) {
          console.log('All ticker methods failed');
        }
      }
    }

    // Test 4: Account (requires auth)
    console.log('4. Testing account...');
    const account = await client.account();
    console.log('✅ Account info:', {
      canTrade: account.canTrade,
      balanceCount: account.balances.length
    });

    // Test 5: Place a small order (BE CAREFUL!)
    console.log('5. Testing order placement...');
    const orderParams = {
      symbol: 'ILMTUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: '200',  // 200 ILMT
      price: '0.008',   // Low price to avoid execution
      timeInForce: 'GTC',
      recvWindow: 5000
    };

    console.log('Order params:', orderParams);
    const orderResponse = await client.newOrder(orderParams);
    console.log('✅ Order placed successfully:', orderResponse);

    // Test 6: Cancel the order immediately
    console.log('6. Cancelling order...');
    const cancelResponse = await client.cancelOrder({
      symbol: 'ILMTUSDT',
      orderId: orderResponse.orderId
    });
    console.log('✅ Order cancelled:', cancelResponse);

    console.log('\n🎉 All SDK tests passed!');

  } catch (error) {
    console.error('❌ SDK test failed:', error.message);
    if (error.response?.data) {
      console.error('Error details:', error.response.data);
    }
  }
}

// Only run if API keys are provided
if (API_KEY && SECRET && API_KEY !== 'your_api_key' && SECRET !== 'your_secret_key') {
  testMexcSdk().catch(console.error);
} else {
  console.log('❌ Please set MEXC_API_KEY and MEXC_SECRET_KEY environment variables');
} 