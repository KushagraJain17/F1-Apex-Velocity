import os
import fastf1
import pandas as pd
import warnings
import math
import traceback
from datetime import datetime
from fastapi import FastAPI, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from fastf1.ergast import Ergast

import database as db_mod
import utils

# Suppress annoying warnings
warnings.filterwarnings('ignore')

# Central Configuration
CURRENT_YEAR = 2026
ARCHIVE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

if not os.path.exists('cache'):
    os.makedirs('cache')
fastf1.Cache.enable_cache('cache')

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")


@app.get("/")
def root(request: Request, db: Session = Depends(db_mod.get_db)):
    # 1. Get schedule to find the next round
    year = CURRENT_YEAR
    sched_data = api_schedule(year, db)
    events = sched_data.get("events", [])
    
    # ISO string comparison for "next event"
    now_iso = datetime.now().isoformat()
    next_event = None
    for event in events:
        if event.get('EventDateTimeIso') and event['EventDateTimeIso'] > now_iso:
            next_event = event
            break
    
    if not next_event and events:
        next_event = events[-1] # Show the final race if all are in the past
    
    # 2. Get latest standings for the dashboard top list
    try:
        current_round = _get_ergast_round(year)
        standings_list = db_mod.get_driver_standings(db, year, current_round)
        if standings_list:
            top_drivers = standings_list[:5]
            for d in top_drivers:
                d['Color'] = utils.get_team_color(d['Team'])
        else:
            top_drivers = []
    except Exception:
        top_drivers = []

    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "active_page": "home",
            "next_event": next_event,
            "top_drivers": top_drivers,
            "events": events,
        },
    )

@app.get("/api/schedule/{year}")
def api_schedule(year: int, db: Session = Depends(db_mod.get_db)):
    # Try database first
    cached_events = db_mod.get_schedule(db, year)
    if cached_events:
        return {"status": "success", "year": year, "events": cached_events}

    # Only allow fastf1 fallback for the current year (2026)
    if year != 2026:
        return {"status": "error", "message": f"Schedule for {year} not found in archive.", "events": []}

    try:
        schedule_df = fastf1.get_event_schedule(year)
        events = []
        for _, row in schedule_df.iterrows():
            if row['EventFormat'] != 'testing':
                sessions = []
                for i in range(1, 6):
                    s_name = row.get(f'Session{i}')
                    s_date_utc = row.get(f'Session{i}DateUtc')
                    if s_name and str(s_name) != 'nan':
                        sn = str(s_name).replace('Practice 1', 'FP1').replace('Practice 2', 'FP2').replace('Practice 3', 'FP3')
                        sn = sn.replace('Sprint Shootout', 'SQ').replace('Sprint Qualifying', 'SQ').replace('Sprint', 'SR').replace('Qualifying', 'Q').replace('Race', 'R')
                        if sn == 'SR': sn = 'Sprint'
                        sessions.append({'name': sn, 'time': utils.to_ist(s_date_utc)})

                race_date_utc = row.get('Session5DateUtc')
                if pd.isna(race_date_utc): race_date_utc = row.get('EventDate')

                try:
                    if race_date_utc.tz is None: race_date_utc = race_date_utc.tz_localize('UTC')
                    iso_date = race_date_utc.tz_convert('Asia/Kolkata').isoformat()
                except Exception: iso_date = ''

                s1, s5 = row.get('Session1DateUtc'), row.get('Session5DateUtc')
                if pd.isna(s5): s5 = row.get('EventDate')
                
                if not pd.isna(s1) and not pd.isna(s5):
                    if s1.month == s5.month: date_str = f"{s1.day}-{s5.day} {s5.strftime('%b %Y')}"
                    else: date_str = f"{s1.strftime('%d %b')} - {s5.strftime('%d %b %Y')}"
                else: date_str = row['EventDate'].strftime("%b %d, %Y") if str(row['EventDate']) != 'NaT' else 'TBC'

                events.append({
                    'RoundNumber': int(row['RoundNumber']) if not pd.isna(row['RoundNumber']) else 0,
                    'EventName': row['EventName'], 'Country': row['Country'], 'Location': row['Location'],
                    'EventDate': date_str, 'EventDateTimeIso': iso_date,
                    'Format': 'sprint' if 'sprint' in str(row['EventFormat']).lower() else 'conventional',
                    'Sessions': sessions, 'Color': utils.get_team_color(row['EventName'])
                })
        
        if events: db_mod.save_schedule(db, year, events)
        return {"status": "success", "year": year, "events": events}
    except Exception as e:
        return {"status": "error", "message": f"External API Error: {str(e)}", "events": []}

