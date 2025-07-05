const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testMexcSignature() {
  try {
    console.log('🔍 Testing MEXC API signature functionality...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    
    // Test public endpoints first (no signature required)
    console.log('\n📡 Testing public endpoints...');
    try {
      const ping = await mexcApiService.ping();
      console.log('✅ Ping:', ping);
      
      const serverTime = await mexcApiService.getServerTime();
      console.log('✅ Server time:', serverTime, '(diff from local:', Date.now() - serverTime, 'ms)');
      
    } catch (error) {
      console.log('❌ Public endpoints failed:', error.message);
    }
    
    // Test signed endpoints (signature required)
    console.log('\n🔐 Testing signed endpoints...');
    try {
      console.log('📊 Testing getAccount (requires signature)...');
      const account = await mexcApiService.getAccount();
      console.log('✅ Account fetched successfully!');
      console.log('  Can trade:', account.canTrade);
      console.log('  Balances:', account.balances.length, 'assets');
      console.log('  First few balances:');
      account.balances.slice(0, 3).forEach(balance => {
        console.log(`    ${balance.asset}: ${balance.free} (free), ${balance.locked} (locked)`);
      });
      
    } catch (error) {
      console.log('❌ getAccount failed:', error.message);
      console.log('   This means signature is not working correctly');
    }
    
    // If getAccount works, try a simple order query
    console.log('\n📋 Testing order query (requires signature)...');
    try {
      console.log('🔍 Testing getMyTrades for ILMTUSDT...');
      const trades = await mexcApiService.getMyTrades('ILMTUSDT', 5);
      console.log('✅ Trades fetched successfully!');
      console.log('  Number of trades:', trades.length);
      
    } catch (error) {
      console.log('❌ getMyTrades failed:', error.message);
    }
    
    await app.close();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testMexcSignature(); 