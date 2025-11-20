require('dotenv').config();
const { testConnection } = require('./app/database/sequelize');

async function test() {
    console.log('🔍 Testing PostgreSQL connection...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Port: ${process.env.DB_PORT}`);
    console.log(`Database: ${process.env.DB_NAME || 'postgres'}`);
    console.log(`User: ${process.env.DB_USER}`);
    
    const success = await testConnection();
    
    if (success) {
        console.log('✅ Database connection successful!');
        process.exit(0);
    } else {
        console.log('❌ Database connection failed!');
        process.exit(1);
    }
}

test().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
