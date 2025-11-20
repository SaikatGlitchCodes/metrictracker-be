const express = require('express');
const router = express.Router();
const DatabaseService = require('../services/DatabaseService');
const { GithubUser, Repo, Comment, Team, TeamMember } = require('../models');
const { Op } = require('sequelize');
const getPrs = require('../utils/fetchPRs');
const { spawnCommentsWorker } = require('../utils/workerManager');

// POST /prs/refresh-prs - Refresh PRs for individual user
router.post('/refresh-prs', async (req, res) => {
    const { github_name } = req.body;

    if (!github_name) {
        return res.status(400).json({
            success: false,
            message: 'github_name is required'
        });
    }

    try {
        const user = await DatabaseService.findUserByGithubName(github_name);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User '${github_name}' not found`
            });
        }
        console.log('Refreshing PRs for user:', github_name, 'with github_id:', user.github_id);
        if (!user.github_id) {
            return res.status(400).json({
                success: false,
                message: `User '${github_name}' does not have a valid github_id`
            });
        }

        // Fetch PRs from GitHub
        const { data: prData, error: prError } = await getPrs(user);

        if (prError) {
            return res.status(500).json({
                success: false,
                message: `Failed to fetch PRs for ${github_name}`,
                error: prError.message || prError
            });
        }

        if (!prData || prData.length === 0) {
            return res.status(200).json({
                success: true,
                message: `No PRs found for ${github_name} in the specified timeline`,
                data: []
            });
        }
        console.log('prData', prData)
        // Upsert PRs to database
        const repoData = await DatabaseService.upsertRepos(prData);
        console.log('REPO DATA', repoData);
        // Update last sync timestamp
        try {
            await DatabaseService.updateUserSyncTimestamp(user.github_id, 'last_sync');
        } catch (syncError) {
            console.error('Failed to update last_sync:', syncError);
        }

        // Spawn worker thread to fetch and save comments asynchronously
        spawnCommentsWorker({
            prData: repoData,
            dbConfig: {
                host: process.env.DB_HOST,
                port: process.env.DB_PORT,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME || 'postgres'
            },
            github_name,
            github_id: user.github_id
        }).then((result) => {
            console.log('Comments worker completed:', result.message);
        }).catch((error) => {
            console.error('Comments worker failed:', error.message);
        });

        return res.status(200).json({
            success: true,
            message: `Successfully refreshed ${repoData?.length || 0} PR(s) for ${github_name}. Comments are being processed in the background.`,
            data: repoData,
            commentsProcessing: true
        });

    } catch (err) {
        console.error('Unexpected error in /refresh-prs:', err);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while refreshing PRs',
            error: err.message || 'Unknown error'
        });
    }
});

// GET /prs/comments-status/:github_name - Check comment sync status
router.get('/comments-status/:github_name', async (req, res) => {
    const { github_name } = req.params;

    try {
        const user = await GithubUser.findOne({
            where: { github_username: github_name },
            attributes: ['last_sync', 'comments_last_sync']
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User '${github_name}' not found`
            });
        }

        const lastSync = user.last_sync ? new Date(user.last_sync) : null;
        const commentsLastSync = user.comments_last_sync ? new Date(user.comments_last_sync) : null;

        let status = 'not_started';
        if (commentsLastSync) {
            if (lastSync && commentsLastSync >= lastSync) {
                status = 'completed';
            } else {
                status = 'processing';
            }
        } else if (lastSync) {
            status = 'processing';
        }

        return res.status(200).json({
            success: true,
            github_name,
            status,
            last_sync: lastSync,
            comments_last_sync: commentsLastSync
        });

    } catch (err) {
        console.error('Error in /comments-status:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while checking comment status',
            error: err.message
        });
    }
});

