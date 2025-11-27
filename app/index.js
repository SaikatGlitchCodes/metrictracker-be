const express = require('express');
const app = express();
const dotenv = require('dotenv');
const cors = require('cors');
dotenv.config();

// Environment validation
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'GITHUB_TOKEN', 'BASE_URL'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

const PORT = process.env.PORT || 4000;
const supabaseClient = require('./database/connectionDB');

// CORS Configuration
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',') 
        : '*',
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    });
    next();
});

app.get('/health', async (req, res) => {
    const healthCheck = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        status: 'healthy',
        environment: process.env.NODE_ENV || 'development',
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
app.use('/ai', require('./controllers/getAI'));

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log('🚀 MetricTracker Backend Server');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Base URL: ${process.env.BASE_URL}`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API Routes:`);
    console.log(`   - POST /prs/refresh-prs`);
    console.log(`   - POST /prs/refresh-team-prs`);
    console.log(`   - GET  /prs/user/:github_name`);
    console.log(`   - GET  /prs/team/:team_id`);
    console.log(`   - GET  /teams`);
    console.log(`   - POST /teams/add`);
    console.log(`   - POST /ai/analyze-repo`);
    console.log(`   - POST /ai/analyze-batch`);
    console.log(`   - GET  /ai/repo-scores/:repo_id`);
});

module.exports = app;