const express = require("express");
const router = express.Router();
const apiController = require("../controllers/apiController");

router.get('/', apiController.allrealtime);

/** Force a fresh pull of GA4 properties and update the on-disk cache */
router.post('/api/refresh-cache', apiController.refreshCache);

/** 3D globe page */
router.get('/globe', apiController.globeView);

/** Country-level realtime data for the globe (JSON) */
router.get('/api/globe-data', apiController.globeData);

/** City-level user avatar data for the globe map */
router.get('/api/globe-users', apiController.globeUsers);

/** Latest API quota snapshot */
router.get('/api/quota', apiController.quotaData);

/** Per-property detail: top countries, sources, pages */
router.get('/api/property-detail/:propertyId', apiController.propertyDetail);

/** Per-property aggregate visitor persona and intent insights */
router.get('/api/visitor-insights/:propertyId', apiController.visitorInsights);

/** Analytics page */
router.get('/analytics', apiController.analyticsView);

/** Analytics widget card data (non-realtime) */
router.get('/api/analytics-card/:propertyId/:type', apiController.analyticsCard);

/** Live realtime summary for a single property (reads in-memory cache) */
router.get('/api/realtime-summary/:propertyId', apiController.realtimeSummary);

/** Live realtime batch summary for all properties */
router.get('/api/realtime-all', apiController.realtimeAllApi);

/** Traffic spike detection & referral analysis */
router.get('/api/spikes', apiController.trafficSpikes);

/** Reports section – aggregated report data with spike annotations (analytics page) */
router.get('/api/analytics-reports/:propertyId', apiController.analyticsReports);

module.exports = router;
