"""
Create a test user with a confirmed email so you can sign in directly
without needing to verify via email.

Usage:
    cd backend
    pip install python-dotenv  # if not already installed
    python scripts/seed_user.py

The script reads SUPABASE_URL and SUPABASE_SERVICE_KEY from .env (or
environment variables). The created user will have email_confirm=True,
so no verification email is required — just sign in at /login.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
    sys.exit(1)

TEST_EMAIL = "test@example.com"
TEST_PASSWORD = "Test123!"

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

try:
    resp = client.auth.admin.create_user({
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "email_confirm": True,
    })
    user = resp.user
    print(f"User created successfully!")
    print(f"  Email:    {user.email}")
    print(f"  Password: {TEST_PASSWORD}")
    print(f"  User ID:  {user.id}")
    print()
    print("Sign in at http://localhost:3000/login with these credentials.")
except Exception as exc:
    if "already registered" in str(exc).lower():
        print(f"User '{TEST_EMAIL}' already exists. You can sign in with:")
        print(f"  Email:    {TEST_EMAIL}")
        print(f"  Password: {TEST_PASSWORD}")
    else:
        print(f"ERROR: {exc}")
        sys.exit(1)
