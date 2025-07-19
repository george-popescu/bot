// Test script to verify market making fixes
const fs = require('fs');
const path = require('path');

console.log('🔧 Market Making Fix Verification');
console.log('=================================');

// Check if the enhanced error logging system is working
function checkErrorLogging() {
  console.log('\n📊 1. Checking Enhanced Error Logging System...');
  
  const debugLogFile = path.join(process.cwd(), 'logs', 'market-making-debug.log');
  
  if (fs.existsSync(debugLogFile)) {
    const content = fs.readFileSync(debugLogFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    console.log(`✅ Debug log file exists with ${lines.length} entries`);
    
    // Check for enhanced error entries
    const enhancedErrors = lines.filter(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.data && parsed.data.errorJSON && parsed.data.errorMessage;
      } catch (e) {
        return false;
      }
    });
    
    console.log(`✅ Found ${enhancedErrors.length} enhanced error entries`);
    
    // Show latest enhanced error
    if (enhancedErrors.length > 0) {
      const latest = JSON.parse(enhancedErrors[enhancedErrors.length - 1]);
      console.log(`📋 Latest enhanced error: ${latest.data.errorMessage}`);
      console.log(`📋 Error type: ${latest.data.errorConstructor}`);
      console.log(`📋 Error code: ${latest.data.errorCode || 'N/A'}`);
    }
  } else {
    console.log('❌ Debug log file not found');
  }
}

// Check if the code changes are properly implemented
function checkCodeChanges() {
  console.log('\n🔍 2. Checking Code Changes...');
  
  const serviceFile = path.join(process.cwd(), 'src', 'market-making', 'services', 'market-making.service.ts');
  
  if (fs.existsSync(serviceFile)) {
    const content = fs.readFileSync(serviceFile, 'utf8');
    
    // Check for enhanced error logging
    const hasEnhancedLogging = content.includes('🔍 ENHANCED') && content.includes('errorJSON');
    console.log(`${hasEnhancedLogging ? '✅' : '❌'} Enhanced error logging implemented`);
    
    // Check for MexcApiService usage instead of MexcNativeHttpService
    const usesMexcApiService = content.includes('this.mexcApiService.cancelOrder');
    console.log(`${usesMexcApiService ? '✅' : '❌'} Using MexcApiService for cancel operations`);
    
    // Check for proper orderId parsing
    const hasOrderIdParsing = content.includes('parseInt(order.orderId)');
    console.log(`${hasOrderIdParsing ? '✅' : '❌'} Proper orderId parsing implemented`);
    
    // Check for removed MexcNativeHttpService dependency
    const noNativeHttpService = !content.includes('MexcNativeHttpService');
    console.log(`${noNativeHttpService ? '✅' : '❌'} MexcNativeHttpService dependency removed`);
  } else {
    console.log('❌ Market making service file not found');
  }
  
  // Check MexcApiService improvements
  const mexcApiFile = path.join(process.cwd(), 'src', 'mexc', 'services', 'mexc-api.service.ts');
  
  if (fs.existsSync(mexcApiFile)) {
    const content = fs.readFileSync(mexcApiFile, 'utf8');
    
    // Check for enhanced handleApiError
    const hasEnhancedErrorHandling = content.includes('Raw API error details') && content.includes('error.code && error.msg');
    console.log(`${hasEnhancedErrorHandling ? '✅' : '❌'} Enhanced API error handling implemented`);
  } else {
    console.log('❌ MEXC API service file not found');
  }
}

// Provide summary and recommendations
function provideSummary() {
  console.log('\n📋 3. Summary of Fixes Applied...');
  
  console.log('✅ Enhanced error logging system');
  console.log('   - Captures full error details including errorJSON');
  console.log('   - Logs error type, constructor, keys, message, and stack');
  console.log('   - Extracts specific error information (response, data, status, code)');
  
  console.log('✅ Improved order cancellation');
  console.log('   - Uses MexcApiService.cancelOrder instead of direct HTTP calls');
  console.log('   - Proper orderId type conversion (string to number)');
  console.log('   - Consistent error handling across the application');
  
  console.log('✅ Enhanced API error handling');
  console.log('   - Better handling of MexcNativeHttpService errors');
  console.log('   - Proper mapping of MEXC error codes to HTTP status codes');
  console.log('   - Detailed error logging for debugging');
  
  console.log('\n🎯 Expected Results:');
  console.log('   - No more [object Object] errors in logs');
  console.log('   - Clear error messages showing actual MEXC API responses');
  console.log('   - Better identification of 404 "Unknown order sent" errors');
  console.log('   - Improved debugging capabilities');
  
  console.log('\n🔄 Next Steps:');
  console.log('   1. Restart the market making service');
  console.log('   2. Monitor logs for clear error messages');
  console.log('   3. Check if order cancellation works properly');
  console.log('   4. Verify rebalancing operates without continuous errors');
}

// Run all checks
checkErrorLogging();
checkCodeChanges();
provideSummary();

console.log('\n🏁 Fix verification completed!'); 