const { parentPort, workerData } = require('worker_threads');
const fetchComments = require('../utils/fetchComments');
const { createClient } = require('@supabase/supabase-js');


async function processComments() {
    const { prData, supabaseUrl, supabaseKey, github_name, github_id } = workerData;

    try {
        // Initialize Supabase client in worker thread
        const supabase = createClient(supabaseUrl, supabaseKey);

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

            const { error: issueCommentError } = await supabase
                .from('comments')
                .upsert(issueComments);

            if (issueCommentError) {
                throw new Error(`Failed to save issue comments: ${issueCommentError.message}`);
            }
        }

        // Save review comments
        if (reviewComments.length > 0) {
            parentPort.postMessage({ 
                type: 'progress', 
                message: `Saving ${reviewComments.length} review comments` 
            });

            const { error: reviewCommentError } = await supabase
                .from('comments')
                .upsert(reviewComments);

            if (reviewCommentError) {
                throw new Error(`Failed to save review comments: ${reviewCommentError.message}`);
            }
        }

        // Update comments sync timestamp
        const { error: commentsSyncError } = await supabase
            .from('github_users')
            .update({ comments_last_sync: new Date().toISOString() })
            .eq('github_id', github_id);

        if (commentsSyncError) {
            console.error('Failed to update comments_last_sync:', commentsSyncError);
        }

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
    }
}

// Run the worker
processComments();
