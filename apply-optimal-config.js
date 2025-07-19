/**
 * Script pentru aplicarea configurației optime pentru market making
 */

const http = require('http');

const optimalConfig = {
  levelDistance: 0.5,           // 0.5% distanță între niveluri
  maxRebalanceDistance: 2.0,    // 2% distanță maximă pentru rebalansare
  levels: 5,                    // 5 niveluri maxim
  maxOrders: 5,                 // 5 ordine maxim per parte
  orderSize: 200,               // 200 ILMT per ordin
  refreshInterval: 30,          // 30 secunde între cicluri
  strategy: 'BALANCED'          // Strategie echilibrată
};

function applyConfig(config) {
  const data = JSON.stringify(config);
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/market-making/config',
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = http.request(options, (res) => {
    let responseData = '';
    
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Configurația optimă a fost aplicată cu succes!');
        console.log('📊 Configurația aplicată:', JSON.stringify(config, null, 2));
        
        try {
          const response = JSON.parse(responseData);
          console.log('📋 Răspuns server:', JSON.stringify(response, null, 2));
        } catch (e) {
          console.log('📋 Răspuns server:', responseData);
        }
      } else {
        console.error(`❌ Eroare la aplicarea configurației: ${res.statusCode}`);
        console.error('📋 Răspuns:', responseData);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Eroare de conexiune:', err.message);
    console.log('💡 Asigură-te că botul rulează pe portul 3000');
    console.log('💡 Rulează: npm run start:market-making');
  });

  req.write(data);
  req.end();
}

console.log('🔧 APLICAREA CONFIGURAȚIEI OPTIME');
console.log('=================================');
console.log('📊 Configurația care va fi aplicată:');
console.log(JSON.stringify(optimalConfig, null, 2));
console.log('');
console.log('🎯 Beneficii:');
console.log('- Ordine la distanțe rezonabile (0.5% între niveluri)');
console.log('- Rebalansare automată dacă prețul se mișcă >2%');
console.log('- Prevenirea rebalansării continue');
console.log('- Spread maxim: 2.5% (5 niveluri x 0.5%)');
console.log('');
console.log('🚀 Aplicând configurația...');

applyConfig(optimalConfig); 