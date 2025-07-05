const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { MexcApiService } = require('./dist/mexc/services/mexc-api.service');

async function testILMTSymbols() {
  try {
    console.log('🔍 Testing ILMT symbol formats on MEXC...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const mexcApiService = app.get(MexcApiService);
    
    console.log('✅ App created successfully');
    
    // Test various ILMT symbol formats
    const ilmtVariants = [
      'ILMTUSDT',
      'ILMT_USDT', 
      'ILMT-USDT',
      'ILMT/USDT',
      'ILMTusdt',
      'ilmtusdt',
      'ILMTBUSD',
      'ILMTETH',
      'ILMTBTC'
    ];
    
    console.log('\n📡 Testing ILMT symbol variants...');
    
    for (const symbol of ilmtVariants) {
      try {
        console.log(`\n🔍 Testing: ${symbol}`);
        const ticker = await mexcApiService.getTicker(symbol);
        
        console.log(`✅ ${symbol} - Success!`);
        console.log(`  Price: ${ticker.price || ticker.lastPrice || 'N/A'}`);
        console.log(`  Symbol: ${ticker.symbol}`);
        
        if (ticker.price || ticker.lastPrice) {
          console.log(`🎯 FOUND WORKING SYMBOL: ${symbol}`);
          console.log(`  Current price: ${ticker.price || ticker.lastPrice}`);
        }
        
      } catch (error) {
        console.log(`❌ ${symbol} - Error: ${error.message}`);
      }
    }
    
    // Also test if we can get exchange info to see available symbols
    console.log('\n📊 Testing exchange info (if available)...');
    try {
      // Some exchanges have an endpoint to list all symbols
      const exchangeInfo = await mexcApiService.getExchangeInfo();
      console.log('✅ Exchange info available');
      
      // Look for ILMT in the symbols
      if (exchangeInfo.symbols) {
        const ilmtSymbols = exchangeInfo.symbols.filter(s => 
          s.symbol.toLowerCase().includes('ilmt')
        );
        
        if (ilmtSymbols.length > 0) {
          console.log('🎯 Found ILMT symbols in exchange info:');
          ilmtSymbols.forEach(s => {
            console.log(`  - ${s.symbol} (status: ${s.status})`);
          });
        } else {
          console.log('❌ No ILMT symbols found in exchange info');
        }
      }
    } catch (error) {
      console.log('❌ Exchange info not available:', error.message);
    }
    
    await app.close();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testILMTSymbols(); 