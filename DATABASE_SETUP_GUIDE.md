# 🗄️ Database Setup Guide

## Current Status: ❌ Database Not Available

The database connection test failed because PostgreSQL is not running. Here are your options to set up the database:

## Option 1: Install Docker (Recommended - Easiest)

### Step 1: Download Docker Desktop
1. Go to: https://www.docker.com/products/docker-desktop/
2. Download Docker Desktop for Windows
3. Install and start Docker Desktop

### Step 2: Start the Database
```bash
# Start PostgreSQL with Docker
bun start:db

# Test the connection
bun test:db

# Start the application
bun start
```

## Option 2: Install PostgreSQL Locally

### Step 1: Download PostgreSQL
1. Go to: https://www.postgresql.org/download/windows/
2. Download PostgreSQL 15 or later
3. Install with default settings

### Step 2: Create Database and User
1. Open Command Prompt as Administrator
2. Navigate to PostgreSQL bin directory (usually `C:\Program Files\PostgreSQL\15\bin`)
3. Run these commands:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE emurgo;

# Create user
CREATE USER myuser WITH PASSWORD 'mypassword';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE emurgo TO myuser;

# Exit
\q
```

### Step 3: Test Connection
```bash
bun test:db
```

## Option 3: Use Different Database Credentials

If you have an existing PostgreSQL installation with different credentials, update the `.env` file:

```env
DATABASE_URL=postgres://your_username:your_password@localhost:5432/your_database_name
```

## Option 4: Use SQLite (Alternative)

If you want to use SQLite instead of PostgreSQL, I can modify the code to use SQLite. Let me know if you prefer this option.

## Quick Test Commands

After setting up the database, use these commands:

```bash
# Test database connection
bun test:db

# Start the application
bun start

# Run tests
bun test

# Start with hot reload
bun dev
```

## Troubleshooting

### Common Issues:

1. **"password authentication failed"**
   - Check username and password in `.env` file
   - Make sure the user exists in PostgreSQL

2. **"database does not exist"**
   - Create the database: `CREATE DATABASE emurgo;`

3. **"connection refused"**
   - Make sure PostgreSQL is running
   - Check if port 5432 is available

4. **"Docker not found"**
   - Install Docker Desktop
   - Make sure Docker is running

## Next Steps

1. Choose one of the options above
2. Set up the database
3. Run `bun test:db` to verify connection
4. Run `bun start` to start the application
5. Test the API at `http://localhost:3000`

## API Endpoints Ready

Once the database is connected, your API will have:

- `POST /blocks` - Add blockchain blocks
- `GET /balance/:address` - Get address balance
- `POST /rollback?height=number` - Rollback blockchain
- `GET /status` - Get blockchain status

Let me know which option you'd like to use, and I'll help you set it up! 🚀
