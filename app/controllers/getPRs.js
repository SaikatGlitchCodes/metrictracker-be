const express = require('express');
const router = express.Router();
const supabaseClient = require('../database/connectionDB');
const getPrs = require('../utils/fetchPRs');
const { spawnCommentsWorker } = require('../utils/workerManager');

router.post('/refresh-prs', async (req, res) => {
    const { github_name } = req.body;

    // Input validation
    if (!github_name) {
        return res.status(400).json({ 
            success: false, 
            message: 'github_name is required' 
        });
    }

    try {
        // Fetch user from database
        const { data: user, error: userError } = await supabaseClient
            .from('github_users')
            .select('*')
            .eq('github_username', github_name)
            .single();

        if (userError || !user) {
            return res.status(404).json({ 
                success: false, 
                message: `User '${github_name}' not found`,
                error: userError?.message 
            });
        }

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

        // Upsert PRs to database first
        const { data: repoData, error: upsertError } = await supabaseClient
            .from('repos')
            .upsert(prData)
            .select();

        if (upsertError) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to save PRs to database',
                error: upsertError.message 
            });
        }

        // Update last sync timestamp
        const { error: syncError } = await supabaseClient
            .from('github_users')
            .update({ last_sync: new Date().toISOString() })
            .eq('github_id', user.github_id);

        if (syncError) {
            console.error('Failed to update last_sync:', syncError);
        }

        // Spawn worker thread to fetch and save comments asynchronously
        // This won't block the response
        spawnCommentsWorker({
            prData: repoData,
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY,
            github_name,
            github_id: user.github_id
        }).then((result) => {
            console.log('Comments worker completed:', result.message);
        }).catch((error) => {
            console.error('Comments worker failed:', error.message);
        });

        // Return immediately without waiting for comments
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
})

router.get('/comments-status/:github_name', async (req, res) => {
    const { github_name } = req.params;

    try {
        const { data: user, error: userError } = await supabaseClient
            .from('github_users')
            .select('last_sync, comments_last_sync')
            .eq('github_username', github_name)
            .single();

        if (userError || !user) {
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
        console.error('Error checking comments status:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to check comments status',
            error: err.message 
        });
    }
});