@app.get("/schedule")
def schedule(request: Request, db: Session = Depends(db_mod.get_db)):
    year = CURRENT_YEAR
    data = api_schedule(year, db)
    return templates.TemplateResponse(
        request, "schedule.html", {"events": data.get("events", []), "active_page": "schedule"}
    )

# Removed Teams and Drivers routes as per user request

def _get_ergast_round(season: int):
    """Return the latest available round number for a given season via Ergast."""
    ergast = Ergast()
    try:
        res = ergast.get_driver_standings(season=season)
        if len(res.description) > 0:
            return int(res.description['round'].iloc[0])
    except Exception:
        pass
    return 1

def _safe_int(val, default=0):
    try:
        if pd.isna(val): return default
        return int(float(val))
    except (ValueError, TypeError):
        return default

def _get_driver_standings_data(db, year, round_num):
    """Internal helper to get driver standings from DB. Only fetches from live API if year is 2026."""
    cached = db_mod.get_driver_standings(db, year, round_num)
    if cached:
        for d in cached: d['Color'] = utils.get_team_color(d.get('Team', ''))
        return cached

    if year != CURRENT_YEAR: return []

    try:
        ergast = Ergast()
        res = ergast.get_driver_standings(season=year, round=round_num)
        if len(res.content) == 0: return []
        
        current_data = res.content[0]
        prev_positions = {}
        if round_num > 1:
            try:
                prev_res = ergast.get_driver_standings(season=year, round=round_num - 1)
                if len(prev_res.content) > 0:
                    for _, row in prev_res.content[0].iterrows():
                        prev_positions[row['driverId']] = _safe_int(row['position'])
            except Exception: pass

        drivers_data = []
        for _, row in current_data.iterrows():
            did = row['driverId']
            curr_pos = _safe_int(row['position'])
            prev_pos = prev_positions.get(did, curr_pos)
            trend_val = prev_pos - curr_pos
            trend = f"UP {trend_val}" if trend_val > 0 else (f"DOWN {abs(trend_val)}" if trend_val < 0 else "STABLE")
            team_name = row['constructorNames']
            if isinstance(team_name, list): team_name = team_name[0] if team_name else ""
            drivers_data.append({
                'Pos': curr_pos, 'Name': f"{row['givenName']} {row['familyName']}", 'Team': str(team_name),
                'Wins': _safe_int(row.get('wins', 0)), 'Points': float(row.get('points', 0)),
                'Trend': trend, 'TrendVal': trend_val, 'Color': utils.get_team_color(team_name)
            })
        if drivers_data: db_mod.save_driver_standings(db, year, round_num, drivers_data)
        return drivers_data
    except Exception: return []

def _get_constructor_standings_data(db, year, round_num):
    """Internal helper to get constructor standings from DB. Only fetches from live API if year is 2026."""
    cached = db_mod.get_constructor_standings(db, year, round_num)
    if cached:
        for t in cached: t['Color'] = utils.get_team_color(t.get('TeamName', ''))
        return cached

    if year != CURRENT_YEAR: return []

    try:
        ergast = Ergast()
        res = ergast.get_constructor_standings(season=year, round=round_num)
        if len(res.content) == 0: return []
        
        current_data = res.content[0]
        prev_positions = {}
        if round_num > 1:
            try:
                prev_res = ergast.get_constructor_standings(season=year, round=round_num - 1)
                if len(prev_res.content) > 0:
                    for _, row in prev_res.content[0].iterrows():
                        prev_positions[row['constructorId']] = _safe_int(row['position'])
            except Exception: pass

        teams_list = []
        for _, row in current_data.iterrows():
            cid = row['constructorId']
            curr_pos = _safe_int(row['position'])
            prev_pos = prev_positions.get(cid, curr_pos)
            trend_val = prev_pos - curr_pos
            trend = f"UP {trend_val}" if trend_val > 0 else (f"DOWN {abs(trend_val)}" if trend_val < 0 else "STABLE")
            teams_list.append({
                'TeamName': row['constructorName'], 'Points': float(row.get('points', 0)),
                'Wins': _safe_int(row.get('wins', 0)), 'Trend': trend, 'TrendVal': trend_val,
                'Color': utils.get_team_color(row['constructorName'])
            })
        if teams_list: db_mod.save_constructor_standings(db, year, round_num, teams_list)
        return teams_list
    except Exception: return []

