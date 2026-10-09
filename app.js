// TypeScript support for controllers/*.ts in dev. Must run before any .ts file is required.
// The Docker image compiles them to .js and ships without ts-node.
try {
	require('ts-node').register({ transpileOnly: true, files: true });
} catch (err) {
	if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

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

        console.log('   🔄 LiveReload active, watching views/ and public/');
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
	app.locals.baseurl = 'http://localhost:5483';
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
			// Escape < so a value holding </script> cannot close the inline script tag
			return JSON.stringify(context).replace(/</g, '\\u003c');
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

// ── Setup gate ──
// Credentials come from .env only (lib/credentials.js). Until GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY
// are set (or DEMO=1), pages redirect to /setup and /api/* answers 503 not_configured.
const { isConfigured, resetClients } = require('./controllers/ga4Service');
const setup = require('./lib/setupCheck');
setup.onCredentialsChange(resetClients);
const SETUP_DOC = require('./lib/setupDoc').loadSetupDoc();
const { version: APP_VERSION } = require('./package.json');

// Navbar: page title and active icon from the path (views/partials/navbar.hbs)
const NAV_PAGES = { '/': 'Dashboard', '/globe': 'Globe', '/analytics': 'Analytics', '/setup': 'Setup' };
app.use((req, res, next) => {
	const title = NAV_PAGES[req.path] || '';
	res.locals.nav = { title, dash: title === 'Dashboard', globe: title === 'Globe', analytics: title === 'Analytics' };
	next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, version: APP_VERSION }));

app.get('/api/setup/status', async (req, res) => {
	res.set('Cache-Control', 'no-store');
	try {
		res.json(await setup.checkSetup());
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get('/setup', (req, res) => {
	const mcp = SETUP_DOC.mcp.split('<project folder>').join(__dirname);
	res.render('setup', {
		head: { title: 'GA4 Dashboard · Setup', description: 'Connect Google Analytics and use it with AI', image: '', url: '' },
		prompt: SETUP_DOC.prompt,
		manual: SETUP_DOC.manual,
		mcpPrompt: mcp,
		psi: !!process.env.PSI_API_KEY,
		gaAdminUrl: setup.GA4_ADMIN_URL,
		projectDir: __dirname,
	});
});

app.use((req, res, next) => {
	if (isConfigured()) return next();
	setup.syncEnvFile(); // .env may have been written since startup
	if (isConfigured()) return next();
	if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(503).json({ error: 'not_configured' });
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

// Demo mode (DEMO=1): generated data, no Google credentials. Views show a "Demo data" badge.
app.locals.demo = require('./controllers/demoData').enabled();

/* Express Server Listening */
const port = process.env.PORT || 5483;
app.listen(port, () => {
	const serverUrl = `http://localhost:${port}`;
	console.log(`\n🚀 GA4 Dashboard server running!`);
	console.log(`   ➜ Local Dashboard: ${serverUrl}`);
	console.log(`   ➜ 3D Globe View:   ${serverUrl}/globe`);
	console.log(`   ➜ Analytics View:  ${serverUrl}/analytics\n`);
	if (app.locals.demo) console.log('   Demo mode: generated data, no GA4 calls\n');

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
	if (process.argv.includes('--refresh-cache') || app.locals.demo) {
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