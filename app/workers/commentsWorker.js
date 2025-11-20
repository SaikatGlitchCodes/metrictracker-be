const { parentPort, workerData } = require('worker_threads');
const fetchComments = require('../utils/fetchComments');
const { Sequelize } = require('sequelize');

async function processComments() {
    const { prData, dbConfig, github_name, github_id } = workerData;

    // Initialize Sequelize in worker thread
    const sequelize = new Sequelize(
        dbConfig.database,
        dbConfig.user,
        dbConfig.password,
        {
            host: dbConfig.host,
            port: dbConfig.port,
            dialect: 'postgres',
            dialectOptions: {
                ssl: {
                    require: true,
                    rejectUnauthorized: false
                }
            },
            logging: false
        }
    );

    // Define models in worker context
    const Comment = sequelize.define('Comment', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        type: { type: Sequelize.TEXT },
        body: { type: Sequelize.TEXT },
        created_at: { type: Sequelize.DATE },
        commentor: { type: Sequelize.TEXT },
        commentor_id: { type: Sequelize.INTEGER },
        repo_id: { type: Sequelize.INTEGER, allowNull: false }
    }, { tableName: 'comments', timestamps: false });

    const GithubUser = sequelize.define('GithubUser', {
        id: { type: Sequelize.UUID, primaryKey: true },
        github_username: { type: Sequelize.STRING },
        github_id: { type: Sequelize.INTEGER },
        comments_last_sync: { type: Sequelize.DATE }
    }, { tableName: 'github_users', timestamps: false });

    try {
        await sequelize.authenticate();

        // Send progress update
        parentPort.postMessage({ 
            type: 'progress', 
            message: `Starting to fetch comments for ${prData.length} PRs` 
        });

        // Fetch comments
        const { data: commentData, errors: commentErrors } = await fetchComments(prData);

        if (commentErrors && commentErrors.length > 0) {
            parentPort.postMessage({ 
                type: 'warning', 
                message: `Some comments failed to fetch`,
                errors: commentErrors 
            });
        }

        const { issueComments, reviewComments } = commentData;

        // Save issue comments
        if (issueComments.length > 0) {
            parentPort.postMessage({ 
                type: 'progress', 
                message: `Saving ${issueComments.length} issue comments` 
            });

            await Comment.bulkCreate(issueComments, {
                updateOnDuplicate: ['body', 'commentor', 'commentor_id', 'type', 'created_at']
            });
        }

        // Save review comments
        if (reviewComments.length > 0) {
            parentPort.postMessage({ 
                type: 'progress', 
                message: `Saving ${reviewComments.length} review comments` 
            });

            await Comment.bulkCreate(reviewComments, {
                updateOnDuplicate: ['body', 'commentor', 'commentor_id', 'type', 'created_at']
            });
        }

        // Update comments sync timestamp
        await GithubUser.update(
            { comments_last_sync: new Date() },
            { where: { github_id } }
        );

        // Send success message
        parentPort.postMessage({ 
            type: 'success', 
            message: `Successfully processed ${issueComments.length + reviewComments.length} comments for ${github_name}`,
            data: {
                issueCommentsCount: issueComments.length,
                reviewCommentsCount: reviewComments.length,
                totalComments: issueComments.length + reviewComments.length
            }
        });

    } catch (error) {
        console.error('Error in comments worker:', error);
        parentPort.postMessage({ 
            type: 'error', 
            message: error.message || 'Unknown error in worker thread',
            error: error.stack 
        });
    } finally {
        await sequelize.close();
    }
}

// Run the worker
processComments();
