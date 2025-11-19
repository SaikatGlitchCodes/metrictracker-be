const express = require('express');
const app = express();
const PORT = process.env.PORT || 4000;
const dotenv = require('dotenv');
const cors = require('cors');
dotenv.config();
const supabaseClient = require('./database/connectionDB');


app.use(cors());

app.use(express.json());

app.get('/health', async (req, res) => {
    const healthCheck = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        status: 'healthy',
        server: {
            status: 'ok',
            port: PORT
        },
        database: {
            status: 'unknown',
            message: ''
        }
    };

    try {
        // Test Supabase connection with a simple query
        const { data, error } = await supabaseClient
            .from('github_users')
            .select('id')
            .limit(1);

        if (error) {
            healthCheck.database.status = 'error';
            healthCheck.database.message = error.message;
            healthCheck.status = 'degraded';
            return res.status(503).json(healthCheck);
        }

        healthCheck.database.status = 'ok';
        healthCheck.database.message = 'Connected';
        return res.status(200).json(healthCheck);

    } catch (err) {
        healthCheck.database.status = 'error';
        healthCheck.database.message = err.message || 'Connection failed';
        healthCheck.status = 'unhealthy';
        return res.status(503).json(healthCheck);
    }
})

app.use('/teams', require('./controllers/getTeams'));
app.use('/prs', require('./controllers/getPRs'));

app.listen( PORT, ()=>{
    console.log("Server is Running at ", PORT, "🎉")
})