const octokit = require("./Oktokit");

const getPrs = async (user) => {
    console.log('user', user)
    // DAY-WISE DIFF
    const lastSync = user?.last_sync ? new Date(user.last_sync) : new Date("2025-01-01");
    const diffMs = Date.now() - lastSync.getTime();
    const timeLineDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    console.log('timeLineDays:', timeLineDays);
    console.log('github_name:', user.github_username);

    let repos = [];
    try {
        let page = 1;

        const sinceDate = new Date(Date.now() - timeLineDays * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0];

        console.log('sinceDate', sinceDate)

        while (true) {
            const res = await octokit.search.issuesAndPullRequests({
                q: `author:${user.github_username} is:pr created:>=${sinceDate}`,
                per_page: 100,
                page,
            });

            console.log(res.data.items.length)

            repos = repos.concat(
                res.data.items.map(repo => ({
                    title: repo.title,
                    repo_id: repo.id,
                    repository_url: repo.html_url,
                    comments_url: repo.comments_url,
                    number: repo.number,
                    state: repo.state,
                    user_id: user.github_id,
                    label: null,
                    total_comments: repo.comments,
                    created_at: repo.created_at,
                    closed_at: repo.closed_at,
                    merged_at: repo.pull_request.merged_at,
                    draft: repo.draft
                }))
            );

            if (res.data.items.length < 100) break;
            page++;
        }
    } catch (error) {
        console.log(error)
        return { data: null, error };
    }

    return { data: repos, error: null };
};


module.exports = getPrs;