router.post('/refresh-team-prs', async (req, res) => {
    const { team_id } = req.body;

    // Input validation
    if (!team_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'team_id is required' 
        });
    }

    try {
        // Fetch team details
        const { data: team, error: teamError } = await supabaseClient
            .from('teams')
            .select('*')
            .eq('id', team_id)
            .single();

        if (teamError || !team) {
            return res.status(404).json({ 
                success: false, 
                message: `Team with id '${team_id}' not found`,
                error: teamError?.message 
            });
        }

        // Fetch all team members with their github user details
        const { data: teamMembers, error: membersError } = await supabaseClient
            .from('team_members')
            .select(`
                *,
                github_user:github_users(*)
            `)
            .eq('team_id', team_id);

        if (membersError) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch team members',
                error: membersError.message 
            });
        }

        if (!teamMembers || teamMembers.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: `No members found in team '${team.name}'`,
                data: {
                    team: team.name,
                    membersProcessed: 0,
                    results: []
                }
            });
        }

        console.log(`Starting PR refresh for team '${team.name}' with ${teamMembers.length} members`);

        // Process each team member
        const results = [];
        let totalPRs = 0;
        let successCount = 0;
        let failureCount = 0;

        for (const member of teamMembers) {
            const user = member.github_user;

            if (!user || !user.github_id) {
                console.warn(`Skipping member - invalid github_user data:`, member);
                results.push({
                    github_username: user?.github_username || 'unknown',
                    success: false,
                    error: 'Invalid github_user data',
                    prs: 0
                });
                failureCount++;
                continue;
            }

            try {
                console.log(`Processing PRs for ${user.github_username}...`);

                // Fetch PRs from GitHub
                const { data: prData, error: prError } = await getPrs(user);

                if (prError) {
                    console.error(`Failed to fetch PRs for ${user.github_username}:`, prError);
                    results.push({
                        github_username: user.github_username,
                        success: false,
                        error: prError.message || 'Failed to fetch PRs',
                        prs: 0
                    });
                    failureCount++;
                    continue;
                }

                if (!prData || prData.length === 0) {
                    console.log(`No PRs found for ${user.github_username}`);
                    results.push({
                        github_username: user.github_username,
                        success: true,
                        message: 'No PRs found',
                        prs: 0
                    });
                    successCount++;
                    continue;
                }

                // Upsert PRs to database
                const { data: repoData, error: upsertError } = await supabaseClient
                    .from('repos')
                    .upsert(prData)
                    .select();

                if (upsertError) {
                    console.error(`Failed to save PRs for ${user.github_username}:`, upsertError);
                    results.push({
                        github_username: user.github_username,
                        success: false,
                        error: upsertError.message,
                        prs: 0
                    });
                    failureCount++;
                    continue;
                }

                // Update last sync timestamp
                const { error: syncError } = await supabaseClient
                    .from('github_users')
                    .update({ last_sync: new Date().toISOString() })
                    .eq('github_id', user.github_id);

                if (syncError) {
                    console.error(`Failed to update last_sync for ${user.github_username}:`, syncError);
                }

                // Spawn worker thread to fetch and save comments asynchronously
                spawnCommentsWorker({
                    prData: repoData,
                    supabaseUrl: process.env.SUPABASE_URL,
                    supabaseKey: process.env.SUPABASE_KEY,
                    github_name: user.github_username,
                    github_id: user.github_id
                }).then((result) => {
                    console.log(`Comments worker completed for ${user.github_username}:`, result.message);
                }).catch((error) => {
                    console.error(`Comments worker failed for ${user.github_username}:`, error.message);
                });

                const prCount = repoData?.length || 0;
                totalPRs += prCount;
                successCount++;

                results.push({
                    github_username: user.github_username,
                    success: true,
                    message: `Refreshed ${prCount} PR(s)`,
                    prs: prCount,
                    commentsProcessing: true
                });

                console.log(`✓ Successfully processed ${prCount} PRs for ${user.github_username}`);

            } catch (err) {
                console.error(`Unexpected error processing ${user.github_username}:`, err);
                results.push({
                    github_username: user.github_username,
                    success: false,
                    error: err.message || 'Unknown error',
                    prs: 0
                });
                failureCount++;
            }
        }

        const {data, error} = supabaseClient.from('teams')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', team_id);

        if (error) {
            console.error(`Failed to update last_sync for team ${team.name}:`, error);
        }

        if(data){
            console.log(`Updated last_sync for team '${team.name}'`);
        }

        return res.status(200).json({ 
            success: true, 
            message: `Team '${team.name}' PR refresh completed. ${successCount} succeeded, ${failureCount} failed.`,
            data: {
                team: team.name,
                team_id: team.id,
                membersProcessed: teamMembers.length,
                successCount,
                failureCount,
                totalPRs,
                results,
                commentsProcessing: true
            }
        });

    } catch (err) {
        console.error('Unexpected error in /refresh-team-prs:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'An unexpected error occurred while refreshing team PRs',
            error: err.message || 'Unknown error' 
        });
    }
});

router.get('/team-status/:team_id', async (req, res) => {
    const { team_id } = req.params;

    try {
        // Fetch team details
        const { data: team, error: teamError } = await supabaseClient
            .from('teams')
            .select('*')
            .eq('id', team_id)
            .single();

        if (teamError || !team) {
            return res.status(404).json({ 
                success: false, 
                message: `Team with id '${team_id}' not found` 
            });
        }

        // Fetch all team members with their sync status
        const { data: teamMembers, error: membersError } = await supabaseClient
            .from('team_members')
            .select(`
                *,
                github_user:github_users(
                    github_username,
                    last_sync,
                    comments_last_sync
                )
            `)
            .eq('team_id', team_id);

        if (membersError) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch team members',
                error: membersError.message 
            });
        }

        const memberStatuses = teamMembers.map(member => {
            const user = member.github_user;
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
                github_username: user.github_username,
                status,
                last_sync: lastSync,
                comments_last_sync: commentsLastSync
            };
        });

        const statusCounts = {
            completed: memberStatuses.filter(m => m.status === 'completed').length,
            processing: memberStatuses.filter(m => m.status === 'processing').length,
            not_started: memberStatuses.filter(m => m.status === 'not_started').length
        };

        return res.status(200).json({
            success: true,
            team: team.name,
            team_id: team.id,
            totalMembers: teamMembers.length,
            statusCounts,
            members: memberStatuses
        });

    } catch (err) {
        console.error('Error checking team status:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to check team status',
            error: err.message 
        });
    }
});


