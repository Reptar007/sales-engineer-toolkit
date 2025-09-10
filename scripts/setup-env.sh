#!/bin/bash

# Sales Engineer Toolkit - Environment Setup Script
# This script helps set up environment variables using 1Password CLI

set -e

echo "🔐 Setting up environment variables for Sales Engineer Toolkit..."

# Check if 1Password CLI is installed
if ! command -v op &> /dev/null; then
    echo "❌ 1Password CLI is not installed. Please install it first:"
    echo "   brew install --cask 1password-cli"
    exit 1
fi

# Check if user is signed in to 1Password
if ! op account list &> /dev/null; then
    echo "🔑 Please sign in to 1Password first:"
    echo "   op signin"
    exit 1
fi

# Inject environment variables from 1Password
echo "📥 Injecting environment variables from 1Password..."
op inject -i .env.example -o .env

# Verify the .env file was created
if [ -f ".env" ]; then
    echo "✅ Environment variables successfully injected into .env"
    echo "📋 Current environment variables:"
    echo "   OPENAI_API_KEY: $(grep OPENAI_API_KEY .env | cut -d'=' -f2 | cut -c1-20)..."
    echo "   OPENAI_MODEL: $(grep OPENAI_MODEL .env | cut -d'=' -f2)"
    echo "   PORT: $(grep PORT .env | cut -d'=' -f2)"
else
    echo "❌ Failed to create .env file"
    exit 1
fi

echo ""
echo "🚀 You can now run the application with:"
echo "   npm run dev"
