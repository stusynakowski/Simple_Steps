#!/bin/bash
# Install dependencies if not already installed (this is a simple check)
if ! python3 -c "import fastapi" &> /dev/null; then
    echo "Installing backend dependencies..."
    pip install fastapi uvicorn pydantic pandas
fi

# Find a free port starting from 8000 (Streamlit-style auto-increment)
PORT=8000
while lsof -iTCP:$PORT -sTCP:LISTEN &>/dev/null; do
    echo "⚠️  Port $PORT is in use, trying next..."
    PORT=$((PORT + 1))
done

echo "Starting Simple Steps Backend on port $PORT..."
# Run the uvicorn server
# Assuming run from root
python3 -m uvicorn SIMPLE_STEPS.main:app --reload --port $PORT --app-dir src
