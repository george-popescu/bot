const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testMarketMakingPrices() {
  try {
    console.log('🔍 Testing Market Making price logic with bookTicker...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    
    // Test the new market making price logic
    console.log('\n📊 Testing BTCUSDT with bookTicker (like arbitrage bot)...');
    
    const bookTicker = await mexcApiService.getBookTicker('BTCUSDT');
    console.log('✅ BookTicker response:', {
      bidPrice: bookTicker.bidPrice,
      askPrice: bookTicker.askPrice,
      bidQty: bookTicker.bidQty,
      askQty: bookTicker.askQty,
    });
    
    // Calculate prices like market making bot now does
    const mexcBidPrice = parseFloat(bookTicker.bidPrice);
    const mexcAskPrice = parseFloat(bookTicker.askPrice);
    const mexcMidPrice = (mexcBidPrice + mexcAskPrice) / 2;
    
    console.log('💰 Calculated prices:', {
      bidPrice: mexcBidPrice,
      askPrice: mexcAskPrice,
      midPrice: mexcMidPrice,
      spread: ((mexcAskPrice - mexcBidPrice) / mexcBidPrice * 100).toFixed(4) + '%',
    });
    
    // Test for NaN values
    if (isNaN(mexcMidPrice) || isNaN(mexcBidPrice) || isNaN(mexcAskPrice)) {
      console.error('❌ CRITICAL: Some prices are NaN!', {
        midPrice: mexcMidPrice,
        bidPrice: mexcBidPrice,
        askPrice: mexcAskPrice,
      });
    } else {
      console.log('✅ All prices are valid numbers - ready for market making!');
      
      // Simulate market making calculations
      const mmConfig = {
        spread: 0.1, // 0.1%
        priceOffset: 0.05, // 0.05%
        orderSize: 10,
      };
      
      const priceOffset = mmConfig.priceOffset / 100;
      const spread = mmConfig.spread / 100;
      
      const buyPrice = mexcMidPrice * (1 - spread / 2 - priceOffset);
      const sellPrice = mexcMidPrice * (1 + spread / 2 + priceOffset);
      
      console.log('🎯 Market making orders would be:');
      console.log(`  BUY:  ${buyPrice.toFixed(6)} (${mmConfig.orderSize} BTC)`);
      console.log(`  SELL: ${sellPrice.toFixed(6)} (${mmConfig.orderSize} BTC)`);
      console.log(`  Spread: ${((sellPrice - buyPrice) / buyPrice * 100).toFixed(4)}%`);
    }
    
    await app.close();
    console.log('\n✅ Test completed successfully');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('📋 Error details:', error.stack);
  }
}

testMarketMakingPrices(); 