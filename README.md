# MetricTracker Backend

Backend service for MetricTracker - A comprehensive GitHub team metrics and PR analytics system that tracks pull request performance, comment interactions, and team collaboration metrics.

## Features

- **Individual & Team PR Tracking**: Refresh and sync PR data for individual users or entire teams
- **Comment Analytics**: Track PR comments, categorize interactions (team vs external), and analyze engagement patterns
- **Performance Metrics**: Calculate performance scores based on PRs, comments, review participation, and merge rates
- **Timeline Filtering**: Query data by flexible time ranges (week, month, quarter, year)
- **Async Processing**: Worker threads for non-blocking comment fetching and database operations
- **Team Management**: Create teams, manage members, and track team-wide metrics
- **Health Monitoring**: Built-in health checks for server and database connectivity
- **Quarter-based Analysis**: Business-aligned quarterly reporting (Q1-Q4)

## Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Supabase account with PostgreSQL database
- GitHub Personal Access Token with repo and read:org permissions

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd MetricTracker\ Backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from template:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key

# GitHub API
GITHUB_TOKEN=your_github_personal_access_token

# Server Configuration
BASE_URL=http://localhost:4000
PORT=4000
NODE_ENV=development

# Optional: Gemini AI Integration
GEMINI_URL=your_gemini_api_url
```

## Database Schema

Ensure your Supabase database has the following tables:

### `github_users`
- `id` (uuid, primary key)
- `github_name` (text, unique)
- `avatar_url` (text)
- `repos_last_sync` (timestamp)
- `comments_last_sync` (timestamp)
- `created_at` (timestamp)

### `repos`
- `id` (uuid, primary key)
- `github_user_id` (uuid, foreign key)
- `repo_name` (text)
- `repo_url` (text)
- `pr_number` (integer)
- `pr_title` (text)
- `pr_url` (text)
- `state` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `closed_at` (timestamp)
- `merged_at` (timestamp)
- `author` (text)

### `comments`
- `id` (uuid, primary key)
- `repo_id` (uuid, foreign key)
- `comment_id` (text, unique)
- `body` (text)
- `user` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `comment_type` (text)

### `teams`
- `id` (uuid, primary key)
- `team_name` (text, unique)
- `created_at` (timestamp)

### `team_members`
- `id` (uuid, primary key)
- `team_id` (uuid, foreign key)
- `github_user_id` (uuid, foreign key)
- `joined_at` (timestamp)

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:4000` (or your configured PORT).

## API Endpoints

### Health Check

#### `GET /health`
Check server and database health status.

**Response:**
```json
{
  "uptime": 123.456,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "status": "healthy",
  "environment": "development",
  "server": {
    "status": "ok",
    "version": "1.0.0"
  },
  "database": {
    "status": "connected",
    "latency_ms": 45
  }
}
```

### PR Management

#### `POST /prs/refresh-prs`
Refresh PR and comment data for an individual user.

**Request Body:**
```json
{
  "github_name": "john-doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully synced PRs and started comment fetching",
  "data": {
    "github_name": "john-doe",
    "prs_synced": 15,
    "repos_last_sync": "2024-01-15T10:30:00.000Z",
    "comments_status": "processing"
  }
}
```

#### `POST /prs/refresh-team-prs`
Refresh PR data for all members of a team.

**Request Body:**
```json
{
  "team_id": "uuid-team-id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Team PR refresh completed",
  "data": {
    "team_id": "uuid-team-id",
    "members_processed": 5,
    "total_prs_synced": 75,
    "results": [...]
  }
}
```

#### `GET /prs/user/:github_name`
Get PR and comment data for a user with timeline filter.

**Query Parameters:**
- `timeline`: `week`, `2weeks`, `month`, `3months`, `6months`, `year` (optional)

**Example:**
```
GET /prs/user/john-doe?timeline=month
```

**Response:**
```json
{
  "success": true,
  "message": "User data retrieved successfully",
  "data": {
    "github_name": "john-doe",
    "timeline": "month",
    "summary": {
      "total_prs": 12,
      "merged_prs": 10,
      "open_prs": 2,
      "total_comments_received": 45,
      "team_comments": 30,
      "comparison_comments": 10,
      "external_comments": 5
    },
    "prs": [...]
  }
}
```

#### `GET /prs/team/:team_id`
Get team PR data with quarter-based filtering.

**Query Parameters:**
- `quarter`: `Q1`, `Q2`, `Q3`, `Q4` (optional)
- `year`: e.g., `2024` (optional, defaults to current year)

**Example:**
```
GET /prs/team/uuid-team-id?quarter=Q1&year=2024
```

**Response:**
```json
{
  "success": true,
  "message": "Team data retrieved successfully",
  "data": {
    "team_id": "uuid-team-id",
    "team_name": "Backend Team",
    "quarter": "Q1",
    "year": 2024,
    "summary": {
      "total_members": 5,
      "total_prs": 60,
      "total_comments": 250
    },
    "memberBreakdown": [
      {
        "github_name": "john-doe",
        "total_prs": 12,
        "repos": [
          {
            "repo_name": "api-service",
            "pr_count": 5,
            "comments_received": [...]
          }
        ]
      }
    ],
    "topPerformers": {
      "most_prs": {...},
      "most_merged": {...},
      "most_comments": {...},
      "overall": {...}
    }
  }
}
```

#### `GET /prs/comments-status/:github_name`
Check comment sync status for a user.

**Response:**
```json
{
  "success": true,
  "message": "Comment sync status retrieved",
  "data": {
    "github_name": "john-doe",
    "last_sync": "2024-01-15T10:30:00.000Z",
    "status": "synced"
  }
}
```

