(function() {
    'use strict';

    /* Handle Custom Dropdowns */
    document.querySelectorAll('.archives-dropdown').forEach(dropdown => {
        const trigger = dropdown.querySelector('.archives-trigger');
        if (!trigger) return;

        const items = dropdown.querySelectorAll('.archives-item');
        const inputId = dropdown.dataset.input;
        const input = document.getElementById(inputId);

        // Toggle menu
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close others
            document.querySelectorAll('.archives-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('active');
            });
            dropdown.classList.toggle('active');
        });

        // Handle selection
        items.forEach(item => {
            item.addEventListener('click', () => {
                if (input) {
                    input.value = item.dataset.value;
                    const form = document.getElementById('archives-form');
                    if (form) form.submit();
                }
            });
        });
    });

    // Close when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.archives-dropdown').forEach(d => d.classList.remove('active'));
    });

})();
