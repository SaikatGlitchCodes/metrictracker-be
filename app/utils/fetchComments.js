const supabaseClient = require('../database/connectionDB');
const octokit = require('./Oktokit');

const parseRepoFromUrl = (url) => {
    if (!url) return null;

    const repoMatch = url.match(/github\.hy-vee\.cloud\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch || repoMatch.length < 3) return null;

    return {
        owner: repoMatch[1],
        repo: repoMatch[2]
    };
};

const fetchPaginatedData = async (apiCall, params) => {
    const allData = [];
    let page = 1;
    const perPage = 100;

    try {
        while (true) {
            const response = await apiCall({
                ...params,
                per_page: perPage,
                page: page
            });

            if (!response.data || response.data.length === 0) {
                break;
            }

            allData.push(...response.data);

            // If we got fewer items than requested, we've reached the last page
            if (response.data.length < perPage) {
                break;
            }

            page++;
        }

        return allData;
    } catch (error) {
        throw error;
    }
};

const fetchComments = async(repos) => {

    if (!repos || !Array.isArray(repos)) {
        throw new Error('repos parameter must be an array');
    }

    if (repos.length === 0) {
        return {
            data: {
                issueComments: [],
                reviewComments: [],
            },
            errors: []
        };
    }

    let allIssueComments = [];
    let allReviewComments = [];
    const errors = [];

    for (const pr of repos) {
        try {
            // Validate PR object
            if (!pr || !pr.number) {
                console.warn('Invalid PR object, skipping:', pr);
                errors.push({
                    pr: pr?.number || 'unknown',
                    error: 'Invalid PR object'
                });
                continue;
            }

            // Parse repository info
            const repoInfo = parseRepoFromUrl(pr.repository_url);
            
            if (!repoInfo) {
                console.warn(`Could not parse repository from URL: ${pr.repository_url}`);
                errors.push({
                    pr: pr.number,
                    error: `Invalid repository URL: ${pr.repository_url}`
                });
                continue;
            }

            const { owner, repo } = repoInfo;

            // Fetch issue comments with pagination
            const issueComments = await fetchPaginatedData(
                octokit.rest.issues.listComments,
                {
                    owner,
                    repo,
                    issue_number: pr.number
                }
            );

            // Fetch review comments with pagination
            const reviewComments = await fetchPaginatedData(
                octokit.rest.pulls.listReviewComments,
                {
                    owner,
                    repo,
                    pull_number: pr.number
                }
            );

            // sanitized issue Comments
            const sanitizedIssueComments = issueComments.map(comment => {
                return {
                    type: 'issue',
                    body: comment.body,
                    created_at: comment.created_at,
                    commentor: comment.user.login,
                    commentor_id: comment.user.id,
                    repo_id: pr.repo_id,
                }
            });
            // sanitized review Comments
            const sanitizedReviewComments = reviewComments.map(comment => {
                return {
                    type: 'review',
                    body: comment.body,
                    created_at: comment.created_at,
                    commentor: comment.user.login,
                    commentor_id: comment.user.id,
                    repo_id: pr.repo_id,
                }
            });

            allIssueComments.push(...sanitizedIssueComments);
            allReviewComments.push(...sanitizedReviewComments);

        } catch (error) {
            errors.push({
                pr: pr.number,
                error: error.message || 'Unknown error'
            });
        }
    }

    return {
        data: {
            issueComments: allIssueComments,
            reviewComments: allReviewComments
        },
        errors: errors.length > 0 ? errors : null
    };
}

module.exports = fetchComments;