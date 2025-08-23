#!/usr/bin/env python3
"""
Simple Database Initialization Script for SKIM2
Creates the simplified database structure without user authentication.
"""

import os
import sys
from pathlib import Path

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database_simple import init_db, engine, Base

def reset_database():
    """Reset the database by dropping all tables and recreating them."""
    print("🔄 Resetting simplified database...")
    
    # Drop all tables
    Base.metadata.drop_all(engine)
    print("✅ Dropped all existing tables")
    
    # Create all tables
    Base.metadata.create_all(engine)
    print("✅ Created all tables with new schema")
    
    print("🎉 Simplified database reset complete!")
    print("\nNew schema includes:")
    print("- documents (no user association)")
    print("- chat_sessions (linked to documents)")
    print("- chat_messages (linked to chat sessions)")
    print("\nDatabase file: skim2_local.db")

if __name__ == "__main__":
    reset_database()
