const crypto = require('crypto');
const https = require('https');

const API_KEY = process.env.MEXC_API_KEY || 'your_api_key';
const SECRET = process.env.MEXC_SECRET_KEY || 'your_secret_key';
const BASE = 'https://api.mexc.com';

async function makeRequest(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    const url = `${BASE}${endpoint}${queryString ? '?' + queryString : ''}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function signedRequest(endpoint, params) {
  return new Promise((resolve, reject) => {
    // Add timestamp
    params.timestamp = Date.now();
    
    // Create query string for signature
    const queryString = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');
    
    // Create signature
    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(queryString)
      .digest('hex');
    
    const fullQS = `${queryString}&signature=${signature}`;
    const url = `${BASE}${endpoint}?${fullQS}`;
    
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'X-MEXC-APIKEY': API_KEY
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(json);
          }
        } catch (e) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function testMexcQuantityPrecision() {
  console.log('🔍 Testing MEXC quantity precision for ILMTUSDT...\n');
  
  try {
    // 1. Get exchange info
    console.log('📊 Fetching exchange info...');
    try {
      const exchangeInfo = await makeRequest('/api/v3/exchangeInfo');
      
      if (exchangeInfo && exchangeInfo.symbols) {
        const ilmtSymbol = exchangeInfo.symbols.find(s => s.symbol === 'ILMTUSDT');
        
        if (ilmtSymbol) {
          console.log('🎯 ILMTUSDT symbol info found:');
          console.log(`  Status: ${ilmtSymbol.status}`);
          console.log(`  Base Asset: ${ilmtSymbol.baseAsset}`);
          console.log(`  Quote Asset: ${ilmtSymbol.quoteAsset}`);
          console.log(`  Base Asset Precision: ${ilmtSymbol.baseAssetPrecision}`);
          console.log(`  Quote Asset Precision: ${ilmtSymbol.quoteAssetPrecision}`);
          
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
      console.log(`❌ Exchange info error: ${error.message}`);
    }
    
    // 2. Get current ticker
    console.log('\n📈 Getting current ticker...');
    try {
      const ticker = await makeRequest('/api/v3/ticker/24hr', { symbol: 'ILMTUSDT' });
      console.log('Current ticker:');
      console.log(`  Price: ${ticker.lastPrice}`);
      console.log(`  Volume: ${ticker.volume}`);
      console.log(`  Bid: ${ticker.bidPrice}`);
      console.log(`  Ask: ${ticker.askPrice}`);
      
      // Calculate test quantities
      const currentPrice = parseFloat(ticker.lastPrice || '0.01');
      console.log(`\n🧮 Test quantity calculations (current price: ${currentPrice}):`);
      
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
    
    // 3. Test quantity formats with actual order attempts
    console.log('\n🧪 Testing quantity formats with order attempts...');
    
    // Get current price for realistic test
    let currentPrice = 0.01;
    try {
      const ticker = await makeRequest('/api/v3/ticker/24hr', { symbol: 'ILMTUSDT' });
      currentPrice = parseFloat(ticker.lastPrice || '0.01');
    } catch (e) {
      console.log('Using fallback price for tests');
    }
    
    // Test quantities based on different USDT amounts
    const testQuantities = [
      (10 / currentPrice).toFixed(0),    // 10 USDT worth, no decimals
      (10 / currentPrice).toFixed(2),    // 10 USDT worth, 2 decimals
      (10 / currentPrice).toFixed(4),    // 10 USDT worth, 4 decimals
      (10 / currentPrice).toFixed(6),    // 10 USDT worth, 6 decimals
      (10 / currentPrice).toFixed(8),    // 10 USDT worth, 8 decimals
      '1000',                            // Round numbers
      '1000.0',
      '1000.00',
      '1000.000',
      '1000.0000',
    ];
    
    for (const quantity of testQuantities) {
      try {
        console.log(`\n🔍 Testing quantity: "${quantity}"`);
        
        // Try to place a test order
        await signedRequest('/api/v3/order', {
          symbol: 'ILMTUSDT',
          side: 'BUY',
          type: 'LIMIT',
          quantity: quantity,
          price: (currentPrice * 0.5).toFixed(6), // 50% below current price to avoid execution
          timeInForce: 'GTC',
          recvWindow: '5000'
        });
        
        console.log(`✅ Quantity "${quantity}" - Format accepted`);
        
      } catch (error) {
        console.log(`❌ Quantity "${quantity}" - Error: ${error.msg || error.message}`);
        
        // Check if it's a quantity precision error
        if ((error.msg || error.message || '').includes('quantity') || 
            (error.msg || error.message || '').includes('scale') || 
            (error.msg || error.message || '').includes('precision')) {
          console.log('  🎯 This appears to be a quantity precision error!');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run the test
testMexcQuantityPrecision().catch(console.error); 