// Debug script for PancakeSwap transaction failures
const { ethers } = require('ethers');

// Configuration
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org/';
const PANCAKE_ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const ILMT_TOKEN_ADDRESS = '0x98a0a245Ef9A96Cf28f1Ebf1a3b3bC562Ed8D783';
const USDT_TOKEN_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

// Router ABI (simplified)
const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function factory() external pure returns (address)",
  "function WETH() external pure returns (address)"
];

// Factory ABI (simplified)
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// Pair ABI (simplified)
const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

// ERC20 ABI (simplified)
const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

async function diagnosePancakeSwapError() {
  console.log('🔍 PancakeSwap Transaction Failure Diagnosis');
  console.log('==========================================');
  
  try {
    // Connect to BSC
    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    const router = new ethers.Contract(PANCAKE_ROUTER_ADDRESS, ROUTER_ABI, provider);
    
    console.log('\n📡 1. Blockchain Connection...');
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected to BSC, block: ${blockNumber}`);
    
    // Get factory and WETH addresses
    const factoryAddress = await router.factory();
    const wethAddress = await router.WETH();
    console.log(`📍 Factory: ${factoryAddress}`);
    console.log(`📍 WETH: ${wethAddress}`);
    
    // Check if direct pair exists
    console.log('\n🔗 2. Checking Direct Pair (ILMT/USDT)...');
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
    const directPair = await factory.getPair(ILMT_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS);
    
    if (directPair === ethers.ZeroAddress) {
      console.log('❌ Direct ILMT/USDT pair does not exist');
      console.log('💡 Need to route through WBNB: ILMT -> WBNB -> USDT');
      
      // Check ILMT/WBNB pair
      const ilmtWbnbPair = await factory.getPair(ILMT_TOKEN_ADDRESS, wethAddress);
      console.log(`🔗 ILMT/WBNB pair: ${ilmtWbnbPair}`);
      
      // Check WBNB/USDT pair
      const wbnbUsdtPair = await factory.getPair(wethAddress, USDT_TOKEN_ADDRESS);
      console.log(`🔗 WBNB/USDT pair: ${wbnbUsdtPair}`);
      
      if (ilmtWbnbPair === ethers.ZeroAddress || wbnbUsdtPair === ethers.ZeroAddress) {
        console.log('❌ Required routing pairs do not exist');
        return;
      }
    } else {
      console.log(`✅ Direct ILMT/USDT pair exists: ${directPair}`);
    }
    
    // Check token information
    console.log('\n🪙 3. Token Information...');
    const ilmtToken = new ethers.Contract(ILMT_TOKEN_ADDRESS, ERC20_ABI, provider);
    const usdtToken = new ethers.Contract(USDT_TOKEN_ADDRESS, ERC20_ABI, provider);
    
    try {
      const [ilmtSymbol, ilmtDecimals, usdtSymbol, usdtDecimals] = await Promise.all([
        ilmtToken.symbol(),
        ilmtToken.decimals(),
        usdtToken.symbol(),
        usdtToken.decimals()
      ]);
      
      console.log(`📊 ILMT: ${ilmtSymbol}, decimals: ${ilmtDecimals}`);
      console.log(`📊 USDT: ${usdtSymbol}, decimals: ${usdtDecimals}`);
    } catch (error) {
      console.log('❌ Error getting token info:', error.message);
    }
    
    // Test routing paths
    console.log('\n🛤️ 4. Testing Routing Paths...');
    const testAmount = ethers.parseUnits('1', 18); // 1 ILMT
    
    // Test direct path
    try {
      const directPath = [ILMT_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS];
      const directAmounts = await router.getAmountsOut(testAmount, directPath);
      console.log(`✅ Direct path works: 1 ILMT = ${ethers.formatUnits(directAmounts[1], 18)} USDT`);
    } catch (error) {
      console.log('❌ Direct path failed:', error.message);
      
      // Test routing through WBNB
      try {
        const routedPath = [ILMT_TOKEN_ADDRESS, wethAddress, USDT_TOKEN_ADDRESS];
        const routedAmounts = await router.getAmountsOut(testAmount, routedPath);
        console.log(`✅ Routed path works: 1 ILMT = ${ethers.formatUnits(routedAmounts[2], 18)} USDT`);
        console.log(`📍 Recommended path: ILMT -> WBNB -> USDT`);
      } catch (error) {
        console.log('❌ Routed path failed:', error.message);
      }
    }
    
    // Check specific transaction
    console.log('\n🔍 5. Analyzing Failed Transaction...');
    const failedTxHash = '0xbdf503a8dcc788c0eee4e49ff3d51a368b467765fb1c596beb2cad9703761f73';
    
    try {
      const tx = await provider.getTransaction(failedTxHash);
      const receipt = await provider.getTransactionReceipt(failedTxHash);
      
      console.log(`📋 Transaction Details:`);
      console.log(`   Hash: ${tx.hash}`);
      console.log(`   From: ${tx.from}`);
      console.log(`   To: ${tx.to}`);
      console.log(`   Value: ${ethers.formatEther(tx.value)} BNB`);
      console.log(`   Gas Limit: ${tx.gasLimit}`);
      console.log(`   Gas Price: ${ethers.formatUnits(tx.gasPrice, 'gwei')} gwei`);
      console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);
      console.log(`   Gas Used: ${receipt.gasUsed}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      
      if (receipt.status === 0) {
        console.log('❌ Transaction failed on-chain');
        console.log('💡 Possible causes:');
        console.log('   - Slippage too high');
        console.log('   - Insufficient token balance');
        console.log('   - Token not approved');
        console.log('   - Wrong routing path');
        console.log('   - Liquidity insufficient');
      }
    } catch (error) {
      console.log('❌ Could not fetch transaction details:', error.message);
    }
    
    // Recommendations
    console.log('\n💡 6. Recommendations...');
    console.log('✅ Use correct routing path:');
    console.log('   - If direct pair exists: [ILMT, USDT]');
    console.log('   - If routing needed: [ILMT, WBNB, USDT]');
    console.log('✅ Ensure token approval before swap');
    console.log('✅ Check wallet balance before transaction');
    console.log('✅ Use appropriate slippage (2-5%)');
    console.log('✅ Verify gas settings are reasonable');
    
  } catch (error) {
    console.error('❌ Diagnosis failed:', error.message);
  }
}

// Run diagnosis
if (require.main === module) {
  diagnosePancakeSwapError().catch(console.error);
}

module.exports = { diagnosePancakeSwapError }; 