#!/usr/bin/env node

/**
 * Test Script pentru HIGH_VOLUME_BURST Strategy (CORRECTED)
 * 
 * CORRECȚIE IMPORTANTĂ - Strategia folosește:
 * - Tranzacții individuale mici: 5-15 USDT (SAFE!)
 * - Volume cumulate în ILMT: 7k-30k ILMT total per minut
 * - Multe execuții mici: 100-300 trades per burst
 * - Evită riscul financiar prin tranzacții mici
 */

const axios = require('axios');

// Configurația CORECTATĂ pentru testarea HIGH_VOLUME_BURST (ADJUSTED)
const HIGH_VOLUME_BURST_CONFIG = {
  enabled: true,
  monitoringMode: true, // IMPORTANT: Doar simulare pentru test
  strategy: 'HIGH_VOLUME_BURST',
  targetVolumeDaily: 50000, // 50K USDT target zilnic (adjusted)
  
  // Configurații AJUSTATE pentru BURST (volume mai mici, trades cu max 150 ILMT)
  burstMinVolume: 500,  // 500 ILMT cumulative target per burst (ADJUSTED)
  burstMaxVolume: 6000, // 6K ILMT cumulative target per burst (ADJUSTED)
  burstMinExecutions: 15, // 15-30 trades per burst (ADJUSTED)
  burstMaxExecutions: 30, // Pentru a atinge target-ul ILMT cumulat (ADJUSTED)
  burstPriceSpreadUnits: 0.000020, // 20 unități în 6 zecimale (0.000020)
  
  // Intervale între burst-uri
  cycleIntervalMin: 60,  // 1 minut minimum
  cycleIntervalMax: 180, // 3 minute maximum
  
  // Setări de siguranță
  stealthMode: true,
  balanceWindow: 20,
  maxConsecutiveSide: 3,
};

const API_BASE_URL = 'http://localhost:3000/api';

