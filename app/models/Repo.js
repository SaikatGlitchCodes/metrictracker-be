const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/sequelize');
const GithubUser = require('./GithubUser');

const Repo = sequelize.define('Repo', {
  repo_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'github_users',
      key: 'github_id'
    }
  },
  repository_url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  comments_url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  number: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  state: {
    type: DataTypes.STRING,
    allowNull: true
  },
  label: {
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: true
  },
  total_comments: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  merged_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  draft: {
    type: DataTypes.BOOLEAN,
    allowNull: true
  },
  code_quality: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  logic_functionality: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  performance_security: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  testing_documentation: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ui_ux: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'repos',
  timestamps: false
});

// Define association
Repo.belongsTo(GithubUser, {
  foreignKey: 'user_id',
  targetKey: 'github_id',
  as: 'githubUser'
});

GithubUser.hasMany(Repo, {
  foreignKey: 'user_id',
  sourceKey: 'github_id',
  as: 'repos'
});

module.exports = Repo;
