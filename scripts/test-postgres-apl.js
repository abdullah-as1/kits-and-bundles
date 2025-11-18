const { PostgresAPL } = require('../src/lib/postgres-apl');

async function testPostgresAPL() {
  console.log('Testing PostgreSQL APL...');
  
  const apl = new PostgresAPL('test-app');
  
  try {
    // Test configuration check
    const configResult = await apl.isConfigured();
    console.log('Configuration check:', configResult);
    
    if (!configResult.configured) {
      console.error('APL not configured:', configResult.error.message);
      return;
    }
    
    // Test readiness check
    const readyResult = await apl.isReady();
    console.log('Readiness check:', readyResult);
    
    if (!readyResult.ready) {
      console.error('APL not ready:', readyResult.error.message);
      return;
    }
    
    // Test data operations
    const testAuthData = {
      token: 'test-token-123',
      saleorApiUrl: 'https://test.saleor.cloud/graphql/',
      appId: 'test-app-id',
      jwks: '{"keys":[]}'
    };
    
    console.log('Setting test auth data...');
    await apl.set(testAuthData);
    
    console.log('Getting test auth data...');
    const retrieved = await apl.get(testAuthData.saleorApiUrl);
    console.log('Retrieved:', retrieved);
    
    console.log('Getting all auth data...');
    const all = await apl.getAll();
    console.log('All entries for test-app:', all.length);
    
    console.log('Soft deleting test auth data...');
    await apl.delete(testAuthData.saleorApiUrl);
    
    console.log('Verifying deletion...');
    const afterDelete = await apl.get(testAuthData.saleorApiUrl);
    console.log('After delete (should be undefined):', afterDelete);
    
    console.log('✅ PostgreSQL APL test completed successfully!');
    
  } catch (error) {
    console.error('❌ PostgreSQL APL test failed:', error);
  }
}

testPostgresAPL();
