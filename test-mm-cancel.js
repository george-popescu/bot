require('dotenv').config();
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');
const { LoggingService } = require('./dist/logging/logging.service');
const { ConfigService } = require('./dist/config/config.service');
const { MexcNativeHttpService } = require('./dist/mexc/services/mexc-native-http.service');

async function testMmCancelFunctionality() {
  console.log('🚀 Testing MM Bot Cancel Functionality...\n');

  try {
    // Initialize services
    const configService = new ConfigService();
    const loggingService = new LoggingService();
    const mexcNativeHttpService = new MexcNativeHttpService();
    
    // Mock HttpService for MexcApiService
    const mockHttpService = {
      axiosRef: {
        interceptors: {
          request: { use: () => 1, eject: () => {} }
        }
      }
    };
    
    const mexcApiService = new MexcApiService(
      mockHttpService,
      configService,
      loggingService,
      mexcNativeHttpService
    );

    // 1. Get current open orders
    console.log('1. Fetching current open orders...');
    const openOrders = await mexcApiService.getOpenOrders('ILMTUSDT');
    console.log(`✅ Found ${openOrders.length} open orders`);

    if (openOrders.length === 0) {
      console.log('⚠️ No orders found to test cancel functionality');
      return;
    }

    // 2. Test canceling the first order
    const testOrder = openOrders[0];
    console.log(`\n2. Testing cancel on order: ${testOrder.orderId}`);
    console.log(`   Side: ${testOrder.side} | Price: ${testOrder.price} | Qty: ${testOrder.origQty}`);

    try {
      const cancelResult = await mexcApiService.cancelOrder('ILMTUSDT', testOrder.orderId);
      console.log('✅ Order cancelled successfully:', {
        orderId: cancelResult.orderId,
        symbol: cancelResult.symbol,
        side: cancelResult.side,
        status: cancelResult.status
      });
    } catch (error) {
      console.error('❌ Cancel failed:', error.message);
      if (error.context) {
        console.error('   Error context:', error.context);
      }
    }

    // 3. Verify the order was cancelled
    console.log('\n3. Verifying order was cancelled...');
    const remainingOrders = await mexcApiService.getOpenOrders('ILMTUSDT');
    console.log(`✅ Remaining orders: ${remainingOrders.length}`);
    
    const orderStillExists = remainingOrders.some(o => o.orderId === testOrder.orderId);
    if (orderStillExists) {
      console.log('❌ Order still exists in open orders');
    } else {
      console.log('✅ Order successfully removed from open orders');
    }

    console.log('\n🎉 MM Bot cancel functionality test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testMmCancelFunctionality();
