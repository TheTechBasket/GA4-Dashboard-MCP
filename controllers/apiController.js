// don't forget to set data to empty array after sending request to client because data is global variable
let data = [];
async function loadRealtimeReport({ propertyId, credentialsJsonPath = 'ga4dataapi-3b121924e25d.json', site }) {

    // var propertyId = '302302337';
    // var credentialsJsonPath = 'ga4dataapi-3b121924e25d.json';

    // Imports the Google Analytics Data API client library.
    const { BetaAnalyticsDataClient } = require('@google-analytics/data');

    // Creates a client.
    const analyticsDataClient = new BetaAnalyticsDataClient({
        keyFilename: credentialsJsonPath,
    });

    // Runs a realtime report.
    async function runRealtimeReport() {
        const [response] = await analyticsDataClient.runRealtimeReport({
            // The property parameter value must be in the form `properties/1234`
            // where `1234` is a GA4 property Id.
            property: `properties/${propertyId}`,
              dimensions: [
                {
                  name: 'streamName',
                },
              ],
            metrics: [
                {
                    name: 'activeUsers',
                },

                {
                    name: 'conversions',
                },
                {
                    name: 'eventCount',
                },

            ],
        });

        data.push(response);


        // console.log('Report result for: ', site);
        // console.log(response);
        // response.rows.forEach((row) => {
        //     console.log(
        //         row.dimensionValues[0],
        //         row.metricValues[0],
        //         row.metricValues[1],
        //         row.metricValues[2],
        //     );
        // });



    }   // end of runRealtimeReport

    await runRealtimeReport();




} // end of loadRealtimeReport

exports.allrealtime = async (req, res) => {


try {
    process.on('unhandledRejection', (err) => {
        console.error(err.message);
        process.exitCode = 1;
    });

    /* delcaring properites we want to check real time users */
    const properties = [
        { id: 302560390, site: "Quoted Tale" },
        { id: 302302337, site: "Quiz Qt" },
        { id: 302302242, site: "BuddeyMeter Qt" },
        { id: 302560390, site: "Qt WP" },
        { id: 257579250, site: "TTB" },
    ];

    // in developement mode we can use this
    // const properties = [
    //     { id: 302302337, site: "Quiz Qt" },
    //     { id: 302302242, site: "BuddeyMeter Qt" },
    // ];


    for (let i = 0; i < properties.length; i++) {
        await loadRealtimeReport({ propertyId:properties[i].id, site:properties[i].site});
    }


    res.status(200).render(
        'home', {
            data: data,
            head: {
                title: 'Home',
                description: 'game.description',
                image: `s`, // games featured img url
                url: `s`,
            },
        }
    )

    data = [];

} catch (err) {
    console.log(err.message);
    res.send(err.message);

}






}

// selective realtime data request to make faster load of the page
exports.realtime = async (req, res) => {
try {
    let properties = req.query.id;
    console.log(typeof (properties));


    // if single value is passed in query then convert it to array
    if (typeof(properties) !== 'object') {
        properties = [properties];
    }

    // loop over passed properties
    for (let i = 0; i < properties.length; i++) {
            await loadRealtimeReport({ propertyId:properties[i]});
        }



    res.status(200).render(
        'home', {
            data: data,
            head: {
                title: 'Home',
                description: 'game.description',
                image: `s`, // games featured img url
                url: `s`,
            },
        }
    )

    data = [];
} catch (err) {
    console.log(err.message);

    res.send(err.message);

}
}