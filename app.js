// Register TypeScript support — must be first, before any .ts file is required
require('ts-node').register({ transpileOnly: true, files: true });

const express = require('express');
const exphbs = require('express-handlebars');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

require('dotenv').config();


/* Express server */
const app = express();

/* Parsing Middlewares */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── LiveReload middleware (dev only) ──
if (process.env.NODE_ENV === 'development') {
    try {
        const livereload = require('livereload');
        const connectLivereload = require('connect-livereload');

        // Watch frontend files: views (templates) and public (CSS/JS)
        const lrServer = livereload.createServer({
            exts: ['hbs', 'js', 'css', 'scss', 'json'],
            delay: 300,
        });
        lrServer.watch([
            path.join(__dirname, 'views'),
            path.join(__dirname, 'public'),
        ]);
        lrServer.server.on('error', (err) => {
            console.warn('[livereload] Server error:', err.message);
        });

        // Inject livereload script tag into all HTML responses
        app.use(connectLivereload());

        console.log('   🔄 LiveReload active — watching views/ and public/');
    } catch (err) {
        console.warn('[livereload] Not available, run: npm install --save-dev livereload connect-livereload');
    }
}

// Static Files
app.use(express.static('public'));


// logging middleware
// there will be no logging for static file as they are served before setting up logging


if (process.env.NODE_ENV === 'development') {
	app.use(morgan('dev'));
	app.locals.baseurl = 'http://localhost:3000';
	console.log('development mode');
}

// Templating Engine

// const hbs = exphbs.create({extname: 'hbs'});
/*
  If data stored in database is in object format than use json_stringify helper to format it.
	data is sotred in object format when we pass data to the template and use it in the template.
	ex: {{{json_stringify data}}}

For stringified data stored in db use triple stash to auto parse it by handlebars.
	data is stored is string format when data is not used in template logic.
	ex: {{{data}}}
*/

app.engine('hbs', exphbs.engine({
	extname: 'hbs',
	helpers: {
		json_stringify: function (context) {
			return JSON.stringify(context);
		},
		json_parse: function (context) {
			return JSON.parse(context);
		},
		currentYear: function () {
			return new Date().getFullYear();
		}
	}
}));
app.set('view engine', 'hbs');

// ── First-run setup gate ──
// If no GA4 service-account key is present, every route except /setup
// renders the setup instructions instead of crashing on a missing credential.
const { CREDENTIALS_PATH } = require('./controllers/ga4Service');
app.get('/setup', (req, res) => {
	res.render('setup', {
		head: { title: 'GA4 Dashboard & MCP · Setup', description: 'Connect a GA4 service account', image: '', url: '' },
	});
});
app.use((req, res, next) => {
	if (req.path === '/setup' || CREDENTIALS_PATH) return next();
	res.redirect('/setup');
});

/* Routes */
const apiroutes = require("./routes/apiRoutes.js");

/* using Routes
https://expressjs.com/en/guide/routing.html
	- Actual link of routes have prefix used below
*/

// for image creation api
app.use("/", apiroutes);

/* Express Server Listening */
const port = process.env.PORT || 3000;
app.listen(port, () => {
	const serverUrl = `http://localhost:${port}`;
	console.log(`\n🚀 GA4 Pulseboard server running!`);
	console.log(`   ➜ Local Dashboard: ${serverUrl}`);
	console.log(`   ➜ 3D Globe View:   ${serverUrl}/globe`);
	console.log(`   ➜ Analytics View:  ${serverUrl}/analytics\n`);

	// Warm country metadata cache in background (restcountries.com → .cache/countries.json)
	const { warmCountriesCache } = require('./controllers/countriesCache');
	warmCountriesCache();

	// ── Clean up old report cache files (async, non-blocking) ──
	const { cacheCleanup } = require('./controllers/reportCache');

	// Immediate startup cleanup
	cacheCleanup().then(cleaned => {
		if (cleaned > 0) {
			console.log(`   🧹 Report cache: cleaned ${cleaned} stale file(s)`);
		}
	}).catch(() => {});

	// Periodic cleanup every 6 hours for long-running servers
	setInterval(() => {
		cacheCleanup().catch(() => {});
	}, 6 * 60 * 60 * 1000);

	// Trigger a properties cache refresh on startup when --refresh-cache is passed,
	// e.g.: node app.js --refresh-cache
	if (process.argv.includes('--refresh-cache')) {
		const { refreshPropertiesCache } = require('./controllers/apiController');
		refreshPropertiesCache()
			.then((props) =>
				console.log(`[startup] Cache refreshed: ${props.length} properties`),
			)
			.catch((err) =>
				console.error('[startup] Cache refresh failed:', err.message),
			);
	}
});