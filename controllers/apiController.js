

exports.allrealtime = async (req, res) => {
    const data = [];

try {
    async function main({propertyId, credentialsJsonPath = 'ga4dataapi-3b121924e25d.json', site}) {

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




    } // end of main

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


    for (let i = 0; i < properties.length; i++) {
        await main({ propertyId:properties[i].id, site:properties[i].site});
    }
    // async function getData() {
    //    await properties.forEach(property => {
    //         main({ propertyId:property.id, site:property.site});
    //    })
    //    console.log(data);
    // }
    // getData();


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

} catch (err) {
    console.log(err.message);

}






}