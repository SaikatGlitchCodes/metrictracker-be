// This file is kept for backwards compatibility
// All database operations should now use Sequelize models
const { sequelize } = require('./sequelize');
const models = require('../models');

// Export for legacy code that still imports this file
module.exports = {
    sequelize,
    ...models
};