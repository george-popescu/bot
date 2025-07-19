// Test script to verify enhanced error logging
const fs = require('fs');
const path = require('path');

// Simulate different types of errors that might occur
function testErrorLogging() {
  console.log('🧪 Testing enhanced error logging system...');
  
  // Test 1: Standard Error object
  const standardError = new Error('This is a standard error message');
  standardError.code = 'ECONNREFUSED';
  standardError.errno = -61;
  
  console.log('\n📋 Test 1: Standard Error Object');
  console.log('Error type:', typeof standardError);
  console.log('Error constructor:', standardError?.constructor?.name);
  console.log('Error keys:', Object.keys(standardError));
  console.log('Error message:', standardError instanceof Error ? standardError.message : String(standardError));
  console.log('Error stack:', standardError instanceof Error ? standardError.stack : undefined);
  console.log('Error string:', String(standardError));
  console.log('Error JSON:', JSON.stringify(standardError, Object.getOwnPropertyNames(standardError), 2));
  
  // Test 2: Axios-like error
  const axiosError = {
    message: 'Request failed with status code 404',
    code: 'ERR_BAD_REQUEST',
    config: { method: 'DELETE', url: '/api/v3/order' },
    response: {
      status: 404,
      statusText: 'Not Found',
      data: { code: -2011, msg: 'Unknown order sent.' }
    }
  };
  
  console.log('\n📋 Test 2: Axios-like Error Object');
  console.log('Error type:', typeof axiosError);
  console.log('Error constructor:', axiosError?.constructor?.name);
  console.log('Error keys:', Object.keys(axiosError));
  console.log('Error message:', axiosError instanceof Error ? axiosError.message : String(axiosError));
  console.log('Error stack:', axiosError instanceof Error ? axiosError.stack : undefined);
  console.log('Error string:', String(axiosError));
  console.log('Error JSON:', JSON.stringify(axiosError, Object.getOwnPropertyNames(axiosError), 2));
  
  // Test 3: Raw object error
  const objectError = {
    code: -2011,
    msg: 'Unknown order sent.',
    timestamp: Date.now()
  };
  
  console.log('\n📋 Test 3: Raw Object Error');
  console.log('Error type:', typeof objectError);
  console.log('Error constructor:', objectError?.constructor?.name);
  console.log('Error keys:', Object.keys(objectError));
  console.log('Error message:', objectError instanceof Error ? objectError.message : String(objectError));
  console.log('Error stack:', objectError instanceof Error ? objectError.stack : undefined);
  console.log('Error string:', String(objectError));
  console.log('Error JSON:', JSON.stringify(objectError, Object.getOwnPropertyNames(objectError), 2));
  
  // Test 4: Extract specific error information
  console.log('\n📋 Test 4: Specific Error Information Extraction');
  [standardError, axiosError, objectError].forEach((error, index) => {
    console.log(`\nError ${index + 1}:`);
    if (error && typeof error === 'object') {
      const errorObj = error;
      console.log('  Has response:', !!errorObj.response);
      console.log('  Has data:', !!errorObj.data);
      console.log('  Has status:', !!errorObj.status);
      console.log('  Has code:', !!errorObj.code);
      console.log('  Response status:', errorObj.response?.status);
      console.log('  Response data:', errorObj.response?.data);
      console.log('  Response statusText:', errorObj.response?.statusText);
      console.log('  Axios error code:', errorObj.code);
      console.log('  Axios error message:', errorObj.message);
    }
  });
  
  console.log('\n✅ Error logging tests completed');
}

// Check if debug log file exists and show recent entries
function checkDebugLogFile() {
  const debugLogFile = path.join(process.cwd(), 'logs', 'market-making-debug.log');
  
  console.log('\n📄 Checking debug log file...');
  console.log('Log file path:', debugLogFile);
  
  if (fs.existsSync(debugLogFile)) {
    const stats = fs.statSync(debugLogFile);
    console.log('File size:', stats.size, 'bytes');
    console.log('Last modified:', stats.mtime);
    
    // Show last few lines
    const content = fs.readFileSync(debugLogFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const lastLines = lines.slice(-5);
    
    console.log('\n📝 Last 5 log entries:');
    lastLines.forEach((line, index) => {
      try {
        const parsed = JSON.parse(line);
        console.log(`${index + 1}. [${parsed.timestamp}] ${parsed.message}`);
        if (parsed.data) {
          console.log('   Data:', JSON.stringify(parsed.data, null, 2));
        }
      } catch (e) {
        console.log(`${index + 1}. ${line}`);
      }
    });
  } else {
    console.log('❌ Debug log file not found');
  }
}

// Run tests
if (require.main === module) {
  testErrorLogging();
  checkDebugLogFile();
}

module.exports = { testErrorLogging, checkDebugLogFile }; 