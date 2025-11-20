const { Sequelize } = require('sequelize');

// Create Sequelize instance with GCP PostgreSQL connection
const sequelize = new Sequelize(
  process.env.DB_NAME || 'metricsTracker',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Set to false as per requirement
      }
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    define: {
      timestamps: true,
      underscored: false,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

// Test connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to PostgreSQL database:', error.message);
    return false;
  }
};

module.exports = { sequelize, testConnection };
