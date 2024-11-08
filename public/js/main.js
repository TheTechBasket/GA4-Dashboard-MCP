window.addEventListener('load', () => {
    const totalActiveUsers = document.getElementById('totalActiveUsers');

    let activeUsers = livedata?.reduce((total, site) => {
        return total + parseInt(site.activeUsers || 0);
    }, 0);
    console.log(activeUsers);
    // totalActiveUsers.innerText = activeUsers;
});



// check toggle button value before running the function
const toggle = document.getElementById('refreshToggle');

// update the data on toggle button click
toggle?.addEventListener('click', () => {
    if (toggle.checked) {
        toggle.checked = true;
        // imediately reload
            location.reload();

    } else {
        toggle.checked = false;
    }
});

// save toggle button state to local storage
toggle.addEventListener('change', () => {
    localStorage.setItem('toggle', toggle.checked);
});

// check toggle button state on page load
if (localStorage.getItem('toggle') === 'true') {
    toggle.checked = true;
} else {
    toggle.checked = false;
}


// relaod page every 5 minutes if toggle button is checked

const reloadDuration = 5*60*1000;
if (toggle.checked) {
    setInterval(() => {
        location.reload();
    }, reloadDuration);
    console.log(`Page will reload every ${reloadDuration/1000} seconds`);
}
