## Steps


* Clone repo
* run `npm install` to install all dependency
* Copy `ga4dataapi.example.json` to `ga4dataapi-<your-key-id>.json` and fill in your Google service account credentials — **never commit the real key file**
* Update `CREDENTIALS_PATH` in `controllers/apiController.js` if you rename the file
* and finally run `npm run dev` to access web page on localhost:3000
![alt text](https://github.com/TheTechBasket/GA4_report/blob/master/screenshot.jpg?raw=true)

* toogle button to refresh page every 5 minute, for custom duration update `const reloadDuration = 5*60*1000;` value in `/public/js/main.js`

### Important links

* https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries
* https://developers.google.com/analytics/devguides/reporting/data/v1/quotas

* https://github.com/googleapis/google-cloud-node
* https://github.com/googleapis/nodejs-analytics-data