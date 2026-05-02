#!/bin/bash
# Toolforge Setup Script for WikiWakeUp

echo "Starting Toolforge setup..."

# 1. Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# 2. Activate venv and install dependencies
echo "Installing dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 3. Initialize the database
# Note: This uses the SQLite fallback if MariaDB env vars aren't set yet.
# To use MariaDB, you'll need to create a database first:
# toolforge-mariadb create wikiwakeup
echo "Initializing database..."
python3 -c "from database import init_db; init_db()"

# 4. Create the OAuth config if not present
if [ ! -f "oauth_config.yaml" ]; then
    echo "WARNING: oauth_config.yaml not found. Please create it using the template."
fi

# 5. Restart the webservice
echo "Restarting webservice..."
toolforge webservice python3.11 restart

echo "Setup complete! Check https://wikiwakeup.toolforge.org"
