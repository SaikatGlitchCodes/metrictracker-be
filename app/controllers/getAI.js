const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabaseClient = require('../database/connectionDB');

if (!process.env.GEMINI_URL) {
    console.error('⚠️  GEMINI_URL not set in environment variables');
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_URL);

router.post('/analyze-repo', async (req, res) => {
    const { repo_id } = req.body;
    if (!repo_id) {
        return res.status(400).json({
            success: false,
            message: 'repo_id is required'
        });
    }

    try {
        // Fetch repo details
        const { data: repo, error: repoError } = await supabaseClient
            .from('repos')
            .select('*')
            .eq('repo_id', repo_id)
            .single();

        if (repoError || !repo) {
            return res.status(404).json({
                success: false,
                message: `Repo with id ${repo_id} not found`,
                error: repoError?.message
            });
        }

        // Fetch comments for this repo
        const { data: comments, error: commentsError } = await supabaseClient
            .from('comments')
            .select('id, type, body, commentor, created_at')
            .eq('repo_id', repo.repo_id);

        if (commentsError) {
            console.error('Error fetching comments:', commentsError);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch comments',
                error: commentsError.message
            });
        }

        if (!comments || comments.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No comments to analyze',
                data: {
                    repo_id,
                    title: repo.title,
                    total_comments: 0,
                    analysis: {
                        code_quality: 0,
                        logic_functionality: 0,
                        performance_security: 0,
                        testing_documentation: 0
                    }
                }
            });
        }

        // Prepare comments text for analysis
        const commentsText = comments.map(c => {
            const commentType = c.type || 'general';
            const commentBody = c.body || '';
            const commentor = c.commentor || 'unknown';
            return `[${commentType}] ${commentor}: ${commentBody}`;
        }).join('\n\n');

        // Create the prompt for Gemini
        const prompt = `
You are a code review expert. Analyze the following pull request comments and provide:

1. Scores (0-10) for these categories:
   - Code Quality: code structure, naming, readability, maintainability
   - Logic/Functionality: correctness, business logic, edge cases
   - Performance/Security: optimizations, vulnerabilities, best practices
   - Testing/Documentation: test coverage, documentation quality

2. Classify each comment into ONE of these categories:
   - code_quality: Comments about code structure, naming, style, readability
   - logic_functionality: Comments about business logic, functionality, bugs
   - performance_security: Comments about performance, security, optimizations
   - testing_documentation: Comments about tests, documentation, examples
   - repeated_comments: Duplicate or similar comments (same issue mentioned multiple times)
   - comments_that_can_be_ignored: Minor typos, formatting only, off-topic, "+1", "LGTM" without context

Pull Request Title: ${repo.title}
Total Comments: ${comments.length}

Comments:
${commentsText}

Analyze and respond ONLY with a valid JSON object (no markdown, no code blocks):
{
  "scores": {
    "code_quality": <number 0-10>,
    "logic_functionality": <number 0-10>,
    "performance_security": <number 0-10>,
    "testing_documentation": <number 0-10>
  },
  "comment_classification": {
    "code_quality": <count>,
    "logic_functionality": <count>,
    "performance_security": <count>,
    "testing_documentation": <count>,
    "repeated_comments": <count>,
    "comments_that_can_be_ignored": <count>
  },
  "reasoning": {
    "code_quality": "<brief explanation>",
    "logic_functionality": "<brief explanation>",
    "performance_security": "<brief explanation>",
    "testing_documentation": "<brief explanation>"
  }
}`;

        console.log('🤖 Sending request to Gemini AI...');

        // Call Gemini API - using gemini-2.5-flash (available model)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiResponse = response.text();

        console.log('🤖 Gemini AI response received');

        // Parse the AI response
        let analysis;
        try {
            // Remove markdown code blocks if present
            const cleanedResponse = aiResponse
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
            
            analysis = JSON.parse(cleanedResponse);
        } catch (parseError) {
            console.error('Failed to parse AI response:', aiResponse);
            throw new Error('AI response format invalid');
        }

        // Validate scores are within range
        const scores = {
            code_quality: Math.max(0, Math.min(10, analysis.scores?.code_quality || 0)),
            logic_functionality: Math.max(0, Math.min(10, analysis.scores?.logic_functionality || 0)),
            performance_security: Math.max(0, Math.min(10, analysis.scores?.performance_security || 0)),
            testing_documentation: Math.max(0, Math.min(10, analysis.scores?.testing_documentation || 0))
        };

        const classification = analysis.comment_classification || {
            code_quality: 0,
            logic_functionality: 0,
            performance_security: 0,
            testing_documentation: 0,
            repeated_comments: 0,
            comments_that_can_be_ignored: 0
        };

        // Update repo with scores
        const { error: updateError } = await supabaseClient
            .from('repos')
            .update({
                code_quality: scores.code_quality,
                logic_functionality: scores.logic_functionality,
                performance_security: scores.performance_security,
                testing_documentation: scores.testing_documentation
            })
            .eq('repo_id', repo_id);

        if (updateError) {
            console.error('Failed to update repo scores:', updateError);
        } else {
            console.log('✅ Repo scores updated in database');
        }

        // Return analysis
        return res.status(200).json({
            success: true,
            message: 'Repo analysis completed successfully',
            data: {
                repo_id,
                title: repo.title,
                repository_url: repo.repository_url,
                total_comments: comments.length,
                state: repo.state,
                analysis: {
                    scores,
                    comment_classification: classification,
                    reasoning: analysis.reasoning || {},
                    overall_score: (
                        scores.code_quality +
                        scores.logic_functionality +
                        scores.performance_security +
                        scores.testing_documentation
                    ) / 4
                },
                analyzed_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error analyzing repo:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to analyze repo',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

router.post('/custom-analysis', async (req, res) => {
    const { repo_id, custom_prompt } = req.body;
    
    if (!repo_id) {
        return res.status(400).json({
            success: false,
            message: 'repo_id is required'
        });
    }

    if (!custom_prompt || typeof custom_prompt !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'custom_prompt is required and must be a string'
        });
    }

    try {
        // Fetch repo details
        const { data: repo, error: repoError } = await supabaseClient
            .from('repos')
            .select('*')
            .eq('repo_id', repo_id)
            .single();

        if (repoError || !repo) {
            return res.status(404).json({
                success: false,
                message: `Repo with id ${repo_id} not found`,
                error: repoError?.message
            });
        }

        // Fetch comments for this repo
        const { data: comments, error: commentsError } = await supabaseClient
            .from('comments')
            .select('id, type, body, commentor, created_at')
            .eq('repo_id', repo.repo_id);

        if (commentsError) {
            console.error('Error fetching comments:', commentsError);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch comments',
                error: commentsError.message
            });
        }

        if (!comments || comments.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No comments to analyze',
                data: {
                    repo_id,
                    title: repo.title,
                    total_comments: 0,
                    analysis_result: 'No comments available for analysis'
                }
            });
        }

        // Prepare comments text for analysis
        const commentsText = comments.map(c => {
            const commentType = c.type || 'general';
            const commentBody = c.body || '';
            const commentor = c.commentor || 'unknown';
            return `[${commentType}] ${commentor}: ${commentBody}`;
        }).join('\n\n');

        // Create the final prompt combining user's prompt with context
        const finalPrompt = `
${custom_prompt}

Context:
Pull Request Title: ${repo.title}
Repository: ${repo.repository_url}
Total Comments: ${comments.length}
PR State: ${repo.state}

Comments:
${commentsText}

Please analyze the above comments according to the instructions provided.

IMPORTANT: Keep your response concise and under 200 words.`;

        console.log('🤖 Sending custom prompt to Gemini AI...');

        // Call Gemini API with custom prompt
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const aiResponse = response.text();

        console.log('🤖 Gemini AI response received');

        // Return the raw AI response (don't parse as JSON since user prompt is custom)
        return res.status(200).json({
            success: true,
            message: 'Custom analysis completed successfully',
            data: {
                repo_id,
                title: repo.title,
                repository_url: repo.repository_url,
                total_comments: comments.length,
                state: repo.state,
                custom_prompt: custom_prompt,
                analysis_result: aiResponse,
                analyzed_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error in custom analysis:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to perform custom analysis',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;