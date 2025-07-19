// Fix PancakeSwap transaction issues
const { ethers } = require('ethers');

// Configuration
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org/';
const PANCAKE_ROUTER_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const ILMT_TOKEN_ADDRESS = '0x98a0a245Ef9A96Cf28f1Ebf1a3b3bC562Ed8D783';
const USDT_TOKEN_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

// Private key from environment (for testing)
const PRIVATE_KEY = process.env.BSC_PRIVATE_KEY;

// ABIs
const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

async function fixPancakeSwapIssue() {
  console.log('🔧 PancakeSwap Transaction Fix');
  console.log('=============================');
  
  if (!PRIVATE_KEY) {
    console.log('❌ BSC_PRIVATE_KEY not set in environment');
    return;
  }
  
  try {
    // Connect to BSC
    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    
    console.log('\n📡 1. Blockchain Connection...');
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected to BSC, block: ${blockNumber}`);
    console.log(`📍 Wallet: ${wallet.address}`);
    
    // Get current balances
    console.log('\n💰 2. Checking Balances...');
    const ilmtContract = new ethers.Contract(ILMT_TOKEN_ADDRESS, ERC20_ABI, provider);
    const usdtContract = new ethers.Contract(USDT_TOKEN_ADDRESS, ERC20_ABI, provider);
    
    const [ilmtBalance, usdtBalance, bnbBalance] = await Promise.all([
      ilmtContract.balanceOf(wallet.address),
      usdtContract.balanceOf(wallet.address),
      provider.getBalance(wallet.address)
    ]);
    
    console.log(`📊 ILMT Balance: ${ethers.formatUnits(ilmtBalance, 18)}`);
    console.log(`📊 USDT Balance: ${ethers.formatUnits(usdtBalance, 18)}`);
    console.log(`📊 BNB Balance: ${ethers.formatEther(bnbBalance)}`);
    
    // Check if we have enough ILMT
    const testAmount = ethers.parseUnits('1', 18); // 1 ILMT for testing
    if (ilmtBalance < testAmount) {
      console.log('❌ Insufficient ILMT balance for testing');
      return;
    }
    
    // Check if we have enough BNB for gas
    const minBnbRequired = ethers.parseEther('0.001'); // 0.001 BNB
    if (bnbBalance < minBnbRequired) {
      console.log('❌ Insufficient BNB balance for gas fees');
      return;
    }
    
    // Check current allowance
    console.log('\n🔓 3. Checking Token Allowance...');
    const currentAllowance = await ilmtContract.allowance(wallet.address, PANCAKE_ROUTER_ADDRESS);
    console.log(`📊 Current ILMT allowance: ${ethers.formatUnits(currentAllowance, 18)}`);
    
    // Approve if needed
    if (currentAllowance < testAmount) {
      console.log('🔓 Approving ILMT token...');
      const ilmtWithSigner = ilmtContract.connect(wallet);
      
      // Get current gas price
      const gasPrice = await provider.getFeeData();
      const optimizedGasPrice = ethers.parseUnits('3', 'gwei'); // 3 gwei for BSC
      
      console.log(`📊 Current network gas price: ${ethers.formatUnits(gasPrice.gasPrice, 'gwei')} gwei`);
      console.log(`📊 Using optimized gas price: 3 gwei`);
      
      const approveTx = await ilmtWithSigner.approve(
        PANCAKE_ROUTER_ADDRESS,
        ethers.MaxUint256, // Approve max amount
        {
          gasLimit: 50000,
          gasPrice: optimizedGasPrice
        }
      );
      
      console.log(`📝 Approval transaction sent: ${approveTx.hash}`);
      const approveReceipt = await approveTx.wait();
      console.log(`✅ Approval confirmed in block: ${approveReceipt.blockNumber}`);
    } else {
      console.log('✅ Token already approved');
    }
    
    // Get quote
    console.log('\n💱 4. Getting Swap Quote...');
    const router = new ethers.Contract(PANCAKE_ROUTER_ADDRESS, ROUTER_ABI, provider);
    const path = [ILMT_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS];
    
    const amounts = await router.getAmountsOut(testAmount, path);
    const expectedUsdtOut = amounts[1];
    
    console.log(`📊 Quote: 1 ILMT = ${ethers.formatUnits(expectedUsdtOut, 18)} USDT`);
    
    // Calculate minimum amount out with 5% slippage
    const slippagePercent = 5;
    const minimumAmountOut = expectedUsdtOut * BigInt(100 - slippagePercent) / BigInt(100);
    
    console.log(`📊 Minimum USDT out (${slippagePercent}% slippage): ${ethers.formatUnits(minimumAmountOut, 18)}`);
    
    // Execute swap
    console.log('\n🔄 5. Executing Swap...');
    const routerWithSigner = router.connect(wallet);
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
    
    // Get current gas price and optimize
    const currentGasPrice = await provider.getFeeData();
    const optimizedGasPrice = ethers.parseUnits('3', 'gwei'); // 3 gwei for BSC
    
    console.log(`📊 Using gas settings:`);
    console.log(`   Gas Limit: 150000`);
    console.log(`   Gas Price: 3 gwei`);
    console.log(`   Estimated Cost: ${(150000 * 3 * 1e-9).toFixed(6)} BNB`);
    
    const swapTx = await routerWithSigner.swapExactTokensForTokens(
      testAmount,
      minimumAmountOut,
      path,
      wallet.address,
      deadline,
      {
        gasLimit: 150000,
        gasPrice: optimizedGasPrice
      }
    );
    
    console.log(`📝 Swap transaction sent: ${swapTx.hash}`);
    console.log(`🔗 BSCScan: https://bscscan.com/tx/${swapTx.hash}`);
    
    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...');
    const receipt = await swapTx.wait();
    
    if (receipt.status === 1) {
      console.log('✅ Swap successful!');
      console.log(`📊 Block: ${receipt.blockNumber}`);
      console.log(`📊 Gas Used: ${receipt.gasUsed}`);
      console.log(`📊 Gas Price: ${ethers.formatUnits(receipt.gasPrice, 'gwei')} gwei`);
      console.log(`📊 Transaction Fee: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} BNB`);
    } else {
      console.log('❌ Swap failed');
    }
    
    // Check final balances
    console.log('\n💰 6. Final Balances...');
    const [finalIlmtBalance, finalUsdtBalance] = await Promise.all([
      ilmtContract.balanceOf(wallet.address),
      usdtContract.balanceOf(wallet.address)
    ]);
    
    console.log(`📊 ILMT Balance: ${ethers.formatUnits(finalIlmtBalance, 18)}`);
    console.log(`📊 USDT Balance: ${ethers.formatUnits(finalUsdtBalance, 18)}`);
    
    // Recommendations
    console.log('\n💡 7. Recommendations for Code...');
    console.log('✅ Use minimum 3 gwei gas price for BSC');
    console.log('✅ Use 150000 gas limit for swaps');
    console.log('✅ Use 5% slippage for volatile tokens');
    console.log('✅ Always approve MAX amount to avoid repeated approvals');
    console.log('✅ Check balances before executing swaps');
    console.log('✅ Verify token approval before swap execution');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    if (error.code === 'CALL_EXCEPTION') {
      console.log('💡 This is likely due to:');
      console.log('   - Insufficient token balance');
      console.log('   - Token not approved');
      console.log('   - Slippage too high');
      console.log('   - Gas price too low');
    }
  }
}

// Run fix
if (require.main === module) {
  fixPancakeSwapIssue().catch(console.error);
}

module.exports = { fixPancakeSwapIssue }; 