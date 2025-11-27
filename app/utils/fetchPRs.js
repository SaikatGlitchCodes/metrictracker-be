const octokit = require("./Oktokit");

const getPrs = async (user, options = {}) => {
    console.log('user', user);
    
    // DAY-WISE DIFF
    const lastSync = user?.last_sync ? new Date(user.last_sync) : new Date("2025-01-01");
    const diffMs = Date.now() - lastSync.getTime();
    const timeLineDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    console.log('timeLineDays:', timeLineDays);
    console.log('github_name:', user.github_username);

    let allRepos = [];
    
    try {
        // Step 1: Fetch newly created PRs since last sync
        let page = 1;
        const sinceDate = new Date(Date.now() - timeLineDays * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0];

        console.log('Fetching PRs created since:', sinceDate);

        while (true) {
            const res = await octokit.search.issuesAndPullRequests({
                q: `author:${user.github_username} is:pr created:>=${sinceDate}`,
                per_page: 100,
                page,
            });

            allRepos = allRepos.concat(res.data.items);

            if (res.data.items.length < 100) break;
            page++;
        }

        // Step 2: Fetch all open PRs (they might have new comments even if created earlier)
        page = 1;
        console.log('Fetching all open PRs for new comments...');

        while (true) {
            const openRes = await octokit.search.issuesAndPullRequests({
                q: `author:${user.github_username} is:pr is:open`,
                per_page: 100,
                page,
            });

            // Merge with existing, avoiding duplicates
            openRes.data.items.forEach(openPR => {
                if (!allRepos.find(pr => pr.id === openPR.id)) {
                    allRepos.push(openPR);
                }
            });

            if (openRes.data.items.length < 100) break;
            page++;
        }

        console.log(`Total PRs to process: ${allRepos.length} (includes open PRs for comment updates)`);

        // Map to database format
        const repos = allRepos.map(repo => ({
            title: repo.title,
            repo_id: repo.id,
            repository_url: repo.html_url,
            comments_url: repo.comments_url,
            number: repo.number,
            state: repo.state,
            user_id: user.github_id,
            label: repo.labels,
            total_comments: repo.comments,
            created_at: repo.created_at,
            closed_at: repo.closed_at,
            merged_at: repo.pull_request?.merged_at,
            draft: repo.draft
        }));

        return { data: repos, error: null };

    } catch (error) {
        console.error('Error fetching PRs:', error);
        return { data: null, error };
    }
};


module.exports = getPrs;