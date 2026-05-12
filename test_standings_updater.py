from fastf1.ergast import Ergast

def test_update_standings():
    ergast = Ergast()
    year = 2026
    
    print(f"Fetching latest standings for {year}...")
    try:
        res = ergast.get_driver_standings(season=year)
        if len(res.description) > 0:
            latest_round = int(res.description['round'].iloc[0])
            print(f"Latest round available: {latest_round}")
            
            print("\n--- DRIVER STANDINGS ---")
            driver_res = ergast.get_driver_standings(season=year, round=latest_round)
            if len(driver_res.content) > 0:
                df = driver_res.content[0]
                for _, row in df.iterrows():
                    name = f"{row['givenName']} {row['familyName']}"
                    team = row['constructorNames'][0] if row['constructorNames'] else ""
                    print(f"{row['position']:>2}. {name:<20} | {team:<15} | {row['points']} pts")
            
            print("\n--- CONSTRUCTOR STANDINGS ---")
            constructor_res = ergast.get_constructor_standings(season=year, round=latest_round)
            if len(constructor_res.content) > 0:
                df = constructor_res.content[0]
                for _, row in df.iterrows():
                    print(f"{row['position']:>2}. {row['constructorName']:<15} | {row['points']} pts")
                    
            print("\nTest successful! These standings would be saved to the database.")
        else:
            print("No standings data found.")
    except Exception as e:
        print(f"Error fetching standings: {e}")

if __name__ == '__main__':
    test_update_standings()