#### `GET /prs/team-status/:team_id`
Check comment sync status for all team members.

**Response:**
```json
{
  "success": true,
  "message": "Team sync status retrieved",
  "data": {
    "team_id": "uuid-team-id",
    "members": [
      {
        "github_name": "john-doe",
        "last_sync": "2024-01-15T10:30:00.000Z",
        "status": "synced"
      }
    ]
  }
}
```

#### `GET /prs/comment-analysis/:teamId`
Quarterly comment analysis comparing team members with comparison team.

**Query Parameters:**
- `quarter`: `Q1`, `Q2`, `Q3`, `Q4` (optional)
- `year`: e.g., `2024` (optional)

**Response:**
```json
{
  "success": true,
  "data": {
    "teamId": "uuid-team-id",
    "quarter": "Q1",
    "year": 2024,
    "members": [
      {
        "github_name": "john-doe",
        "total_prs": 12,
        "comments_from_comparison_team": 15,
        "comments_from_own_team": 20,
        "external_comments": 5
      }
    ]
  }
}
```

### Team Management

#### `GET /teams`
Get all teams.

**Response:**
```json
{
  "success": true,
  "message": "Teams retrieved successfully",
  "data": {
    "teams": [
      {
        "id": "uuid",
        "team_name": "Backend Team",
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### `GET /teams/:teamId`
Get team members by team ID.

**Response:**
```json
{
  "success": true,
  "message": "Team members retrieved successfully",
  "data": {
    "team": {...},
    "members": [...]
  }
}
```

#### `POST /teams/add`
Create a new team with members.

**Request Body:**
```json
{
  "team_name": "Frontend Team",
  "github_names": ["alice", "bob", "charlie"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Team created successfully",
  "data": {
    "team_id": "uuid",
    "team_name": "Frontend Team",
    "members_added": 3
  }
}
```

## Deployment

### Docker

1. Build the image:
```bash
docker build -t metrictracker-backend .
```

2. Run the container:
```bash
docker run -p 4000:4000 --env-file .env metrictracker-backend
```

### Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

3. Set environment variables in Vercel dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `GITHUB_TOKEN`
   - `BASE_URL`
   - `NODE_ENV=production`

### Heroku

1. Create Heroku app:
```bash
heroku create metrictracker-backend
```

2. Set environment variables:
```bash
heroku config:set SUPABASE_URL=your_url
heroku config:set SUPABASE_KEY=your_key
heroku config:set GITHUB_TOKEN=your_token
```

3. Deploy:
```bash
git push heroku main
```

## Architecture

### Worker Threads
The application uses Node.js worker threads for non-blocking comment processing:
- **Main Thread**: Handles API requests and PR fetching
- **Worker Threads**: Spawned for each comment fetching operation
- **Benefits**: Prevents blocking, scales with concurrent requests

### Database Strategy
- **Supabase (PostgreSQL)**: Primary data store
- **Normalized Schema**: Separate tables for users, repos, comments, teams
- **Foreign Keys**: Maintains referential integrity
- **Timestamps**: Tracks sync status and data freshness

### Performance Scoring
Top performers are calculated using weighted factors:
- PRs created (weight: 2)
- PRs merged (weight: 3)
- Comments received (weight: 1)
- Merge rate % (weight: 2)

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information"
}
```

HTTP Status Codes:
- `200`: Success
- `207`: Multi-Status (partial success in bulk operations)
- `400`: Bad Request (missing/invalid parameters)
- `404`: Not Found
- `500`: Internal Server Error

## Development

### Project Structure
```
MetricTracker Backend/
├── app/
│   ├── index.js              # Main server file
│   ├── controllers/
│   │   ├── getPRs.js         # PR endpoints controller
│   │   ├── getCommentsPR.js  # Comment endpoints (legacy)
│   │   └── getTeams.js       # Team management controller
│   ├── database/
│   │   └── connectionDB.js   # Supabase client
│   ├── utils/
│   │   ├── fetchPRs.js       # GitHub PR fetching
│   │   ├── fetchComments.js  # GitHub comment fetching
│   │   ├── workerManager.js  # Worker thread spawner
│   │   └── Oktokit.js        # Octokit instance
│   └── workers/
│       └── commentsWorker.js # Comment processing worker
├── .env.example              # Environment template
├── .gitignore
├── Dockerfile
├── .dockerignore
├── vercel.json
├── package.json
└── README.md
```

### Adding New Endpoints

1. Create/update controller in `app/controllers/`
2. Import controller in `app/index.js`
3. Register routes: `app.use('/route', controller)`
4. Follow error handling patterns
5. Update this README

## Security Considerations

- Store `.env` securely, never commit to git
- Use environment-specific CORS origins in production
- Rotate GitHub tokens regularly
- Enable rate limiting for production (recommended: express-rate-limit)
- Add helmet.js for security headers
- Validate all user inputs
- Use HTTPS in production

## Troubleshooting

### Worker Thread Errors
- Ensure Node.js >= 16.0.0
- Check worker file paths are correct
- Review worker logs for detailed errors

### Database Connection Issues
- Verify `SUPABASE_URL` and `SUPABASE_KEY`
- Check network connectivity
- Ensure database schema matches expected structure

### GitHub API Rate Limits
- Use authenticated requests (token required)
- Monitor rate limit headers
- Implement retry logic with exponential backoff

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with proper error handling
4. Test all endpoints
5. Submit pull request

## License

ISC

## Support

For issues and questions, please open a GitHub issue or contact the development team.
