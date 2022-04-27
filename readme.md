## Steps


* Clone repo
* run `npm install` to install all dependency
* make sure to not leak secret .json file included in repo
* and finally run `npm run dev` to access web page on localhost:3000
![alt text](https://github.com/TheTechBasket/GA4_report/blob/master/screenshot.jpg?raw=true)

* load analytics data of selected sites only with `/site?id=302302337`
** http://localhost:3000/site?id=302302337
* multiple site id value can be passed like `/site?id=ga4id&id=ga4id`
** http://localhost:3000/site?id=302302242&id=302302337


        { id: 302560390, site: "Quoted Tale" },
        { id: 302302337, site: "Quiz Qt" },
        { id: 302302242, site: "BuddeyMeter Qt" },
        { id: 302560390, site: "Qt WP" },
        { id: 257579250, site: "TTB" },

* toogle button to refresh page every 5 minute, for custom duration update `const reloadDuration = 5*60*1000;` value in `/public/js/main.js`

### Important links

* https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries
* https://developers.google.com/analytics/devguides/reporting/data/v1/quotas

* https://github.com/googleapis/google-cloud-node
* https://github.com/googleapis/nodejs-analytics-data