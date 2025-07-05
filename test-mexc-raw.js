const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testRawResponse() {
  try {
    console.log('🔍 Testing MEXC RAW responses...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    
    // Test with BTCUSDT to see raw response
    console.log('\n📡 Getting RAW response for BTCUSDT...');
    
    // Let's try to access the makeRequest method directly or log the full response
    try {
      // First test the basic ping to ensure connection works
      console.log('🏓 Testing ping...');
      const pingResult = await mexcApiService.ping();
      console.log('✅ Ping result:', pingResult);
      
      console.log('\n📊 Testing server time...');
      const serverTime = await mexcApiService.getServerTime();
      console.log('✅ Server time:', serverTime, '(current time:', Date.now(), ')');
      
      console.log('\n🎯 Testing BTCUSDT ticker...');
      const ticker = await mexcApiService.getTicker('BTCUSDT');
      console.log('📋 Full ticker object:');
      console.log(JSON.stringify(ticker, null, 2));
      
      console.log('\n🔍 Object properties:');
      console.log('- Object.keys():', Object.keys(ticker));
      console.log('- ticker.hasOwnProperty("lastPrice"):', ticker.hasOwnProperty('lastPrice'));
      console.log('- typeof ticker:', typeof ticker);
      
    } catch (error) {
      console.error('❌ API call failed:', error.message);
      console.error('📋 Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
    }
    
    await app.close();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testRawResponse(); 