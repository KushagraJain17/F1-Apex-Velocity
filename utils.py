import pandas as pd

def to_ist(ts):
    if pd.isna(ts) or str(ts) == 'NaT': return ''
    try:
        if ts.tz is None: ts = ts.tz_localize('UTC')
        return ts.tz_convert('Asia/Kolkata').strftime('%a %d %b %H:%M')
    except:
        return ''

def format_td(td, is_gap=False):
    if pd.isna(td) or str(td) == 'NaT': return ''
    s = str(td)
    if 'days ' in s: s = s.split('days ')[1]
    if '.' in s: 
        parts = s.split('.')
        s = parts[0] + '.' + (parts[1][:3] if len(parts[1]) >=3 else parts[1].ljust(3, '0'))
    
    # Remove leading zeros/colons for a cleaner look
    while s.startswith('00:'): s = s[3:]
    if s.startswith('0') and not s.startswith('0.'): s = s[1:]
    
    if is_gap:
        if s.startswith('0:00.'): s = s[5:]
        elif s.startswith('00.'): s = s[3:]
        if not s.startswith('+') and not s.startswith('-'): s = f"+{s}"
    return s

def get_team_color(team_name):
    # Standard F1 2026/2025 team colors
    colors = {
        'Mercedes': '#27F4D2',
        'Red Bull Racing': '#3671C6',
        'Red Bull': '#3671C6',
        'Ferrari': '#E80020',
        'McLaren': '#FF8000',
        'Aston Martin': '#229971',
        'Alpine': '#0093CC',
        'RB': '#6692FF',
        'VCARB': '#6692FF',
        'Haas F1 Team': '#B6BABD',
        'Haas': '#B6BABD',
        'Williams': '#64C4FF',
        'Sauber': '#52E252',
        'Stake F1 Team Sauber': '#52E252',
        'Audi': '#FF0000', # Audi entering in 2026 (Sauber transition)
    }
    
    # Simple partial match
    tn = str(team_name).lower()
    for name, hex in colors.items():
        if name.lower() in tn:
            return hex
    return '#FFFFFF' # Fallback
