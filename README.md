# 🏎️ Apex Velocity - F1 Dashboard & Telemetry Explorer

**Apex Velocity** is a modern, FastAPI-powered web application that provides a comprehensive dashboard for Formula 1 fans. It features everything from the latest 2026 season schedule to a huge historical archive (2018-2025) and advanced telemetry visualization.

![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastF1](https://img.shields.io/badge/FastF1-FF1801?style=for-the-badge&logo=formula1&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)

---

## ✨ Features

- **2026 Season Dashboard**: Real-time view of the next upcoming race, latest driver standings, and current season schedule.
- **Historical Archives (2018-2025)**: Explore past seasons with full race results (Sprint, Qualifying, and Race) and season standings.
- **Interactive Telemetry**: Deep-dive into driver performance with qualifying telemetry, speed comparisons, gear/throttle analysis, and track corner maps.
- **Smart Caching**: Uses a local SQLite database and FastF1's robust caching system to ensure fast load times and minimal API overhead.
- **Modern UI**: A clean, responsive design tailored for F1 enthusiasts.

## 🛠️ Tech Stack

- **Backend**: FastAPI (Python)
- **Data Engine**: FastF1 & Ergast API
- **Database**: SQLAlchemy with SQLite
- **Templating**: Jinja2
- **Visualization**: Matplotlib & Custom Frontend JS

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- [Git](https://git-scm.com/)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/KushagraJain17/F1-Apex-Velocity.git
   cd F1-Apex-Velocity
   ```

2. **Create and activate a virtual environment**:
   ```bash
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # macOS/Linux
   source .venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

### Running the App

Start the FastAPI server:
```bash
uvicorn app:app --reload
```
The dashboard will be available at `http://127.0.0.1:8000`.

## 📁 Project Structure

```text
├── app.py           # Main application routes and logic
├── database.py      # SQLAlchemy models and database helpers
├── utils.py         # Formatting and helper functions
├── static/          # CSS, JS, and image assets
├── templates/       # Jinja2 HTML templates
└── requirements.txt # Project dependencies
```

## 📝 Configuration

The application automatically creates a `cache/` directory to store FastF1 data. If you wish to use an external database, set the `DATABASE_URL` environment variable.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue for any bugs or feature requests.

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Created with ❤️ for the F1 community.*
