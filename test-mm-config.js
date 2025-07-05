const { NestFactory } = require('@nestjs/core');
const { MarketMakingModule } = require('./dist/market-making/market-making.module');
const { ConfigService } = require('./dist/config/config.service');

async function testConfig() {
  try {
    console.log('🔍 Testing MEXC Config in Market Making context...');
    
    const app = await NestFactory.create(MarketMakingModule);
    const configService = app.get(ConfigService);
    
    console.log('✅ App created successfully');
    console.log('📋 MEXC Configuration:');
    console.log('  API Key:', configService.mexcApiKey ? `${configService.mexcApiKey.substring(0, 8)}...` : 'NOT SET');
    console.log('  Secret Key:', configService.mexcSecretKey ? `${configService.mexcSecretKey.substring(0, 8)}...` : 'NOT SET');
    console.log('  Base URL:', configService.mexcBaseUrl);
    console.log('  WS URL:', configService.mexcWsUrl);
    
    console.log('📊 Market Making Config:');
    const mmConfig = configService.marketMakingConfig;
    console.log('  Enabled:', mmConfig.enabled);
    console.log('  Exchange:', mmConfig.exchange);
    console.log('  Spread:', mmConfig.spread);
    console.log('  Order Size:', mmConfig.orderSize);
    
    await app.close();
    console.log('✅ Test completed successfully');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testConfig(); 