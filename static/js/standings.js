/**
 * APEX VELOCITY - Standings Page Logic
 * Handles Global vs By Team sort toggle
 */
document.addEventListener('DOMContentLoaded', () => {
  const btnGlobal = document.getElementById('btn-global');
  const btnTeam   = document.getElementById('btn-team');
  const tbody     = document.getElementById('standings-tbody');

  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll('tr.driver-row'));

  function resetTabs() {
    btnGlobal.className = 'badge badge-dim'; btnGlobal.style.cursor = 'pointer';
    btnTeam.className   = 'badge badge-dim'; btnTeam.style.cursor   = 'pointer';
  }

  function activeTab(btn) {
    btn.className = 'badge badge-red';
    btn.style.cursor = 'pointer';
  }

  btnGlobal.addEventListener('click', () => {
    resetTabs(); activeTab(btnGlobal);
    rows.sort((a, b) => parseFloat(b.dataset.points) - parseFloat(a.dataset.points));
    rows.forEach(r => tbody.appendChild(r));
  });

  btnTeam.addEventListener('click', () => {
    resetTabs(); activeTab(btnTeam);
    rows.sort((a, b) =>
      a.dataset.team.localeCompare(b.dataset.team) ||
      parseFloat(b.dataset.points) - parseFloat(a.dataset.points)
    );
    rows.forEach(r => tbody.appendChild(r));
  });
});
