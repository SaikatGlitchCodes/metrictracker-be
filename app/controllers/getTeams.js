const express = require('express');
const router = express.Router();
const DatabaseService = require('../services/DatabaseService');
const { Team, TeamMember, GithubUser } = require('../models');

// GET / - Get all teams
router.get('/', async (req, res) => {
    try {
        const teams = await DatabaseService.findAllTeams();
        
        res.json({ 
            success: true, 
            message: 'Teams retrieved successfully',
            data: { teams }
        });
    } catch (err) {
        console.error('Error fetching teams:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: err.message 
        });
    }
});

// GET /:teamId - Get team members by team ID
router.get('/:teamId', async (req, res) => {
    const { teamId } = req.params;
    
    try {
        const team = await DatabaseService.findTeamById(teamId);
        
        if (!team) {
            return res.status(404).json({
                success: false,
                message: `Team with ID '${teamId}' not found`
            });
        }

        const members = await TeamMember.findAll({
            where: { team_id: teamId },
            include: [
                {
                    model: Team,
                    as: 'team'
                },
                {
                    model: GithubUser,
                    as: 'githubUser'
                }
            ]
        });

        res.json({ 
            success: true,
            message: 'Team members retrieved successfully',
            data: {
                team,
                members
            }
        });
    } catch (err) {
        console.error('Error fetching team members:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: err.message 
        });
    }
});

// POST /add - Create a new team
router.post('/add', async (req, res) => {
    try {
        const { name, description, github_names } = req.body;

        if (!name) {
            return res.status(400).json({ 
                success: false,
                message: "Team name is required" 
            });
        }

        // Check if team already exists
        const existingTeam = await DatabaseService.findTeamByName(name);
        if (existingTeam) {
            return res.status(400).json({
                success: false,
                message: 'Team with this name already exists'
            });
        }

        // Create team
        const team = await DatabaseService.createTeam({ name, description });

        // Add members if provided
        const addedMembers = [];
        if (github_names && Array.isArray(github_names)) {
            for (const github_name of github_names) {
                const user = await DatabaseService.findUserByGithubName(github_name);
                if (user) {
                    await DatabaseService.addTeamMember(team.id, user.id);
                    addedMembers.push(github_name);
                }
            }
        }

        res.status(201).json({ 
            success: true,
            message: 'Team created successfully',
            data: {
                team,
                members_added: addedMembers.length,
                members: addedMembers
            }
        });
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