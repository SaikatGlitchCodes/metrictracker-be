const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/sequelize');
const Team = require('./Team');
const GithubUser = require('./GithubUser');

const TeamMember = sequelize.define('TeamMember', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  team_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'teams',
      key: 'id'
    }
  },
  github_user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'github_users',
      key: 'id'
    }
  },
  assigned_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  assigned_by: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'team_members',
  timestamps: false
});

// Define associations
TeamMember.belongsTo(Team, {
  foreignKey: 'team_id',
  as: 'team'
});

TeamMember.belongsTo(GithubUser, {
  foreignKey: 'github_user_id',
  as: 'githubUser'
});

Team.hasMany(TeamMember, {
  foreignKey: 'team_id',
  as: 'members'
});

GithubUser.hasMany(TeamMember, {
  foreignKey: 'github_user_id',
  as: 'teamMemberships'
});

module.exports = TeamMember;
