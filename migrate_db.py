import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# We need the models to query and insert data
from database import Base, Schedule, DriverStanding, ConstructorStanding, SessionResult

def migrate():
    # 1. Connect to Local SQLite
    local_url = 'sqlite:///f1_data.db'
    engine_local = create_engine(local_url)
    SessionLocalSQLite = sessionmaker(bind=engine_local)
    session_local = SessionLocalSQLite()

    # 2. Connect to Remote Postgres (Supabase)
    load_dotenv()
    remote_url = os.environ.get("DATABASE_URL")
    if not remote_url or "sqlite" in remote_url:
        print("Error: DATABASE_URL in .env is not a valid Postgres URL.")
        return

    engine_remote = create_engine(remote_url)
    # Ensure remote tables exist
    Base.metadata.create_all(bind=engine_remote)
    
    SessionRemote = sessionmaker(bind=engine_remote)
    session_remote = SessionRemote()

    print("Connected to both databases. Starting migration...")

    # Helper function to migrate a specific model
    def migrate_table(model, name):
        print(f"Migrating {name}...")
        
        # Clear existing data on remote to avoid duplicates
        session_remote.query(model).delete()
        
        # Fetch all from local
        records = session_local.query(model).all()
        print(f"Found {len(records)} records in local database.")
        
        # Detach from local session and add to remote
        for record in records:
            session_local.expunge(record)
            # Remove the local ID so Postgres auto-generates its own primary keys, 
            # or keep it if we want exact mirrors. Keeping it is usually fine, 
            # but setting it to None ensures no conflicts with Postgres sequences.
            from sqlalchemy.orm import make_transient
            make_transient(record)
            record.id = None 
            session_remote.add(record)
        
        session_remote.commit()
        print(f"Successfully migrated {len(records)} records for {name}.\n")

    try:
        migrate_table(Schedule, "Schedules")
        migrate_table(DriverStanding, "Driver Standings")
        migrate_table(ConstructorStanding, "Constructor Standings")
        migrate_table(SessionResult, "Session Results")
        
        print("Migration completed successfully! All your local F1 data is now in Supabase.")
    except Exception as e:
        print(f"Error during migration: {e}")
        session_remote.rollback()
    finally:
        session_local.close()
        session_remote.close()

if __name__ == "__main__":
    migrate()
