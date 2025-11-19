document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('leadForm');

    // Dynamic Redirect URL setup
    // This helps the form redirect correctly whether on localhost or GitHub Pages
    if (form) {
        const nextInput = form.querySelector('input[name="_next"]');
        if (nextInput) {
            // Construct the success URL based on the current location
            // Removes 'form.html' from the end and adds 'success.html'
            const currentPath = window.location.pathname;
            const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
            const successUrl = window.location.origin + basePath + '/success.html';
            
            nextInput.value = successUrl;
            console.log('Redirect URL set to:', successUrl);
        }

        form.addEventListener('submit', function(e) {
            // Basic client-side validation logging
            const email = document.getElementById('email').value;
            console.log('Form submitting for:', email);
            
            // Optional: Add loading state to button
            const btn = form.querySelector('button');
            const originalText = btn.innerText;
            btn.innerText = 'Se trimite...';
            btn.style.opacity = '0.7';
        });
    }
});