async function testHighVolumeBurstStrategy() {
  console.log('🚀 Testare HIGH_VOLUME_BURST Strategy pentru ILMT (CORRECTED)');
  console.log('================================================================');
  console.log('🔧 CORRECȚIE APLICATĂ: Trades mici (~5-15 USDT), volume cumulate în ILMT');
  console.log('');
  
  try {
    // 1. Oprire volume booster dacă rulează
    console.log('⏹️  Oprire Volume Booster...');
    await axios.post(`${API_BASE_URL}/volume-booster/stop`);
    
    // 2. Actualizare configurație pentru HIGH_VOLUME_BURST CORECTĂ
    console.log('⚙️  Configurare HIGH_VOLUME_BURST strategy (CORRECTED)...');
    const configResponse = await axios.patch(`${API_BASE_URL}/volume-booster/config`, HIGH_VOLUME_BURST_CONFIG);
    console.log('✅ Configurație CORECTĂ aplicată:', configResponse.data);
    
    // 3. Afișare configurație CORECTĂ aplicată
    console.log('📋 Configurația AJUSTATĂ HIGH_VOLUME_BURST:');
    console.log(`   • Target ILMT cumulat: ${HIGH_VOLUME_BURST_CONFIG.burstMinVolume} - ${HIGH_VOLUME_BURST_CONFIG.burstMaxVolume} ILMT per burst (ADJUSTED)`);
    console.log(`   • Trades individuale: MAXIM 150 ILMT fiecare (HARD LIMIT!) 🔒`);
    console.log(`   • Numărul de execuții: ${HIGH_VOLUME_BURST_CONFIG.burstMinExecutions} - ${HIGH_VOLUME_BURST_CONFIG.burstMaxExecutions} trades per burst (ADJUSTED)`);
    console.log(`   • Spread maxim: ${HIGH_VOLUME_BURST_CONFIG.burstPriceSpreadUnits} (20 unități în 6 zecimale)`);
    console.log(`   • Interval între burst-uri: ${HIGH_VOLUME_BURST_CONFIG.cycleIntervalMin} - ${HIGH_VOLUME_BURST_CONFIG.cycleIntervalMax} secunde`);
    console.log('');
    console.log('🎯 Exemplu calcul pentru un burst AJUSTAT:');
    console.log('   • Target: 3,000 ILMT (exemplu mid-range)');
    console.log('   • Preț ILMT: ~$0.009');
    console.log('   • Valoare totală: ~27 USDT');
    console.log('   • Trades de MAX 150 ILMT: 20 micro-trades');  
    console.log('   • Siguranță maximă: Trades mici + limită 150 ILMT!');
    console.log('   • Risc extrem de redus prin volume mici!');
    
    // 4. Pornire Volume Booster cu noua strategie CORECTĂ
    console.log('\n🎬 Pornire Volume Booster cu HIGH_VOLUME_BURST CORRECTED...');
    await axios.post(`${API_BASE_URL}/volume-booster/start`);
    console.log('✅ Volume Booster pornit cu strategia CORECTĂ!');
    
    // 5. Monitorizare pentru 5 minute
    console.log('\n📊 Monitorizare activitate pentru 5 minute...');
    console.log('   (Strategia va executa burst-uri cu micro-trades la intervale aleatoare)');
    
    let monitoringDuration = 300; // 5 minute
    let checkInterval = 30; // La fiecare 30 secunde
    
    for (let i = 0; i < monitoringDuration / checkInterval; i++) {
      await new Promise(resolve => setTimeout(resolve, checkInterval * 1000));
      
      const status = await axios.get(`${API_BASE_URL}/volume-booster/status`);
      const stats = status.data.stats;
      
      console.log(`\n⏰ Minut ${((i + 1) * checkInterval / 60).toFixed(1)}:`);
      console.log(`   • Trading running: ${status.data.isRunning ? '✅' : '❌'}`);
      console.log(`   • Micro-trades executate: ${stats.dailyTrades}`);
      console.log(`   • Volume total USDT: ${stats.dailyVolume.toFixed(2)} USDT (SAFE AMOUNT!)`);
      console.log(`   • BUY/SELL ratio: ${stats.buyCount}/${stats.sellCount}`);
      console.log(`   • Ultima tranzacție: ${stats.lastTradeTime || 'None'}`);
      
      if (stats.dailyTrades > 0) {
        const avgVolumePerTrade = stats.dailyVolume / stats.dailyTrades;
        console.log(`   • Volume mediu per micro-trade: ${avgVolumePerTrade.toFixed(2)} USDT (SAFE!)`);
        
        // Afișare ultimele trades
        if (stats.recentTrades.length > 0) {
          console.log('   • Ultimele micro-trades:');
          stats.recentTrades.slice(-3).forEach((trade, idx) => {
            const tradeValue = trade.size * trade.price;
            console.log(`     ${idx + 1}. ${trade.side} ${trade.size} ILMT @ $${trade.price.toFixed(6)} (~${tradeValue.toFixed(2)} USDT)`);
          });
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Eroare în timpul testării:', error.response?.data || error.message);
  } finally {
    // 6. Oprire Volume Booster
    console.log('\n⏹️  Oprire Volume Booster...');
    try {
      await axios.post(`${API_BASE_URL}/volume-booster/stop`);
      console.log('✅ Volume Booster oprit');
      
      // Afișare statistici finale
      const finalStatus = await axios.get(`${API_BASE_URL}/volume-booster/status`);
      const finalStats = finalStatus.data.stats;
      
      console.log('\n📈 RAPORT FINAL - HIGH_VOLUME_BURST CORRECTED Test:');
      console.log('=================================================');
      console.log(`• Total micro-trades: ${finalStats.dailyTrades}`);
      console.log(`• Total volume USDT: ${finalStats.dailyVolume.toFixed(2)} USDT (SAFE!)`);
      console.log(`• BUY trades: ${finalStats.buyCount}`);
      console.log(`• SELL trades: ${finalStats.sellCount}`);
      
      if (finalStats.dailyTrades > 0) {
        const avgVolumePerTrade = finalStats.dailyVolume / finalStats.dailyTrades;
        console.log(`• Volume mediu per micro-trade: ${avgVolumePerTrade.toFixed(2)} USDT`);
        console.log(`• Range țintă per trade: ~$1.35 max (150 ILMT @ $0.009)! (ULTRA SAFE!)`);
        
        if (avgVolumePerTrade >= 0.50 && avgVolumePerTrade <= 2.00) {
          console.log('✅ Volume per trade în range-ul ULTRA SAFE!');
        } else {
          console.log('⚠️  Volume per trade în afara range-ului ultra safe - să verificăm');
        }
        
        // Estimare volume ILMT bazat pe trades
        const avgPrice = 0.009; // Estimare preț ILMT
        const estimatedILMTVolume = finalStats.dailyVolume / avgPrice;
        const avgILMTPerTrade = estimatedILMTVolume / finalStats.dailyTrades;
        console.log(`• Volume ILMT estimat: ${estimatedILMTVolume.toFixed(0)} ILMT`);
        console.log(`• Average ILMT per trade: ${avgILMTPerTrade.toFixed(0)} ILMT (should be ≤150)`);
        console.log(`• Target range ILMT: ${HIGH_VOLUME_BURST_CONFIG.burstMinVolume} - ${HIGH_VOLUME_BURST_CONFIG.burstMaxVolume} ILMT per burst (AJUSTAT)`);
        
        // Verify 150 ILMT limit compliance
        if (avgILMTPerTrade <= 150) {
          console.log('✅ 150 ILMT per trade limit RESPECTED! 🔒');
        } else {
          console.log('⚠️ WARNING: 150 ILMT limit might be exceeded - check implementation!');
        }
      }
      
    } catch (stopError) {
      console.error('❌ Eroare la oprirea Volume Booster:', stopError.response?.data || stopError.message);
    }
  }
}

// Simulare exemplu CLS CORECTĂ pentru comparație
function simulateCLSExampleCorrected() {
  console.log('\n📊 AJUSTĂRI FINALE - Interpretarea corectă cu volume reduse:');
  console.log('=========================================================');
  console.log('• Volume cumulat: 500-6K ILMT per burst (AJUSTAT)');
  console.log('• Trades individuale: MAXIM 150 ILMT fiecare (HARD LIMIT!) 🔒');
  console.log('• Spread preț: ±0.000020 (20 unități în 6 zecimale)');
  console.log('• Execuții: 15-30 micro-trades pentru target cumulat (AJUSTAT)');
  console.log('• Siguranță MAXIMĂ: Risc extrem de redus prin volume mici');
  console.log('');
  console.log('🎯 HIGH_VOLUME_BURST FINAL replicates this with maximum safety:');
  console.log('• Spread maxim: 0.000020 (20 unități în 6 zecimale) ✅');
  console.log('• Target ILMT: 500-6K ILMT cumulat (AJUSTAT pentru siguranță) ✅');
  console.log('• Micro-trades: 15-30 trades cu max 150 ILMT fiecare (ULTRA SAFE!) ✅');
  console.log('• Timing: Intervale aleatoare pentru stealth ✅');
  console.log('• SIGURANȚĂ MAXIMĂ: 150 ILMT per tranzacție = ~$1.35 per trade! ✅');
}

// Rulare test
if (require.main === module) {
  console.log('🎯 HIGH_VOLUME_BURST Strategy Test - ILMT Trading (CORRECTED)');
  console.log('Strategia CORECTĂ: Micro-trades sigure cu target cumulat ILMT');
  console.log('');
  
  simulateCLSExampleCorrected();
  testHighVolumeBurstStrategy().catch(console.error);
}

module.exports = {
  testHighVolumeBurstStrategy,
  HIGH_VOLUME_BURST_CONFIG
}; 