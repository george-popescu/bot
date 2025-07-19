const { NestFactory } = require('@nestjs/core');
const { MexcModule } = require('./dist/mexc/mexc.module');

async function debugMexcQuantityPrecision() {
  try {
    console.log('🔍 Debugging MEXC quantity precision for ILMTUSDT...\n');
    
    const app = await NestFactory.create(MexcModule);
    const mexcApiService = app.get('MexcApiService');
    
    console.log('✅ App created successfully\n');
    
    // 1. Get exchange info to check symbol specifications
    try {
      console.log('📊 Fetching exchange info...');
      
      // Try to get exchange info (this might not be available in all MEXC APIs)
      const exchangeInfo = await mexcApiService.makeRequest('GET', '/exchangeInfo');
      
      if (exchangeInfo && exchangeInfo.symbols) {
        const ilmtSymbol = exchangeInfo.symbols.find(s => s.symbol === 'ILMTUSDT');
        
        if (ilmtSymbol) {
          console.log('🎯 ILMTUSDT symbol info found:');
          console.log(JSON.stringify(ilmtSymbol, null, 2));
          
          // Look for quantity precision in filters
          const lotSizeFilter = ilmtSymbol.filters?.find(f => f.filterType === 'LOT_SIZE');
          if (lotSizeFilter) {
            console.log('\n📏 LOT_SIZE filter:');
            console.log(`  Min Quantity: ${lotSizeFilter.minQty}`);
            console.log(`  Max Quantity: ${lotSizeFilter.maxQty}`);
            console.log(`  Step Size: ${lotSizeFilter.stepSize}`);
          }
          
          const priceFilter = ilmtSymbol.filters?.find(f => f.filterType === 'PRICE_FILTER');
          if (priceFilter) {
            console.log('\n💰 PRICE_FILTER:');
            console.log(`  Min Price: ${priceFilter.minPrice}`);
            console.log(`  Max Price: ${priceFilter.maxPrice}`);
            console.log(`  Tick Size: ${priceFilter.tickSize}`);
          }
          
          const minNotionalFilter = ilmtSymbol.filters?.find(f => f.filterType === 'MIN_NOTIONAL');
          if (minNotionalFilter) {
            console.log('\n📊 MIN_NOTIONAL filter:');
            console.log(`  Min Notional: ${minNotionalFilter.minNotional}`);
          }
          
        } else {
          console.log('❌ ILMTUSDT symbol not found in exchange info');
        }
      } else {
        console.log('❌ No exchange info available or no symbols array');
      }
      
    } catch (error) {
      console.log(`❌ Exchange info not available: ${error.message}`);
    }
    
    // 2. Get current ticker to see current price and format
    console.log('\n📈 Getting current ticker...');
    try {
      const ticker = await mexcApiService.getTicker('ILMTUSDT');
      console.log('Current ticker:');
      console.log(`  Price: ${ticker.price || ticker.lastPrice}`);
      console.log(`  Volume: ${ticker.volume}`);
      console.log(`  Bid: ${ticker.bidPrice}`);
      console.log(`  Ask: ${ticker.askPrice}`);
      
      // Calculate some test quantities
      const currentPrice = parseFloat(ticker.price || ticker.lastPrice || '0.01');
      console.log(`\n🧮 Test quantity calculations (current price: ${currentPrice}):`);
      
      // Test different USDT amounts
      const testAmounts = [1, 5, 10, 50, 100];
      
      for (const usdtAmount of testAmounts) {
        const quantity = usdtAmount / currentPrice;
        console.log(`  ${usdtAmount} USDT = ${quantity.toFixed(8)} ILMT`);
        console.log(`    Fixed(0): ${quantity.toFixed(0)}`);
        console.log(`    Fixed(2): ${quantity.toFixed(2)}`);
        console.log(`    Fixed(4): ${quantity.toFixed(4)}`);
        console.log(`    Fixed(6): ${quantity.toFixed(6)}`);
        console.log(`    Fixed(8): ${quantity.toFixed(8)}`);
      }
      
    } catch (error) {
      console.log(`❌ Failed to get ticker: ${error.message}`);
    }
    
    // 3. Test some actual order placements (TEST mode)
    console.log('\n🧪 Testing quantity formats...');
    
    const testQuantities = [
      '1',
      '1.0',
      '1.00',
      '10',
      '10.0',
      '10.00',
      '100',
      '100.0',
      '100.00',
      '1000',
      '1000.0',
      '1000.00'
    ];
    
    for (const quantity of testQuantities) {
      try {
        console.log(`\n🔍 Testing quantity: "${quantity}"`);
        
        // Try to place a test order (this will likely fail, but we can see the error)
        await mexcApiService.placeOrder({
          symbol: 'ILMTUSDT',
          side: 'BUY',
          type: 'LIMIT',
          quantity: quantity,
          price: '0.001', // Very low price to avoid accidental execution
          timeInForce: 'GTC',
          test: true // If MEXC supports test orders
        });
        
        console.log(`✅ Quantity "${quantity}" - Format accepted`);
        
      } catch (error) {
        console.log(`❌ Quantity "${quantity}" - Error: ${error.message}`);
        
        // Check if it's a quantity precision error
        if (error.message.includes('quantity') || error.message.includes('scale') || error.message.includes('precision')) {
          console.log('  🎯 This appears to be a quantity precision error!');
        }
      }
    }
    
    await app.close();
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run the debug script
debugMexcQuantityPrecision().catch(console.error); 