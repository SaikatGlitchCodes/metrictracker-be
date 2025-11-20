const express = require('express');
const router = express.Router();
const supabaseClient = require('../database/connectionDB');

router.get('/', async (req, res) => {
    try {
        const { data: teams, error } = await supabaseClient
            .from("teams")
            .select("*")
            .order("name");
        
        if (error) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch teams',
                error: error.message 
            });
        }

        res.json({ success: true, teams, error: null });
    } catch (err) {
        console.error('Error fetching teams:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: err.message 
        });
    }
});

router.get('/:teamId', async (req, res) => {
    const { teamId } = req.params;
    
    try {
        let query = supabaseClient
            .from("team_members")
            .select(`
                *,
                team:teams(*),
                github_user:github_users(*)
            `);

        if (teamId) {
            query = query.eq("team_id", teamId);
        }

        const { data, error } = await query;

        if (error) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch team members',
                error: error.message 
            });
        }

        res.json({ success: true, data, error: null });
    } catch (err) {
        console.error('Error fetching team members:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: err.message 
        });
    }
});

router.post('/add', async (req, res) => {
    try {
        const { name, description } = req.body; // Fixed: removed await

        if (!name) {
            return res.status(400).json({ 
                success: false,
                error: "Team name is required" 
            });
        }

        const { data: team, error } = await supabaseClient
            .from("teams")
            .insert([{ name, description }])
            .select()
            .single();

        if (error) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to create team',
                error: error.message 
            });
        }

        res.status(201).json({ success: true, team, error: null });
    } catch (err) {
        console.error('Error creating team:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: err.message 
        });
    }
});

module.exports = router;