// GET route for individual user's PRs and comments with timeline filter
router.get('/user/:github_name', async (req, res) => {
    const { github_name } = req.params;
    const { timeline, start_date, end_date } = req.query;
    console.log("timeline", timeline)
    try {
        // Fetch user from database
        const { data: user, error: userError } = await supabaseClient
            .from('github_users')
            .select('*')
            .eq('github_username', github_name)
            .single();

        if (userError || !user) {
            return res.status(404).json({ 
                success: false, 
                message: `User '${github_name}' not found`,
                error: userError?.message 
            });
        }

        // Calculate date range based on timeline
        let startDate, endDate;
        const now = new Date();

        if (start_date && end_date) {
            // Custom date range
            startDate = new Date(start_date);
            endDate = new Date(end_date);
        } else if (timeline) {
            // Predefined timeline
            switch (timeline.toLowerCase()) {
                case 'week':
                case '1week':
                    startDate = new Date(now.setDate(now.getDate() - 7));
                    endDate = new Date();
                    break;
                case '2weeks':
                    startDate = new Date(now.setDate(now.getDate() - 14));
                    endDate = new Date();
                    break;
                case 'month':
                case '1month':
                    startDate = new Date(now.setMonth(now.getMonth() - 1));
                    endDate = new Date();
                    break;
                case '3months':
                    startDate = new Date(now.setMonth(now.getMonth() - 3));
                    endDate = new Date();
                    break;
                case '6months':
                    startDate = new Date(now.setMonth(now.getMonth() - 6));
                    endDate = new Date();
                    break;
                case 'year':
                case '1year':
                    startDate = new Date(now.setFullYear(now.getFullYear() - 1));
                    endDate = new Date();
                    break;
                default:
                    // Default to last month if invalid timeline
                    startDate = new Date(now.setMonth(now.getMonth() - 1));
                    endDate = new Date();
            }
        } else {
            // Default to last month
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            endDate = new Date();
        }

        // Fetch PRs for the user within the date range
        let prQuery = supabaseClient
            .from('repos')
            .select('*')
            .eq('user_id', user.github_id)
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString())
            .order('created_at', { ascending: false });

        const { data: prs, error: prError } = await prQuery;

        if (prError) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch PRs',
                error: prError.message 
            });
        }

        // Fetch comments for the user's PRs
        const prIds = prs.map(pr => pr.repo_id);
        
        let comments = [];
        if (prIds.length > 0) {
            const { data: commentsData, error: commentsError } = await supabaseClient
                .from('comments')
                .select('*')
                .in('repo_id', prIds)
                .gte('created_at', startDate.toISOString())
                .lte('created_at', endDate.toISOString())
                .order('created_at', { ascending: false });

            if (commentsError) {
                console.error('Error fetching comments:', commentsError);
            } else {
                comments = commentsData || [];
            }
        }

        // Calculate statistics
        const stats = {
            totalPRs: prs.length,
            openPRs: prs.filter(pr => pr.state === 'open').length,
            closedPRs: prs.filter(pr => pr.state === 'closed').length,
            mergedPRs: prs.filter(pr => pr.merged_at).length,
            draftPRs: prs.filter(pr => pr.draft).length,
            totalComments: comments.length,
            issueComments: comments.filter(c => c.type === 'issue').length,
            reviewComments: comments.filter(c => c.type === 'review').length
        };

        return res.status(200).json({
            success: true,
            user: {
                github_username: user.github_username,
                github_id: user.github_id,
                display_name: user.display_name,
                avatar_url: user.avatar_url
            },
            timeline: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                filter: timeline || 'custom'
            },
            stats,
            data: {
                prs,
                comments
            }
        });

    } catch (err) {
        console.error('Error fetching user data:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch user data',
            error: err.message 
        });
    }
});