def _get_session_results_data(db, year, round_num, session_type):
    """Internal helper to get results from DB. Only fetches from live API if year is 2026."""
    # 1. Try DB first
    cached = db_mod.get_session_results(db, year, round_num, session_type)
    if cached:
        for row in cached: row['Color'] = utils.get_team_color(row.get('Team', ''))
        return cached

    if year != CURRENT_YEAR: return []

    try:
        session = fastf1.get_session(year, round_num, session_type)
        session.load(telemetry=False, weather=False, messages=False)
        results = session.results
        data = []
        if session_type in ['R', 'S']:
            leader_time = results.iloc[0]['Time']
            for i, (_, row) in enumerate(results.iterrows()):
                points, status, raw_time = row.get('Points', 0), str(row.get('Status', '')).lower(), row.get('Time')
                display_time = utils.format_td(raw_time) if i == 0 else ("" if session_type == 'S' else "-")
                
                if i > 0:
                    if 'lap' in status or 'lapped' in status:
                        display_time = row['Status']
                    elif not pd.isna(raw_time) and not pd.isna(leader_time):
                        # Robust gap calculation
                        gap_sec = (raw_time - leader_time).total_seconds()
                        if gap_sec < 0 and raw_time.total_seconds() < (1800 if session_type == 'S' else 3600):
                            gap_sec = raw_time.total_seconds()
                        display_time = utils.format_td(pd.Timedelta(seconds=max(0, gap_sec)), is_gap=True)
                    else:
                        display_time = row['Status'] if str(row['Status']) != 'nan' else "DNF"

                data.append({
                    'Position': int(row['Position']) if not pd.isna(row['Position']) else (i+1),
                    'Driver': row['BroadcastName'], 'Team': row['TeamName'],
                    'Points': float(points) if not pd.isna(points) else 0.0,
                    'Time': display_time, 'Color': utils.get_team_color(row['TeamName'])
                })
        else: # Q or SQ or SS
            leader_best = None
            for i, (_, row) in enumerate(results.iterrows()):
                best = row.get('Q3') or row.get('Q2') or row.get('Q1')
                if i == 0:
                    leader_best = best
                    display_time = utils.format_td(best)
                else:
                    if not pd.isna(best) and not pd.isna(leader_best):
                        display_time = utils.format_td(best - leader_best, is_gap=True)
                    else:
                        display_time = "" if session_type in ['SQ', 'SS'] else "–"
                data.append({
                    'Position': int(row['Position']) if not pd.isna(row['Position']) else (i + 1),
                    'Driver': row['BroadcastName'], 'Team': row['TeamName'],
                    'Time': display_time, 'Best': utils.format_td(best), 'Color': utils.get_team_color(row['TeamName']),
                    'Q1': utils.format_td(row.get('Q1')),
                    'Q2': utils.format_td(row.get('Q2')),
                    'Q3': utils.format_td(row.get('Q3'))
                })
        if data: db_mod.save_session_results(db, year, round_num, session_type, data)
        return data
    except Exception as e:
        print(f"Error fetching {session_type} for {year} R{round_num}: {e}")
        return []

@app.get("/standings")
def standings(request: Request, year: int = CURRENT_YEAR, db: Session = Depends(db_mod.get_db)):
    try:
        current_round = db_mod.get_latest_standing_round(db, year)
        if year == CURRENT_YEAR and not current_round: current_round = _get_ergast_round(year)
        drivers_data = _get_driver_standings_data(db, year, current_round or 1)
        return templates.TemplateResponse(request, "standings.html", {"drivers": drivers_data, "season": year, "active_page": "home" if year == CURRENT_YEAR else "archives"})
    except Exception:
        return templates.TemplateResponse(request, "standings.html", {"drivers": [], "season": year, "active_page": "archives"})

@app.get("/standings/constructors")
def constructor_standings(request: Request, year: int = CURRENT_YEAR, db: Session = Depends(db_mod.get_db)):
    try:
        current_round = db_mod.get_latest_standing_round(db, year)
        if year == CURRENT_YEAR and not current_round: current_round = _get_ergast_round(year)
        teams_list = _get_constructor_standings_data(db, year, current_round or 1)
        return templates.TemplateResponse(request, "constructor_standings.html", {"teams": teams_list, "season": year, "active_page": "constructors"})
    except Exception:
        return templates.TemplateResponse(request, "constructor_standings.html", {"teams": [], "season": year, "active_page": "constructors"})

