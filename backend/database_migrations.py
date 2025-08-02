"""
Database Migration System
Handles database migrations from SQLite to PostgreSQL and schema updates.
"""

import os
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy import create_engine, text, inspect, MetaData
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

def get_database_url():
    """Get database URL from environment variables."""
    database_url = os.getenv('DATABASE_URL')
    
    if not database_url:
        # Fallback to SQLite for development
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.db')
        database_url = f'sqlite:///{db_path}'
        logger.warning("No DATABASE_URL provided, using SQLite for development")
    
    return database_url

def create_database_engine(database_url: str):
    """Create database engine with appropriate configuration."""
    if database_url.startswith('postgresql'):
        # PostgreSQL configuration
        engine = create_engine(
            database_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=3600,
            echo=False
        )
    else:
        # SQLite configuration
        engine = create_engine(
            database_url,
            echo=False,
            connect_args={'timeout': 30, 'check_same_thread': False}
        )
    
    return engine

# =============================================================================
# MIGRATION SYSTEM
# =============================================================================

class DatabaseMigrator:
    """Handles database migrations and schema updates."""
    
    def __init__(self, source_url: str, target_url: str):
        self.source_url = source_url
        self.target_url = target_url
        self.source_engine = create_database_engine(source_url)
        self.target_engine = create_database_engine(target_url)
        
    def test_connections(self) -> Dict[str, bool]:
        """Test database connections."""
        results = {}
        
        # Test source database
        try:
            with self.source_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            results['source'] = True
            logger.info("Source database connection successful")
        except Exception as e:
            results['source'] = False
            logger.error(f"Source database connection failed: {e}")
        
        # Test target database
        try:
            with self.target_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            results['target'] = True
            logger.info("Target database connection successful")
        except Exception as e:
            results['target'] = False
            logger.error(f"Target database connection failed: {e}")
        
        return results
    
    def get_table_schema(self, engine, table_name: str) -> Dict[str, Any]:
        """Get table schema information."""
        inspector = inspect(engine)
        
        if not inspector.has_table(table_name):
            return {}
        
        columns = inspector.get_columns(table_name)
        indexes = inspector.get_indexes(table_name)
        foreign_keys = inspector.get_foreign_keys(table_name)
        
        return {
            'columns': columns,
            'indexes': indexes,
            'foreign_keys': foreign_keys
        }
    
    def create_postgresql_schema(self):
        """Create PostgreSQL schema from SQLAlchemy models."""
        from database import Base
        
        try:
            # Create all tables
            Base.metadata.create_all(self.target_engine)
            logger.info("PostgreSQL schema created successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to create PostgreSQL schema: {e}")
            return False
    
    def migrate_data(self, table_name: str) -> bool:
        """Migrate data from source to target database."""
        try:
            # Get data from source
            with self.source_engine.connect() as source_conn:
                result = source_conn.execute(text(f"SELECT * FROM {table_name}"))
                rows = result.fetchall()
                columns = result.keys()
            
            if not rows:
                logger.info(f"No data to migrate for table {table_name}")
                return True
            
            # Insert data into target
            with self.target_engine.connect() as target_conn:
                for row in rows:
                    # Convert row to dict
                    row_dict = dict(zip(columns, row))
                    
                    # Build INSERT statement
                    columns_str = ', '.join(columns)
                    placeholders = ', '.join([':' + col for col in columns])
                    insert_stmt = f"INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders})"
                    
                    target_conn.execute(text(insert_stmt), row_dict)
                
                target_conn.commit()
            
            logger.info(f"Migrated {len(rows)} rows from table {table_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to migrate table {table_name}: {e}")
            return False
    
    def migrate_all_tables(self) -> Dict[str, bool]:
        """Migrate all tables from source to target database."""
        inspector = inspect(self.source_engine)
        tables = inspector.get_table_names()
        
        results = {}
        
        for table in tables:
            logger.info(f"Migrating table: {table}")
            results[table] = self.migrate_data(table)
        
        return results
    
    def verify_migration(self) -> Dict[str, Any]:
        """Verify that migration was successful."""
        source_inspector = inspect(self.source_engine)
        target_inspector = inspect(self.target_engine)
        
        source_tables = source_inspector.get_table_names()
        target_tables = target_inspector.get_table_names()
        
        verification = {
            'tables_migrated': len(source_tables),
            'tables_in_target': len(target_tables),
            'table_counts': {},
            'success': True
        }
        
        for table in source_tables:
            if table not in target_tables:
                verification['success'] = False
                logger.error(f"Table {table} missing in target database")
                continue
            
            # Compare row counts
            try:
                with self.source_engine.connect() as source_conn:
                    source_count = source_conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
                
                with self.target_engine.connect() as target_conn:
                    target_count = target_conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
                
                verification['table_counts'][table] = {
                    'source': source_count,
                    'target': target_count,
                    'match': source_count == target_count
                }
                
                if source_count != target_count:
                    verification['success'] = False
                    logger.error(f"Row count mismatch for table {table}: source={source_count}, target={target_count}")
                
            except Exception as e:
                logger.error(f"Error verifying table {table}: {e}")
                verification['success'] = False
        
        return verification

# =============================================================================
# POSTGRESQL SETUP
# =============================================================================

