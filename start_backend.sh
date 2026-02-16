#!/bin/bash
# Install dependencies if not already installed (this is a simple check)
if ! python3 -c "import fastapi" &> /dev/null; then
    echo "Installing backend dependencies..."
    pip install fastapi uvicorn pydantic pandas
fi

echo "Starting Simple Steps Backend..."
# Run the uvicorn server
# Assuming run from root
python3 -m uvicorn SIMPLE_STEPS.main:app --reload --port 8000 --app-dir src