// GET route for team's PRs and comments with quarter-based timeline filter
router.get('/team/:team_id', async (req, res) => {
    const { team_id } = req.params;
    const { quarter, year, start_date, end_date } = req.query;

    try {
        // Fetch team details
        const { data: team, error: teamError } = await supabaseClient
            .from('teams')
            .select('*')
            .eq('id', team_id)
            .single();

        if (teamError || !team) {
            return res.status(404).json({ 
                success: false, 
                message: `Team with id '${team_id}' not found`,
                error: teamError?.message 
            });
        }

        // Fetch all team members
        const { data: teamMembers, error: membersError } = await supabaseClient
            .from('team_members')
            .select(`
                *,
                github_user:github_users(*)
            `)
            .eq('team_id', team_id);

        if (membersError) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch team members',
                error: membersError.message 
            });
        }

        if (!teamMembers || teamMembers.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: `No members found in team '${team.name}'`,
                team: {
                    id: team.id,
                    name: team.name
                },
                stats: {},
                data: {
                    prs: [],
                    comments: [],
                    memberBreakdown: []
                }
            });
        }

        // Calculate date range based on quarter or custom dates
        let startDate, endDate;
        const currentYear = new Date().getFullYear();
        const targetYear = year ? parseInt(year) : currentYear;

        if (start_date && end_date) {
            // Custom date range
            startDate = new Date(start_date);
            endDate = new Date(end_date);
        } else if (quarter) {
            // Quarter-based timeline
            const q = parseInt(quarter);
            if (q < 1 || q > 4) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Quarter must be between 1 and 4' 
                });
            }

            // Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec
            const quarterStartMonth = (q - 1) * 3;
            startDate = new Date(targetYear, quarterStartMonth, 1);
            endDate = new Date(targetYear, quarterStartMonth + 3, 0, 23, 59, 59, 999);
        } else {
            // Default to current quarter
            const currentMonth = new Date().getMonth();
            const currentQuarter = Math.floor(currentMonth / 3) + 1;
            const quarterStartMonth = (currentQuarter - 1) * 3;
            startDate = new Date(targetYear, quarterStartMonth, 1);
            endDate = new Date(targetYear, quarterStartMonth + 3, 0, 23, 59, 59, 999);
        }

        // Get all github_ids for team members
        const githubIds = teamMembers
            .map(m => m.github_user?.github_id)
            .filter(id => id !== null && id !== undefined);

        if (githubIds.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: 'No valid github users found in team',
                team: {
                    id: team.id,
                    name: team.name
                },
                stats: {},
                data: {
                    prs: [],
                    comments: [],
                    memberBreakdown: []
                }
            });
        }

        // Fetch all PRs for team members within the date range
        const { data: prs, error: prError } = await supabaseClient
            .from('repos')
            .select('*')
            .in('user_id', githubIds)
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString())
            .order('created_at', { ascending: false });

        if (prError) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch team PRs',
                error: prError.message 
            });
        }

        // Fetch comments for team PRs
        const prIds = prs?.map(pr => pr.repo_id) || [];
        
        let comments = [];
        if (prIds.length > 0) {
            const { data: commentsData, error: commentsError } = await supabaseClient
                .from('comments')
                .select('*')
                .in('repo_id', prIds)
                .gte('created_at', startDate.toISOString())
                .lte('created_at', endDate.toISOString())
                .order('created_at', { ascending: false });

            if (commentsError) {
                console.error('Error fetching team comments:', commentsError);
            } else {
                comments = commentsData || [];
            }
        }

        // Calculate per-member breakdown with repos and their comments
        const memberBreakdown = teamMembers.map(member => {
            const user = member.github_user;
            if (!user || !user.github_id) {
                return {
                    github_username: 'unknown',
                    display_name: null,
                    avatar_url: null,
                    totalPRs: 0,
                    totalComments: 0,
                    repos: []
                };
            }

            // Get all PRs for this member
            const memberPRs = prs.filter(pr => pr.user_id === user.github_id);

            // Map each PR with its comments
            const reposWithComments = memberPRs.map(pr => {
                const prComments = comments.filter(c => c.repo_id === pr.repo_id);

                return {
                    repo_id: pr.repo_id,
                    title: pr.title,
                    number: pr.number,
                    state: pr.state,
                    draft: pr.draft,
                    created_at: pr.created_at,
                    merged_at: pr.merged_at,
                    closed_at: pr.closed_at,
                    repository_url: pr.repository_url,
                    total_comments: pr.total_comments,
                    label: pr.label,
                    code_quality: pr.code_quality,
                    logic_functionality: pr.logic_functionality,
                    performance_security: pr.performance_security,
                    testing_documentation: pr.testing_documentation,
                    ui_ux: pr.ui_ux,
                    comments: prComments.map(comment => ({
                        id: comment.id,
                        type: comment.type,
                        body: comment.body,
                        created_at: comment.created_at,
                        commentor: comment.commentor,
                        commentor_id: comment.commentor_id
                    })),
                    commentCount: prComments.length,
                    issueComments: prComments.filter(c => c.type === 'issue').length,
                    reviewComments: prComments.filter(c => c.type === 'review').length
                };
            });

            // Calculate member totals
            const totalComments = reposWithComments.reduce((sum, repo) => sum + repo.commentCount, 0);

            return {
                github_username: user.github_username,
                display_name: user.display_name,
                avatar_url: user.avatar_url,
                totalPRs: memberPRs.length,
                totalComments: totalComments,
                openPRs: memberPRs.filter(pr => pr.state === 'open').length,
                mergedPRs: memberPRs.filter(pr => pr.merged_at).length,
                closedPRs: memberPRs.filter(pr => pr.state === 'closed').length,
                draftPRs: memberPRs.filter(pr => pr.draft).length,
                repos: reposWithComments
            };
        });

        // Calculate team statistics
        const stats = {
            totalMembers: teamMembers.length,
            totalPRs: prs.length,
            openPRs: prs.filter(pr => pr.state === 'open').length,
            closedPRs: prs.filter(pr => pr.state === 'closed').length,
            mergedPRs: prs.filter(pr => pr.merged_at).length,
            draftPRs: prs.filter(pr => pr.draft).length,
            totalComments: comments.length,
            issueComments: comments.filter(c => c.type === 'issue').length,
            reviewComments: comments.filter(c => c.type === 'review').length,
            avgPRsPerMember: teamMembers.length > 0 ? (prs.length / teamMembers.length).toFixed(2) : 0,
            avgCommentsPerPR: prs.length > 0 ? (comments.length / prs.length).toFixed(2) : 0
        };

        // Calculate top performers with comprehensive scoring
        const performersWithScores = memberBreakdown
            .filter(m => m.github_username !== 'unknown')
            .map(m => {
                // Calculate average scores across all quality metrics
                const avgCodeQuality = m.repos.length > 0
                    ? m.repos.reduce((sum, repo) => sum + (repo.code_quality || 0), 0) / m.repos.length
                    : 0;
                
                const avgLogicFunctionality = m.repos.length > 0
                    ? m.repos.reduce((sum, repo) => sum + (repo.logic_functionality || 0), 0) / m.repos.length
                    : 0;
                
                const avgPerformanceSecurity = m.repos.length > 0
                    ? m.repos.reduce((sum, repo) => sum + (repo.performance_security || 0), 0) / m.repos.length
                    : 0;
                
                const avgTestingDocumentation = m.repos.length > 0
                    ? m.repos.reduce((sum, repo) => sum + (repo.testing_documentation || 0), 0) / m.repos.length
                    : 0;
                
                const avgUiUx = m.repos.length > 0
                    ? m.repos.reduce((sum, repo) => sum + (repo.ui_ux || 0), 0) / m.repos.length
                    : 0;

                // Calculate merge rate (percentage of PRs that got merged)
                const mergeRate = m.totalPRs > 0 ? (m.mergedPRs / m.totalPRs) * 100 : 0;

                // Calculate engagement score (comments per PR)
                const engagementScore = m.totalPRs > 0 ? m.totalComments / m.totalPRs : 0;

                // Overall quality score (average of all quality metrics)
                const overallQualityScore = (
                    avgCodeQuality + 
                    avgLogicFunctionality + 
                    avgPerformanceSecurity + 
                    avgTestingDocumentation + 
                    avgUiUx
                ) / 5;

                // Comprehensive performance score with weighted factors:
                // - Total PRs (20%): Productivity
                // - Merged PRs (25%): Success rate
                // - Merge Rate (20%): Efficiency
                // - Overall Quality Score (25%): Code quality
                // - Engagement Score (10%): Collaboration
                const maxPRs = Math.max(...memberBreakdown.map(m => m.totalPRs));
                const maxMergedPRs = Math.max(...memberBreakdown.map(m => m.mergedPRs));
                const maxComments = Math.max(...memberBreakdown.map(m => m.totalComments));

                const normalizedPRs = maxPRs > 0 ? (m.totalPRs / maxPRs) * 100 : 0;
                const normalizedMergedPRs = maxMergedPRs > 0 ? (m.mergedPRs / maxMergedPRs) * 100 : 0;
                const normalizedQuality = (overallQualityScore / 5) * 100;
                const normalizedEngagement = maxComments > 0 ? (m.totalComments / maxComments) * 100 : 0;

                const performanceScore = (
                    (normalizedPRs * 0.20) +           // 20% weight for total PRs
                    (normalizedMergedPRs * 0.25) +     // 25% weight for merged PRs
                    (mergeRate * 0.20) +               // 20% weight for merge rate
                    (normalizedQuality * 0.25) +       // 25% weight for quality
                    (normalizedEngagement * 0.10)      // 10% weight for engagement
                );

                return {
                    github_username: m.github_username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    performanceScore: parseFloat(performanceScore.toFixed(2)),
                    metrics: {
                        totalPRs: m.totalPRs,
                        mergedPRs: m.mergedPRs,
                        mergeRate: parseFloat(mergeRate.toFixed(2)),
                        totalComments: m.totalComments,
                        engagementScore: parseFloat(engagementScore.toFixed(2)),
                        qualityScores: {
                            codeQuality: parseFloat(avgCodeQuality.toFixed(2)),
                            logicFunctionality: parseFloat(avgLogicFunctionality.toFixed(2)),
                            performanceSecurity: parseFloat(avgPerformanceSecurity.toFixed(2)),
                            testingDocumentation: parseFloat(avgTestingDocumentation.toFixed(2)),
                            uiUx: parseFloat(avgUiUx.toFixed(2)),
                            overall: parseFloat(overallQualityScore.toFixed(2))
                        }
                    }
                };
            })
            .sort((a, b) => b.performanceScore - a.performanceScore);

        // Top 3 performers overall
        const topPerformers = {
            overall: performersWithScores.slice(0, 3),
            
            byPRs: [...memberBreakdown]
                .filter(m => m.github_username !== 'unknown')
                .sort((a, b) => b.totalPRs - a.totalPRs)
                .slice(0, 3)
                .map(m => ({
                    github_username: m.github_username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    count: m.totalPRs,
                    mergedPRs: m.mergedPRs
                })),
            
            byMergedPRs: [...memberBreakdown]
                .filter(m => m.github_username !== 'unknown')
                .sort((a, b) => b.mergedPRs - a.mergedPRs)
                .slice(0, 3)
                .map(m => ({
                    github_username: m.github_username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    count: m.mergedPRs,
                    totalPRs: m.totalPRs
                })),
            
            byComments: [...memberBreakdown]
                .filter(m => m.github_username !== 'unknown')
                .sort((a, b) => b.totalComments - a.totalComments)
                .slice(0, 3)
                .map(m => ({
                    github_username: m.github_username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    count: m.totalComments,
                    totalPRs: m.totalPRs
                })),
            
            byCodeQuality: performersWithScores
                .sort((a, b) => b.metrics.qualityScores.overall - a.metrics.qualityScores.overall)
                .slice(0, 3)
                .map(m => ({
                    github_username: m.github_username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    avgScore: m.metrics.qualityScores.overall,
                    totalPRs: m.metrics.totalPRs
                }))
        };

        return res.status(200).json({
            success: true,
            team: {
                id: team.id,
                name: team.name,
                description: team.description
            },
            timeline: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                quarter: quarter || Math.floor(new Date().getMonth() / 3) + 1,
                year: targetYear
            },
            stats,
            topPerformers,
            data: {
                memberBreakdown
            }
        });

    } catch (err) {
        console.error('Error fetching team data:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch team data',
            error: err.message 
        });
    }
});


module.exports = router;