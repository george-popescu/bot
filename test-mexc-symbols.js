const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testSymbols() {
  try {
    console.log('🔍 Testing MEXC symbols...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    
    // Test known symbol
    console.log('\n📡 Testing BTCUSDT (known symbol)...');
    try {
      const btcTicker = await mexcApiService.getTicker('BTCUSDT');
      console.log('✅ BTCUSDT ticker:', {
        symbol: btcTicker.symbol,
        lastPrice: btcTicker.lastPrice,
        priceChangePercent: btcTicker.priceChangePercent
      });
    } catch (error) {
      console.error('❌ BTCUSDT failed:', error.message);
    }
    
    // Test ILMT symbol
    console.log('\n📡 Testing ILMTUSDT...');
    try {
      const ilmtTicker = await mexcApiService.getTicker('ILMTUSDT');
      console.log('⚠️  ILMTUSDT ticker:', {
        symbol: ilmtTicker.symbol,
        lastPrice: ilmtTicker.lastPrice,
        priceChangePercent: ilmtTicker.priceChangePercent
      });
      
      if (!ilmtTicker.lastPrice) {
        console.log('❌ ILMTUSDT does not exist or is not active on MEXC!');
      }
    } catch (error) {
      console.error('❌ ILMTUSDT failed:', error.message);
    }
    
    // Try other possible ILMT variations
    const possibleSymbols = ['ILMTUSDT', 'ILMT/USDT', 'ILMTBUSD', 'ILMTBTC'];
    console.log('\n🔄 Testing possible ILMT symbol variations...');
    
    for (const symbol of possibleSymbols) {
      try {
        const ticker = await mexcApiService.getTicker(symbol);
        if (ticker.lastPrice) {
          console.log(`✅ Found working symbol: ${symbol} - Price: ${ticker.lastPrice}`);
        } else {
          console.log(`❌ ${symbol} - no price data`);
        }
      } catch (error) {
        console.log(`❌ ${symbol} - error: ${error.message}`);
      }
    }
    
    await app.close();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testSymbols(); 