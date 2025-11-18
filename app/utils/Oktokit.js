const { Octokit } = require("@octokit/rest");
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    baseUrl: process.env.BASE_URL,
});

module.exports = octokit;