// GET /prs/user/:github_name - Get user PRs with optional timeline filter
router.get('/user/:github_name', async (req, res) => {
    const { github_name } = req.params;
    const { timeline } = req.query;

    try {
        const user = await DatabaseService.findUserByGithubName(github_name);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User '${github_name}' not found`
            });
        }

        // Build where clause
        const where = { user_id: user.github_id };
        
        if (timeline) {
            const date = DatabaseService.calculateTimelineDate(timeline);
            where.created_at = { [Op.gte]: date };
        }

        // Fetch repos with comments
        const repos = await Repo.findAll({
            where,
            include: [{
                model: Comment,
                as: 'comments'
            }],
            order: [['created_at', 'DESC']]
        });

        // Calculate summary
        const summary = {
            total_prs: repos.length,
            merged_prs: repos.filter(r => r.merged_at).length,
            open_prs: repos.filter(r => r.state === 'open').length,
            closed_prs: repos.filter(r => r.state === 'closed' && !r.merged_at).length,
            total_comments: repos.reduce((sum, r) => sum + (r.comments?.length || 0), 0)
        };

        return res.status(200).json({
            success: true,
            message: 'User data retrieved successfully',
            data: {
                github_name,
                timeline: timeline || 'all',
                summary,
                prs: repos
            }
        });

    } catch (err) {
        console.error('Error in /user/:github_name:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while fetching user data',
            error: err.message
        });
    }
});

// POST /prs/refresh-team-prs - Refresh PRs for entire team
router.post('/refresh-team-prs', async (req, res) => {
    const { team_id } = req.body;

    if (!team_id) {
        return res.status(400).json({
            success: false,
            message: 'team_id is required'
        });
    }

    try {
        const team = await DatabaseService.findTeamById(team_id);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: `Team with ID '${team_id}' not found`
            });
        }

        const teamMembers = await DatabaseService.findTeamMembers(team_id, true);

        if (!teamMembers || teamMembers.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'Team has no members',
                data: {
                    team_id,
                    members_processed: 0,
                    results: []
                }
            });
        }

        const results = [];
        let totalPrsSynced = 0;

        for (const teamMember of teamMembers) {
            const user = teamMember.githubUser;
            
            try {
                // Fetch PRs from GitHub
                const { data: prData, error: prError } = await getPrs(user);

                if (prError || !prData) {
                    results.push({
                        github_name: user.github_username,
                        success: false,
                        error: prError?.message || 'Failed to fetch PRs'
                    });
                    continue;
                }

                // Upsert PRs to database
                const repoData = await DatabaseService.upsertRepos(prData);
                totalPrsSynced += repoData.length;

                // Update last sync timestamp
                await DatabaseService.updateUserSyncTimestamp(user.github_id, 'last_sync');

                // Spawn worker thread for comments
                spawnCommentsWorker({
                    prData: repoData,
                    dbConfig: {
                        host: process.env.DB_HOST,
                        port: process.env.DB_PORT,
                        user: process.env.DB_USER,
                        password: process.env.DB_PASSWORD,
                        database: process.env.DB_NAME || 'postgres'
                    },
                    github_name: user.github_username,
                    github_id: user.github_id
                }).catch(err => console.error(`Comments worker failed for ${user.github_username}:`, err));



                results.push({
                    github_name: user.github_username,
                    success: true,
                    prs_synced: repoData.length
                });

            } catch (memberError) {
                console.error(`Error processing member ${user.github_username}:`, memberError);
                results.push({
                    github_name: user.github_username,
                    success: false,
                    error: memberError.message
                });
            }
        }

        await DatabaseService.updateTeamSyncTimestamp(team_id, 'last_sync');

        return res.status(200).json({
            success: true,
            message: 'Team PR refresh completed',
            data: {
                team_id,
                team_name: team.name,
                members_processed: results.length,
                total_prs_synced: totalPrsSynced,
                results
            }
        });

    } catch (err) {
        console.error('Error in /refresh-team-prs:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while refreshing team PRs',
            error: err.message
        });
    }
});

// GET /prs/team/:team_id - Get team data with optional quarter filter
router.get('/team/:team_id', async (req, res) => {
    const { team_id } = req.params;
    const { quarter, year } = req.query;

    try {
        const team = await DatabaseService.findTeamById(team_id);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: `Team with ID '${team_id}' not found`
            });
        }

        const teamMembers = await DatabaseService.findTeamMembers(team_id, true);

        if (!teamMembers || teamMembers.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'Team has no members',
                data: {
                    team_id,
                    team_name: team.name,
                    quarter: quarter || 'all',
                    year: year || new Date().getFullYear(),
                    summary: {
                        total_members: 0,
                        total_prs: 0,
                        total_comments: 0
                    },
                    memberBreakdown: []
                }
            });
        }

        // Build where clause for repos
        let repoWhere = {};
        if (quarter && year) {
            const { startDate, endDate } = DatabaseService.calculateQuarterDates(quarter, year);
            repoWhere.created_at = { [Op.between]: [startDate, endDate] };
        }

        const memberBreakdown = [];
        let totalPrs = 0;
        let totalComments = 0;

        for (const teamMember of teamMembers) {
            const user = teamMember.githubUser;
            
            const repos = await Repo.findAll({
                where: {
                    user_id: user.github_id,
                    ...repoWhere
                },
                include: [{
                    model: Comment,
                    as: 'comments'
                }],
                order: [['created_at', 'DESC']]
            });

            const prCount = repos.length;
            const commentCount = repos.reduce((sum, repo) => sum + (repo.comments?.length || 0), 0);

            totalPrs += prCount;
            totalComments += commentCount;

            // Group repos by repository name
            const repoGroups = {};
            repos.forEach(repo => {
                const repoName = repo.repository_url?.split('/').slice(-2).join('/') || 'unknown';
                if (!repoGroups[repoName]) {
                    repoGroups[repoName] = {
                        repo_name: repoName,
                        pr_count: 0,
                        comments_received: []
                    };
                }
                repoGroups[repoName].pr_count++;
                if (repo.comments) {
                    repoGroups[repoName].comments_received.push(...repo.comments);
                }
            });

            memberBreakdown.push({
                github_name: user.github_username,
                total_prs: prCount,
                merged_prs: repos.filter(r => r.merged_at).length,
                total_comments: commentCount,
                repos: Object.values(repoGroups)
            });
        }

        // Calculate top performers
        const topPerformers = {
            most_prs: memberBreakdown.reduce((max, m) => m.total_prs > max.total_prs ? m : max, { total_prs: 0 }),
            most_merged: memberBreakdown.reduce((max, m) => m.merged_prs > max.merged_prs ? m : max, { merged_prs: 0 }),
            most_comments: memberBreakdown.reduce((max, m) => m.total_comments > max.total_comments ? m : max, { total_comments: 0 })
        };

        // Calculate overall performance score
        memberBreakdown.forEach(member => {
            const mergeRate = member.total_prs > 0 ? (member.merged_prs / member.total_prs) * 100 : 0;
            member.performance_score = 
                (member.total_prs * 2) + 
                (member.merged_prs * 3) + 
                (member.total_comments * 1) + 
                (mergeRate * 2);
        });

        topPerformers.overall = memberBreakdown.reduce((max, m) => 
            m.performance_score > (max.performance_score || 0) ? m : max, 
            { performance_score: 0 }
        );

        return res.status(200).json({
            success: true,
            message: 'Team data retrieved successfully',
            data: {
                team_id,
                team_name: team.name,
                quarter: quarter || 'all',
                year: year || new Date().getFullYear(),
                summary: {
                    total_members: teamMembers.length,
                    total_prs: totalPrs,
                    total_comments: totalComments
                },
                memberBreakdown,
                topPerformers
            }
        });

    } catch (err) {
        console.error('Error in /team/:team_id:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while fetching team data',
            error: err.message
        });
    }
});

// GET /prs/team-status/:team_id - Check comment sync status for team
router.get('/team-status/:team_id', async (req, res) => {
    const { team_id } = req.params;

    try {
        const team = await DatabaseService.findTeamById(team_id);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: `Team with ID '${team_id}' not found`
            });
        }

        const teamMembers = await DatabaseService.findTeamMembers(team_id, true);

        const memberStatuses = teamMembers.map(tm => {
            const user = tm.githubUser;
            const lastSync = user.last_sync ? new Date(user.last_sync) : null;
            const commentsLastSync = user.comments_last_sync ? new Date(user.comments_last_sync) : null;

            let status = 'not_started';
            if (commentsLastSync) {
                if (lastSync && commentsLastSync >= lastSync) {
                    status = 'completed';
                } else {
                    status = 'processing';
                }
            } else if (lastSync) {
                status = 'processing';
            }

            return {
                github_name: user.github_username,
                status,
                last_sync: lastSync,
                comments_last_sync: commentsLastSync
            };
        });

        return res.status(200).json({
            success: true,
            message: 'Team sync status retrieved',
            data: {
                team_id,
                team_name: team.name,
                members: memberStatuses
            }
        });

    } catch (err) {
        console.error('Error in /team-status:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while checking team status',
            error: err.message
        });
    }
});

// GET /prs/comment-analysis/:teamId - Quarterly comment analysis
router.get('/comment-analysis/:teamId', async (req, res) => {
    const { teamId } = req.params;
    const { quarter, year } = req.query;

    try {
        const team = await DatabaseService.findTeamById(teamId);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: `Team with ID '${teamId}' not found`
            });
        }

        const currentYear = year || new Date().getFullYear();
        const currentQuarter = quarter || `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`;

        const { startDate, endDate } = DatabaseService.calculateQuarterDates(currentQuarter, currentYear);

        const teamMembers = await DatabaseService.findTeamMembers(teamId, true);
        const teamGithubIds = teamMembers.map(tm => tm.githubUser.github_id);

        const memberAnalysis = [];

        for (const teamMember of teamMembers) {
            const user = teamMember.githubUser;

            // Get user's PRs in the quarter
            const repos = await Repo.findAll({
                where: {
                    user_id: user.github_id,
                    created_at: { [Op.between]: [startDate, endDate] }
                },
                include: [{
                    model: Comment,
                    as: 'comments'
                }]
            });

            let commentsFromOwnTeam = 0;
            let commentsFromComparisonTeam = 0;
            let externalComments = 0;

            repos.forEach(repo => {
                if (repo.comments) {
                    repo.comments.forEach(comment => {
                        if (comment.commentor_id) {
                            if (teamGithubIds.includes(comment.commentor_id)) {
                                commentsFromOwnTeam++;
                            } else {
                                commentsFromComparisonTeam++;
                            }
                        } else {
                            externalComments++;
                        }
                    });
                }
            });

            memberAnalysis.push({
                github_name: user.github_username,
                total_prs: repos.length,
                comments_from_own_team: commentsFromOwnTeam,
                comments_from_comparison_team: commentsFromComparisonTeam,
                external_comments: externalComments,
                total_comments: commentsFromOwnTeam + commentsFromComparisonTeam + externalComments
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                teamId,
                team_name: team.name,
                quarter: currentQuarter,
                year: currentYear,
                members: memberAnalysis
            }
        });

    } catch (err) {
        console.error('Error in /comment-analysis:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during comment analysis',
            error: err.message
        });
    }
});

module.exports = router;
