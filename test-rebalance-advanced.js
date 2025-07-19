/**
 * Test avansat pentru rebalansarea ordinelor
 * Testează problema cu rebalansarea continuă
 */

// Simulează ordinele cu timestamp-uri diferite
const now = new Date();
const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

const mockActiveOrders = [
  {
    id: "OLD_ORDER_1",
    orderId: "OLD_ORDER_1",
    exchange: 'MEXC',
    side: 'SELL',
    price: 0.010511,  // 5% peste preț curent
    amount: 200,
    timestamp: fiveMinutesAgo, // Vechi - poate fi rebalansiat
  },
  {
    id: "RECENT_ORDER_1",
    orderId: "RECENT_ORDER_1",
    exchange: 'MEXC',
    side: 'SELL',
    price: 0.010611,  // 6% peste preț curent
    amount: 200,
    timestamp: new Date(now.getTime() - 30000), // Recent - NU trebuie rebalansiat
  },
  {
    id: "OLD_ORDER_2",
    orderId: "OLD_ORDER_2",
    exchange: 'MEXC',
    side: 'BUY',
    price: 0.009509,  // 5% sub preț curent
    amount: 200,
    timestamp: twoMinutesAgo, // La limită - poate fi rebalansiat
  },
  {
    id: "OK_ORDER",
    orderId: "OK_ORDER",
    exchange: 'MEXC',
    side: 'SELL',
    price: 0.010050,  // 0.5% peste preț curent (OK)
    amount: 200,
    timestamp: fiveMinutesAgo,
  }
];

// Configurații de test
const testConfigs = [
  {
    levelDistance: 0.5,
    maxRebalanceDistance: 2.0,
    name: "Moderate Config (0.5%, 2%)",
    description: "Configurația recomandată"
  },
  {
    levelDistance: 0.5,
    maxRebalanceDistance: 10.0,
    name: "Wide Config (0.5%, 10%)",
    description: "Configurația actuală (problemă)"
  }
];

const currentPrice = 0.010001;

console.log('🧪 ADVANCED REBALANCE TESTING');
console.log('===============================');
console.log(`📊 Current Price: ${currentPrice}`);
console.log(`🕒 Current Time: ${now.toISOString()}`);
console.log('');

// Funcția avansată de testare
function testAdvancedRebalanceLogic(activeOrders, currentPrice, config) {
  const maxDistance = config.maxRebalanceDistance / 100;
  const levelDistance = config.levelDistance / 100;

  console.log(`🔍 Testing: ${config.name}`);
  console.log(`📝 ${config.description}`);
  console.log(`⚙️  Max Distance: ${config.maxRebalanceDistance}%`);
  console.log('');

  const ordersToRebalance = activeOrders.filter((order) => {
    const deviation = Math.abs(order.price - currentPrice) / currentPrice;
    const deviationPercent = (deviation * 100).toFixed(2);
    const isTooFar = deviation > maxDistance;
    
    // Verifică dacă orderul a fost rebalansiat recent (ultimele 2 minute)
    const ageMinutes = (now.getTime() - order.timestamp.getTime()) / 60000;
    const recentlyRebalanced = ageMinutes < 2;
    
    const needsRebalance = isTooFar && !recentlyRebalanced;
    
    console.log(`📋 Order ${order.orderId}:`);
    console.log(`   Side: ${order.side}`);
    console.log(`   Price: ${order.price}`);
    console.log(`   Age: ${ageMinutes.toFixed(1)} minutes`);
    console.log(`   Deviation: ${deviationPercent}%`);
    console.log(`   Too Far: ${isTooFar ? '✅' : '❌'}`);
    console.log(`   Recently Rebalanced: ${recentlyRebalanced ? '✅' : '❌'}`);
    console.log(`   Needs Rebalance: ${needsRebalance ? '🔄 YES' : '⏸️  NO'}`);
    
    if (needsRebalance) {
      // Calculează noul preț
      let newPrice;
      if (order.side === 'BUY') {
        newPrice = parseFloat((currentPrice * (1 - levelDistance)).toFixed(6));
      } else {
        newPrice = parseFloat((currentPrice * (1 + levelDistance)).toFixed(6));
      }
      console.log(`   New Price: ${newPrice}`);
    }
    console.log('');
    
    return needsRebalance;
  });

  console.log(`📊 SUMMARY for ${config.name}:`);
  console.log(`   Total Orders: ${activeOrders.length}`);
  console.log(`   Orders to Rebalance: ${ordersToRebalance.length}`);
  console.log(`   Orders OK: ${activeOrders.length - ordersToRebalance.length}`);
  console.log('');
  
  return ordersToRebalance;
}

// Afișează ordinele cu detalii
console.log('📋 CURRENT ORDERS WITH TIMESTAMPS:');
mockActiveOrders.forEach(order => {
  const ageMinutes = (now.getTime() - order.timestamp.getTime()) / 60000;
  console.log(`   ${order.orderId}: ${order.side} @ ${order.price} (${ageMinutes.toFixed(1)}min old)`);
});
console.log('');

// Test cu configurații diferite
testConfigs.forEach(config => {
  const toRebalance = testAdvancedRebalanceLogic(mockActiveOrders, currentPrice, config);
  console.log(`Result: ${toRebalance.length}/${mockActiveOrders.length} orders need rebalancing`);
  console.log('─'.repeat(50));
  console.log('');
});

console.log('🎯 PROBLEM ANALYSIS:');
console.log('=====================');
console.log('❌ PROBLEMA: Cu maxRebalanceDistance=10%, niciun ordin nu este rebalansiat');
console.log('   - Ordinele la 5-6% sunt în limitele acceptabile');
console.log('   - Dar sunt prea departe pentru o strategie eficientă');
console.log('');
console.log('✅ SOLUȚIA: Cu maxRebalanceDistance=2%, ordinele prea departe sunt rebalansate');
console.log('   - Ordinele la 5-6% sunt rebalansate la primul nivel (0.5%)');
console.log('   - Ordinele recent rebalansate sunt ignorate (anti-loop)');
console.log('');

console.log('🔧 RECOMMENDED SETTINGS:');
console.log('========================');
console.log('levelDistance: 0.5%        // Distanță între niveluri');
console.log('maxRebalanceDistance: 2.0% // Rebalansează dacă >2% departe');
console.log('levels: 5                  // Max 5 niveluri (2.5% spread)');
console.log('maxOrders: 5               // Max 5 ordine per parte');
console.log('');
console.log('📈 REZULTAT:');
console.log('- Ordinele vor fi la: 0.009951, 0.010001, 0.010051, 0.010101, 0.010151');
console.log('- Spread maxim: 2% (de la -1% la +1.5%)');
console.log('- Rebalansare automată dacă prețul se mișcă >2%');
console.log('- Prevenirea rebalansării continue prin timestamp check'); 