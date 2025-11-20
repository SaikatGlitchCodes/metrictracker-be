const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/sequelize');

const GithubUser = sequelize.define('GithubUser', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  github_username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  github_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  display_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  avatar_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  company: {
    type: DataTypes.STRING,
    allowNull: true
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fetched_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  last_sync: {
    type: DataTypes.DATE,
    allowNull: true
  },
  comments_last_sync: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'github_users',
  timestamps: false
});

module.exports = GithubUser;
