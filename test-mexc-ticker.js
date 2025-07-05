const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testTicker() {
  try {
    console.log('🔍 Testing MEXC getTicker...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    console.log('📡 Testing getTicker for ILMTUSDT...');
    
    const ticker = await mexcApiService.getTicker('ILMTUSDT');
    console.log('✅ Ticker response:', {
      symbol: ticker.symbol,
      lastPrice: ticker.lastPrice,
      priceChangePercent: ticker.priceChangePercent,
      volume: ticker.volume
    });
    
    const price = parseFloat(ticker.lastPrice);
    console.log('💰 Parsed price:', price, '(is NaN?', isNaN(price), ')');
    
    if (isNaN(price)) {
      console.error('❌ Price is NaN! This will cause signature errors.');
    } else {
      console.log('✅ Price is valid, issue must be elsewhere.');
    }
    
    await app.close();
    console.log('✅ Test completed successfully');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('📋 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n')[0]
    });
  }
}

testTicker(); 