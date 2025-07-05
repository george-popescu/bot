const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testILMTBookTicker() {
  try {
    console.log('🔍 Testing ILMTUSDT getBookTicker for market making...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    
    // Test ILMTUSDT first
    console.log('\n📊 Testing ILMTUSDT with getBookTicker...');
    try {
      const ilmtBookTicker = await mexcApiService.getBookTicker('ILMTUSDT');
      console.log('✅ ILMTUSDT BookTicker:', {
        bidPrice: ilmtBookTicker.bidPrice,
        askPrice: ilmtBookTicker.askPrice,
        bidQty: ilmtBookTicker.bidQty,
        askQty: ilmtBookTicker.askQty,
      });
      
      const bidPrice = parseFloat(ilmtBookTicker.bidPrice);
      const askPrice = parseFloat(ilmtBookTicker.askPrice);
      const midPrice = (bidPrice + askPrice) / 2;
      
      console.log('💰 ILMTUSDT Calculated prices:', {
        bidPrice,
        askPrice,
        midPrice,
        isValid: !isNaN(midPrice) && midPrice > 0,
      });
      
      if (!isNaN(midPrice) && midPrice > 0) {
        console.log('✅ ILMTUSDT prices are valid for market making!');
      } else {
        console.log('❌ ILMTUSDT prices are invalid');
      }
      
    } catch (error) {
      console.log('❌ ILMTUSDT BookTicker failed:', error.message);
    }
    
    // Compare with BTCUSDT
    console.log('\n📊 Comparing with BTCUSDT...');
    try {
      const btcBookTicker = await mexcApiService.getBookTicker('BTCUSDT');
      console.log('✅ BTCUSDT BookTicker:', {
        bidPrice: btcBookTicker.bidPrice,
        askPrice: btcBookTicker.askPrice,
      });
      
    } catch (error) {
      console.log('❌ BTCUSDT BookTicker failed:', error.message);
    }
    
    await app.close();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testILMTBookTicker(); 