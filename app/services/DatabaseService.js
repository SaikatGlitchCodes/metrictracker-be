const { GithubUser, Repo, Comment, Team, TeamMember, sequelize } = require('../models');
const { Op } = require('sequelize');

/**
 * Database helper functions to replace Supabase queries with Sequelize
 */

class DatabaseService {
    // GitHub Users
    static async findUserByGithubName(github_username) {
        return await GithubUser.findOne({
            where: { github_username }
        });
    }

    static async findUserById(id) {
        return await GithubUser.findByPk(id);
    }

    static async findUserByGithubId(github_id) {
        return await GithubUser.findOne({
            where: { github_id }
        });
    }

    static async createOrUpdateUser(userData) {
        const [user, created] = await GithubUser.findOrCreate({
            where: { github_username: userData.github_username },
            defaults: userData
        });
        
        if (!created && userData) {
            await user.update(userData);
        }
        
        return user;
    }

    static async updateUserSyncTimestamp(githubId, field) {
        const updateData = {};
        updateData[field] = new Date();
        
        return await GithubUser.update(
            updateData,
            { where: { github_id: githubId } }
        );
    }

    // Repos (PRs)
    static async upsertRepos(reposData) {
        // Use bulkCreate with updateOnDuplicate
        return await Repo.bulkCreate(reposData, {
            updateOnDuplicate: ['repo_id']
        });
    }

    static async findReposByUserId(githubId, options = {}) {
        const where = { user_id: githubId };
        
        if (options.timeline) {
            const date = this.calculateTimelineDate(options.timeline);
            where.created_at = { [Op.gte]: date };
        }
        
        return await Repo.findAll({
            where,
            order: [['created_at', 'DESC']],
            include: options.includeComments ? [{
                model: Comment,
                as: 'comments'
            }] : []
        });
    }

    static async findRepoById(repoId) {
        return await Repo.findByPk(repoId, {
            include: [{
                model: Comment,
                as: 'comments'
            }]
        });
    }

    static async findRepoByIdAndUserId(id, userId) {
        return await Repo.findOne({
            where: { id, user_id: userId }
        });
    }

    // Comments
    static async upsertComments(commentsData) {
        return await Comment.bulkCreate(commentsData, {
            updateOnDuplicate: ['body', 'commentor', 'commentor_id', 'type', 'created_at'],
            returning: true
        });
    }

    static async findCommentsByRepoId(repoId) {
        return await Comment.findAll({
            where: { repo_id: repoId },
            order: [['created_at', 'DESC']]
        });
    }

    static async findCommentsByRepoIds(repoIds) {
        return await Comment.findAll({
            where: { repo_id: { [Op.in]: repoIds } }
        });
    }

    // Teams
    static async findAllTeams() {
        return await Team.findAll({
            order: [['created_at', 'DESC']]
        });
    }

    static async findTeamById(teamId) {
        return await Team.findByPk(teamId);
    }

    static async createTeam(teamData) {
        return await Team.create(teamData);
    }

    static async findTeamByName(name) {
        return await Team.findOne({
            where: { name }
        });
    }

    static async updateTeamSyncTimestamp(teamId, field) {
        const updateData = {};
        updateData[field] = new Date();
        
        return await Team.update(
            updateData,
            { where: { id: teamId } }
        );
    }

    // Team Members
    static async findTeamMembers(teamId, includeUserDetails = true) {
        const options = {
            where: { team_id: teamId }
        };
        
        if (includeUserDetails) {
            options.include = [{
                model: GithubUser,
                as: 'githubUser'
            }];
        }
        
        return await TeamMember.findAll(options);
    }

    static async addTeamMember(teamId, githubUserId) {
        return await TeamMember.create({
            team_id: teamId,
            github_user_id: githubUserId
        });
    }

    static async removeTeamMember(teamId, githubUserId) {
        return await TeamMember.destroy({
            where: {
                team_id: teamId,
                github_user_id: githubUserId
            }
        });
    }

    static async findTeamsByUserId(userId) {
        return await TeamMember.findAll({
            where: { github_user_id: userId },
            include: [{
                model: Team,
                as: 'team'
            }]
        });
    }

    // Complex queries
    static async getTeamDataWithPRs(teamId, quarter = null, year = null) {
        const teamMembers = await this.findTeamMembers(teamId, true);
        
        const memberData = await Promise.all(teamMembers.map(async (member) => {
            const whereClause = { user_id: member.githubUser.github_id };
            
            if (quarter && year) {
                const { startDate, endDate } = this.calculateQuarterDates(quarter, year);
                whereClause.created_at = {
                    [Op.between]: [startDate, endDate]
                };
            }
            
            const repos = await Repo.findAll({
                where: whereClause,
                include: [{
                    model: Comment,
                    as: 'comments'
                }]
            });
            
            return {
                member: member.githubUser,
                repos
            };
        }));
        
        return memberData;
    }

    // Utility methods
    static calculateTimelineDate(timeline) {
        const now = new Date();
        const timelineMap = {
            'week': 7,
            '2weeks': 14,
            'month': 30,
            '3months': 90,
            '6months': 180,
            'year': 365
        };
        
        const days = timelineMap[timeline] || 30;
        return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    }

    static calculateQuarterDates(quarter, year) {
        const quarterMap = {
            'Q1': { start: 0, end: 2 },
            'Q2': { start: 3, end: 5 },
            'Q3': { start: 6, end: 8 },
            'Q4': { start: 9, end: 11 }
        };
        
        const { start, end } = quarterMap[quarter];
        const startDate = new Date(year, start, 1);
        const endDate = new Date(year, end + 1, 0, 23, 59, 59, 999);
        
        return { startDate, endDate };
    }

    // Raw queries (for complex cases)
    static async executeRawQuery(query, replacements = {}) {
        return await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });
    }
}

module.exports = DatabaseService;