@app.get("/api/results/{year}/{round}")
def api_race_results(year: int, round: int, db: Session = Depends(db_mod.get_db)):
    data = _get_session_results_data(db, year, round, 'R')
    return {"status": "success" if data else "error", "data": data}

@app.get("/api/sprint/{year}/{round}")
def api_sprint_results(year: int, round: int, db: Session = Depends(db_mod.get_db)):
    data = _get_session_results_data(db, year, round, 'S')
    return {"status": "success" if data else "error", "data": data}

@app.get("/api/sprint_shootout/{year}/{round}")
def api_sprint_shootout_results(year: int, round: int, db: Session = Depends(db_mod.get_db)):
    # 2023 used 'SS' (Sprint Shootout), others use 'SQ'
    session_code = 'SS' if year == 2023 else 'SQ'
    data = _get_session_results_data(db, year, round, session_code)
    return {"status": "success" if data else "error", "data": data}

@app.get("/api/qualifying/{year}/{round}")
def api_qualifying_results(year: int, round: int, db: Session = Depends(db_mod.get_db)):
    data = _get_session_results_data(db, year, round, 'Q')
    return {"status": "success" if data else "error", "data": data}

@app.get("/archives")
def archives(request: Request, year: int = 2025, round: str = "final", view: str = "drivers", db: Session = Depends(db_mod.get_db)):
    # 1. Available years
    years = ARCHIVE_YEARS
    if year not in years: year = 2025
    
    # 2. Get schedule to build round selector
    schedule = db_mod.get_schedule(db, year)
    if not schedule: schedule = []
    
    # 3. Determine actual round number
    max_round = 0
    if schedule:
        max_round = max(e['RoundNumber'] for e in schedule)
    
    current_round_num = max_round
    if round != "final":
        try:
            current_round_num = int(round)
        except:
            current_round_num = max_round
    
    # 4. Fetch data based on view (using self-populating helpers)
    data = []
    if view == "drivers":
        data = _get_driver_standings_data(db, year, current_round_num)
        if data: data.sort(key=lambda x: x.get('Points', 0), reverse=True)
    elif view == "constructors":
        data = _get_constructor_standings_data(db, year, current_round_num)
        if data: data.sort(key=lambda x: x.get('Points', 0), reverse=True)
    elif view == "race":
        data = _get_session_results_data(db, year, current_round_num, 'R')
    elif view == "qualifying":
        data = _get_session_results_data(db, year, current_round_num, 'Q')
    elif view == "sprint_race":
        data = _get_session_results_data(db, year, current_round_num, 'S')
    elif view == "sprint_qualifying":
        session_code = 'SS' if year == 2023 else 'SQ'
        data = _get_session_results_data(db, year, current_round_num, session_code)

    # 5. Check if it's a sprint round
    round_info = next((e for e in schedule if e['RoundNumber'] == current_round_num), None)
    fmt = str(round_info.get('Format', '')).lower() if round_info else ''
    is_sprint = 'sprint' in fmt
    
    return templates.TemplateResponse(
        request, "archives.html", 
        {
            "year": year, "round": round, "view": view, 
            "years": years, "schedule": schedule, "data": data,
            "active_page": "archives",
            "is_sprint": is_sprint
        }
    )

# ─────────────────────────────────────────────
#  TELEMETRY PAGE
# ─────────────────────────────────────────────

@app.get("/telemetry")
def telemetry_page(request: Request, db: Session = Depends(db_mod.get_db)):
    """Render the telemetry explorer page."""
    years = [CURRENT_YEAR] + sorted(ARCHIVE_YEARS, reverse=True)
    return templates.TemplateResponse(
        request, "telemetry.html",
        {"years": years, "active_page": "telemetry"}
    )


@app.get("/api/telemetry/{year}/{round}/drivers")
def api_telemetry_drivers(year: int, round: int):
    """Returns the list of drivers available in the qualifying session."""
    try:
        session = fastf1.get_session(year, round, 'Q')
        session.load(telemetry=False, weather=False, messages=False)
        results = session.results
        drivers = []
        for _, row in results.iterrows():
            abbr = row.get('Abbreviation', '')
            drivers.append({
                'Abbreviation': abbr,
                'Driver': str(row.get('BroadcastName', abbr)),
                'Team': str(row.get('TeamName', '')),
                'Position': int(row['Position']) if not pd.isna(row.get('Position')) else 0,
                'Color': utils.get_team_color(str(row.get('TeamName', '')))
            })
        return {"status": "success", "data": drivers, "event": str(session.event.get('EventName', ''))}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/telemetry/{year}/{round}/qualifying")
