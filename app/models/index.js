// Central export point for all models
const { sequelize } = require('../database/sequelize');
const GithubUser = require('./GithubUser');
const Repo = require('./Repo');
const Comment = require('./Comment');
const Team = require('./Team');
const TeamMember = require('./TeamMember');

// Export all models and sequelize instance
module.exports = {
  sequelize,
  GithubUser,
  Repo,
  Comment,
  Team,
  TeamMember
};