def setup_postgresql_database():
    """Setup PostgreSQL database and user."""
    database_url = os.getenv('DATABASE_URL')
    
    if not database_url or not database_url.startswith('postgresql'):
        logger.info("No PostgreSQL DATABASE_URL provided, skipping PostgreSQL setup")
        return False
    
    try:
        # Parse connection string
        from urllib.parse import urlparse
        parsed = urlparse(database_url)
        
        # Connect to PostgreSQL server
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            user=parsed.username,
            password=parsed.password,
            database='postgres'  # Connect to default database
        )
        
        conn.autocommit = True
        cursor = conn.cursor()
        
        # Create database if it doesn't exist
        db_name = parsed.path[1:]  # Remove leading slash
        cursor.execute(f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'")
        
        if not cursor.fetchone():
            cursor.execute(f"CREATE DATABASE {db_name}")
            logger.info(f"Created database: {db_name}")
        
        cursor.close()
        conn.close()
        
        logger.info("PostgreSQL database setup completed")
        return True
        
    except Exception as e:
        logger.error(f"Failed to setup PostgreSQL database: {e}")
        return False

# =============================================================================
# MIGRATION COMMANDS
# =============================================================================

def run_migration():
    """Run the complete migration process."""
    source_url = get_database_url()
    target_url = os.getenv('DATABASE_URL')
    
    if not target_url or target_url == source_url:
        logger.error("No target DATABASE_URL provided or same as source")
        return False
    
    migrator = DatabaseMigrator(source_url, target_url)
    
    # Test connections
    connections = migrator.test_connections()
    if not all(connections.values()):
        logger.error("Database connection test failed")
        return False
    
    # Setup PostgreSQL if needed
    if target_url.startswith('postgresql'):
        if not setup_postgresql_database():
            logger.error("PostgreSQL setup failed")
            return False
    
    # Create schema
    if not migrator.create_postgresql_schema():
        logger.error("Schema creation failed")
        return False
    
    # Migrate data
    migration_results = migrator.migrate_all_tables()
    
    # Verify migration
    verification = migrator.verify_migration()
    
    # Log results
    logger.info("Migration Results:")
    logger.info(f"Tables migrated: {migration_results}")
    logger.info(f"Verification: {verification}")
    
    return verification['success']

def create_backup():
    """Create a backup of the current database."""
    database_url = get_database_url()
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    if database_url.startswith('sqlite'):
        # SQLite backup
        source_path = database_url.replace('sqlite:///', '')
        backup_path = f"{source_path}.backup_{timestamp}"
        
        try:
            import shutil
            shutil.copy2(source_path, backup_path)
            logger.info(f"SQLite backup created: {backup_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to create SQLite backup: {e}")
            return False
    
    elif database_url.startswith('postgresql'):
        # PostgreSQL backup
        from urllib.parse import urlparse
        parsed = urlparse(database_url)
        
        backup_file = f"backup_{timestamp}.sql"
        
        try:
            import subprocess
            
            cmd = [
                'pg_dump',
                '-h', parsed.hostname,
                '-p', str(parsed.port or 5432),
                '-U', parsed.username,
                '-d', parsed.path[1:],
                '-f', backup_file
            ]
            
            # Set password environment variable
            env = os.environ.copy()
            env['PGPASSWORD'] = parsed.password
            
            result = subprocess.run(cmd, env=env, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"PostgreSQL backup created: {backup_file}")
                return True
            else:
                logger.error(f"PostgreSQL backup failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Failed to create PostgreSQL backup: {e}")
            return False
    
    return False

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_database_info():
    """Get information about the current database."""
    database_url = get_database_url()
    
    info = {
        'type': 'sqlite' if database_url.startswith('sqlite') else 'postgresql',
        'url': database_url,
        'tables': [],
        'size': 0
    }
    
    try:
        engine = create_database_engine(database_url)
        inspector = inspect(engine)
        info['tables'] = inspector.get_table_names()
        
        # Get database size
        if database_url.startswith('sqlite'):
            import os
            db_path = database_url.replace('sqlite:///', '')
            if os.path.exists(db_path):
                info['size'] = os.path.getsize(db_path)
        else:
            with engine.connect() as conn:
                result = conn.execute(text("SELECT pg_database_size(current_database())"))
                info['size'] = result.scalar()
        
    except Exception as e:
        logger.error(f"Failed to get database info: {e}")
    
    return info

def cleanup_old_backups(keep_days: int = 30):
    """Clean up old backup files."""
    import glob
    import os
    from datetime import datetime, timedelta
    
    cutoff_date = datetime.now() - timedelta(days=keep_days)
    
    # Find backup files
    backup_patterns = [
        '*.backup_*',
        'backup_*.sql'
    ]
    
    for pattern in backup_patterns:
        for backup_file in glob.glob(pattern):
            try:
                file_time = datetime.fromtimestamp(os.path.getctime(backup_file))
                if file_time < cutoff_date:
                    os.remove(backup_file)
                    logger.info(f"Removed old backup: {backup_file}")
            except Exception as e:
                logger.error(f"Failed to remove old backup {backup_file}: {e}")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python database_migrations.py [migrate|backup|info|cleanup]")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "migrate":
        success = run_migration()
        sys.exit(0 if success else 1)
    
    elif command == "backup":
        success = create_backup()
        sys.exit(0 if success else 1)
    
    elif command == "info":
        info = get_database_info()
        print(json.dumps(info, indent=2))
    
    elif command == "cleanup":
        cleanup_old_backups()
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1) 