def api_telemetry_qualifying(year: int, round: int, driver: str = None, compare: str = None):
    """
    Returns telemetry for specified driver(s).
    If driver is None, it returns a 400 or empty.
    """
    if not driver:
        return {"status": "error", "message": "No driver specified"}

    def nan_safe(v):
        try:
            if v is None: return None
            f = float(v)
            return None if math.isnan(f) or math.isinf(f) else f
        except Exception: return None

    def series_to_list(s, step=1):
        out = []
        if s is None: return out
        for i, v in enumerate(s):
            if i % step != 0: continue
            if hasattr(v, 'item'): v = v.item()
            out.append(nan_safe(v))
        return out

    try:
        session = fastf1.get_session(year, round, 'Q')
        session.load(telemetry=True, weather=True, messages=False)

        # Fetch representative weather data (average for the session)
        weather_data = None
        try:
            w_df = session.weather_data
            if not w_df.empty:
                weather_data = {
                    "AirTemp": nan_safe(w_df["AirTemp"].mean()),
                    "TrackTemp": nan_safe(w_df["TrackTemp"].mean()),
                    "Humidity": nan_safe(w_df["Humidity"].mean()),
                    "Pressure": nan_safe(w_df["Pressure"].mean()),
                    "WindSpeed": nan_safe(w_df["WindSpeed"].mean()),
                    "Rainfall": bool(w_df["Rainfall"].any())
                }
        except Exception: pass

        # Fetch circuit info (corners)
        circuit_info = None
        try:
            ci = session.get_circuit_info()
            if ci is not None:
                circuit_info = []
                for _, row in ci.corners.iterrows():
                    circuit_info.append({
                        "Number": str(row['Number']),
                        "X": nan_safe(row['X']),
                        "Y": nan_safe(row['Y']),
                        "Distance": nan_safe(row['Distance'])
                    })
        except Exception: pass

        def get_driver_data(abbr):
            row = session.results.loc[session.results['Abbreviation'] == abbr]
            if row.empty: return None
            row = row.iloc[0]
            
            best = row.get('Q3')
            if pd.isna(best): best = row.get('Q2')
            if pd.isna(best): best = row.get('Q1')
            
            team_name = str(row.get('TeamName', ''))
            
            telemetry_payload = None
            lap_sec = None
            try:
                drv_laps = session.laps.pick_driver(abbr)
                fast_lap = drv_laps.pick_fastest()
                if fast_lap is not None and not fast_lap.empty:
                    tel = fast_lap.get_telemetry()
                    if tel is not None and len(tel) > 0:
                        # Resample to approx 500 points for performance
                        N_step = max(1, len(tel) // 500)
                        telemetry_payload = {
                            "Speed":    series_to_list(tel['Speed'],    N_step),
                            "Gear":     series_to_list(tel['nGear'],    N_step),
                            "Throttle": series_to_list(tel['Throttle'], N_step),
                            "Brake":    series_to_list(tel['Brake'].astype(int), N_step),
                            "DRS":      series_to_list(tel['DRS'],      N_step),
                            "X":        series_to_list(tel['X'],        N_step),
                            "Y":        series_to_list(tel['Y'],        N_step),
                            "Distance": series_to_list(tel['Distance'], N_step),
                        }
                    if not pd.isna(best):
                        lap_sec = best.total_seconds()
            except Exception as e:
                print(f"Error fetching telemetry for {abbr}: {e}")

            return {
                'Position':    int(row['Position']) if not pd.isna(row.get('Position')) else 0,
                'Driver':      str(row.get('BroadcastName', abbr)),
                'Abbreviation': abbr,
                'Team':        team_name,
                'Color':       utils.get_team_color(team_name),
                'BestTime':    utils.format_td(best) if not pd.isna(best) else '–',
                'LapTimeSec':  lap_sec,
                'Q1':          utils.format_td(row.get('Q1')),
                'Q2':          utils.format_td(row.get('Q2')),
                'Q3':          utils.format_td(row.get('Q3')),
                'Telemetry':   telemetry_payload,
            }

        primary_data = get_driver_data(driver)
        compare_data = get_driver_data(compare) if compare else None

        return {
            "status": "success", 
            "data": primary_data, 
            "compare": compare_data,
            "weather": weather_data,
            "corners": circuit_info,
            "event": str(session.event.get('EventName', ''))
        }

    except Exception as e:
        traceback.print_exc()
        return {"status": "error", "message": str(e)}
