// get element by id

const totalActiveUsers = document.getElementById('totalActiveUsers');
const totalConversions = document.getElementById('totalConversions');
const totalEventCount = document.getElementById('totalEventCount');


// event listner on page load
window.addEventListener('load', () => {

    let ActiveUsers = livedata.reduce(function (previousValue, currentValue) {
        return previousValue + parseInt(currentValue.rows[0].metricValues[0].value)
    }, 0);

    totalActiveUsers.innerText = ActiveUsers;
    let Conversions = livedata.reduce(function (previousValue, currentValue) {
        return previousValue + parseInt(currentValue.rows[0].metricValues[1].value)
    }, 0);
    totalConversions.innerText = Conversions;
    let EventCount = livedata.reduce(function (previousValue, currentValue) {
        return previousValue + parseInt(currentValue.rows[0].metricValues[2].value)
    }, 0);
    totalEventCount.innerText = EventCount;

});


// check toggle button value before running the function
const toggle = document.getElementById('refreshToggle');

// update the data on toggle button click
toggle.addEventListener('click', () => {
    if (toggle.checked) {
        toggle.checked = true;
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

// check if page is visible or not

// document.addEventListener("visibilitychange", () => {
//     if (document.hidden) {
//         console.log('page is hidden');
//     } else {
//         console.log('page is visible');
//     }
// });



