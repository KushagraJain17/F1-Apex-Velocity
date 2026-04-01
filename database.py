import os
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, Enum, JSON, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Database configuration
# To use MySQL, replace 'sqlite:///f1_data.db' with 'mysql://user:password@localhost/dbname'
DB_URL = os.environ.get('DATABASE_URL', 'sqlite:///f1_data.db')

engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if "sqlite" in DB_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Schedule(Base):
    __tablename__ = "schedules"
    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, index=True)
    round = Column(Integer)
    event_name = Column(String(255))
    country = Column(String(100))
    location = Column(String(100))
    event_date = Column(String(100))
    event_datetime_iso = Column(String(100))
    format = Column(String(50))
    sessions_json = Column(JSON) # Stores the list of session dicts

class DriverStanding(Base):
    __tablename__ = "driver_standings"
    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, index=True)
    round = Column(Integer, index=True)
    pos = Column(Integer)
    name = Column(String(255))
    team = Column(String(255))
    wins = Column(Integer)
    podiums = Column(Integer)
    points = Column(Float)
    trend = Column(String(50))
    trend_val = Column(Integer)

class ConstructorStanding(Base):
    __tablename__ = "constructor_standings"
    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, index=True)
    round = Column(Integer, index=True)
    pos = Column(Integer)
    team_name = Column(String(255))
    points = Column(Float)
    wins = Column(Integer)
    drivers_json = Column(JSON) # List of driver names
    trend = Column(String(50))
    trend_val = Column(Integer)

class SessionResult(Base):
    __tablename__ = "session_results"
    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, index=True)
    round = Column(Integer, index=True)
    session_type = Column(String(10), index=True) # R, S, Q, SQ
    data_json = Column(JSON) # The full list of results for that session

# Create tables
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Helper functions
def save_schedule(db, year, events):
    # Clear old schedule for the year
    db.query(Schedule).filter(Schedule.year == year).delete()
    for event in events:
        db_event = Schedule(
            year=year,
            round=event['RoundNumber'],
            event_name=event['EventName'],
            country=event['Country'],
            location=event['Location'],
            event_date=event['EventDate'],
            event_datetime_iso=event['EventDateTimeIso'],
            format=event['Format'],
            sessions_json=event['Sessions']
        )
        db.add(db_event)
    db.commit()

def get_schedule(db, year):
    events = db.query(Schedule).filter(Schedule.year == year).order_by(Schedule.round).all()
    if not events: return None
    return [{
        'RoundNumber': e.round,
        'EventName': e.event_name,
        'Country': e.country,
        'Location': e.location,
        'EventDate': e.event_date,
        'EventDateTimeIso': e.event_datetime_iso,
        'Format': e.format,
        'Sessions': e.sessions_json
    } for e in events]

def save_driver_standings(db, year, round_num, drivers):
    db.query(DriverStanding).filter(DriverStanding.year == year, DriverStanding.round == round_num).delete()
    for d in drivers:
        db_d = DriverStanding(
            year=year, round=round_num,
            pos=d.get('Pos', drivers.index(d) + 1), 
            name=d['Name'], team=d['Team'],
            wins=d.get('Wins', 0), podiums=d.get('Podiums', 0), points=d['Points'],
            trend=d.get('Trend', 'STABLE'), trend_val=d.get('TrendVal', 0)
        )
        db.add(db_d)
    db.commit()

def get_driver_standings(db, year, round_num):
    drivers = db.query(DriverStanding).filter(DriverStanding.year == year, DriverStanding.round == round_num).order_by(DriverStanding.pos).all()
    if not drivers: return None
    return [{
        'Pos': d.pos, 'Name': d.name, 'Team': d.team,
        'Wins': d.wins, 'Podiums': d.podiums, 'Points': d.points,
        'Trend': d.trend, 'TrendVal': d.trend_val
    } for d in drivers]

def save_constructor_standings(db, year, round_num, teams):
    db.query(ConstructorStanding).filter(ConstructorStanding.year == year, ConstructorStanding.round == round_num).delete()
    for t in teams:
        # Note: In app.py, teams list sometimes doesn't have Pos if derived from row index
        # But we'll store it by order if Pos is missing
        db_t = ConstructorStanding(
            year=year, round=round_num,
            pos=teams.index(t) + 1,
            team_name=t['TeamName'], points=t['Points'], wins=t['Wins'],
            drivers_json=t.get('Drivers', []), 
            trend=t.get('Trend', 'STABLE'), 
            trend_val=t.get('TrendVal', 0)
        )
        db.add(db_t)
    db.commit()

def get_constructor_standings(db, year, round_num):
    teams = db.query(ConstructorStanding).filter(ConstructorStanding.year == year, ConstructorStanding.round == round_num).order_by(ConstructorStanding.pos).all()
    if not teams: return None
    return [{
        'TeamName': t.team_name, 'Points': t.points, 'Wins': t.wins,
        'Drivers': t.drivers_json, 'Trend': t.trend, 'TrendVal': t.trend_val
    } for t in teams]

def save_session_results(db, year, round_num, session_type, data):
    db.query(SessionResult).filter(
        SessionResult.year == year, 
        SessionResult.round == round_num, 
        SessionResult.session_type == session_type
    ).delete()
    db_res = SessionResult(
        year=year, round=round_num, 
        session_type=session_type, 
        data_json=data
    )
    db.add(db_res)
    db.commit()

def get_session_results(db, year, round_num, session_type):
    res = db.query(SessionResult).filter(
        SessionResult.year == year, 
        SessionResult.round == round_num, 
        SessionResult.session_type == session_type
    ).first()
    return res.data_json if res else None

def get_latest_standing_round(db, year):
    """Returns the maximum round number available in the driver_standings table for a given year."""
    res = db.query(func.max(DriverStanding.round)).filter(DriverStanding.year == year).scalar()
    return res if res is not None else 0

def get_max_round(db, year):
    """Returns the maximum round number available in the schedules table for a given year."""
    res = db.query(func.max(Schedule.round)).filter(Schedule.year == year).scalar()
    return res if res is not None else 0
