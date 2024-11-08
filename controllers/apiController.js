// Function to get all GA4 properties from all accounts
async function getAnalyticsProperties(credentialsJsonPath) {
    const { AnalyticsAdminServiceClient } = require('@google-analytics/admin');
    const analyticsAdmin = new AnalyticsAdminServiceClient({
        keyFilename: credentialsJsonPath,
    });

    try {
        // Get all accounts
        const [accounts] = await analyticsAdmin.listAccounts();
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts found');
        }

        // Get properties for all accounts
        let allProperties = [];
        for (const account of accounts) {
            // console.log(account.name);
            const [properties] = await analyticsAdmin.listProperties({
                filter: `parent:${account.name}`,
                pageSize: 50
            });

            const formattedProperties = properties.map(property => ({
                id: property.name.split('/').pop(),
                site: property.displayName
            }));

            allProperties = [...allProperties, ...formattedProperties];
        }
        // console.log(allProperties);
        return allProperties;
    } catch (error) {
        console.error('Error fetching properties:', error);
        throw error;
    }
}

async function batchRealtimeReport({ properties, credentialsJsonPath = 'ga4dataapi-3b121924e25d.json' }) {
    const { BetaAnalyticsDataClient } = require('@google-analytics/data');
    const analyticsDataClient = new BetaAnalyticsDataClient({
        keyFilename: credentialsJsonPath,
    });

    // Create batch request
    const batchRequests = properties.map(property => ({
        property: `properties/${property.id}`,
        dimensions: [
            {
                name: 'streamName',
            }
        ],
        metrics: [
            {
                name: 'activeUsers',
            },
            {
                name: 'screenPageViews',
            }
        ],
        minuteRanges: [
            {
                startMinutesAgo: 29,
                endMinutesAgo: 0
            }
        ],
        dimensionFilter: {
            andGroup: {
                expressions: [
                    {
                        filter: {
                            fieldName: "platform",
                            stringFilter: {
                                matchType: "CONTAINS",
                                value: ""
                            }
                        }
                    }
                ]
            }
        }
    }));

    try {
        // Execute batch request
        const responses = await Promise.all(
            batchRequests.map(async (request, index) => {
                try {
                    const [response] = await analyticsDataClient.runRealtimeReport(request);
                    // console.log('Raw response:', JSON.stringify(response, null, 2)); // Debug log

                    // Handle empty response
                    if (!response.rows || response.rows.length === 0) {
                        return {
                            siteName: properties[index].site,
                            activeUsers: 0,
                            pageViews: 0,
                            dashboardUrl: `https://analytics.google.com/analytics/web/#/p${properties[index].id}/reports/reportinghub`
                        };
                    }

                    // Sum up active users across all rows
                    const totalActiveUsers = response.rows.reduce((sum, row) => {
                        return sum + parseInt(row.metricValues[0].value || 0);
                    }, 0);

                    const totalPageViews = response.rows.reduce((sum, row) => {
                        return sum + parseInt(row.metricValues[1].value || 0);
                    }, 0);

                    return {
                        siteName: properties[index].site,
                        activeUsers: totalActiveUsers,
                        pageViews: totalPageViews,
                        dashboardUrl: `https://analytics.google.com/analytics/web/#/p${properties[index].id}/reports/reportinghub`
                    };
                } catch (error) {
                    console.error(`Error for property ${properties[index].site}:`, error);
                    return {
                        error: true,
                        siteName: properties[index].site,
                        activeUsers: 0,
                        pageViews: 0,
                        message: error.message,
                        dashboardUrl: `https://analytics.google.com/analytics/web/#/p${properties[index].id}/reports/reportinghub`
                    };
                }
            })
        );

        // console.log('Processed responses:', JSON.stringify(responses, null, 2)); // Debug log
        return responses;
    } catch (error) {
        console.error('Batch request error:', error);
        throw error;
    }
}

exports.allrealtime = async (req, res) => {
    try {
        const properties = await getAnalyticsProperties('ga4dataapi-3b121924e25d.json');

        // Get all data in one batch request
        const batchResponse = await batchRealtimeReport({ properties });

        // Format the response for frontend
        const formattedData = batchResponse.map(response => {
            if (response.error) {
                return {
                    siteName: response.siteName,
                    activeUsers: 0,
                    pageViews: 0,
                    error: response.message,
                    dashboardUrl: response.dashboardUrl
                };
            }

            return {
                siteName: response.siteName,
                activeUsers: response.activeUsers,
                pageViews: response.pageViews,
                dashboardUrl: response.dashboardUrl
            };
        });

        res.status(200).render('home', {
            data: formattedData,
            head: {
                title: 'Home',
                description: 'Real-time Analytics Dashboard',
                image: `s`,
                url: `s`,
            },
        });

    } catch (err) {
        console.log(err.message);
        res.status(500).send(err.message);
    }
};