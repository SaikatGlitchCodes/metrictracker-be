const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/sequelize');
const Repo = require('./Repo');

const Comment = sequelize.define('Comment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  type: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  commentor: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  commentor_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  repo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'repos',
      key: 'repo_id'
    }
  }
}, {
  tableName: 'comments',
  timestamps: false
});

// Define association
Comment.belongsTo(Repo, {
  foreignKey: 'repo_id',
  as: 'repo'
});

Repo.hasMany(Comment, {
  foreignKey: 'repo_id',
  as: 'comments'
});

module.exports = Comment;
