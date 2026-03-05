// Register TypeScript support — must be first, before any .ts file is required
require('ts-node').register({ transpileOnly: true, files: true });

const express = require('express');
const exphbs = require('express-handlebars');
const cors = require('cors');
const morgan = require('morgan');

require('dotenv').config();


/* Express server */
const app = express();

/* Parsing Middlewares */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
		}
	}
}));
app.set('view engine', 'hbs');

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
	console.log(`app listening at ${port}`);

	// Warm country metadata cache in background (restcountries.com → .cache/countries.json)
	const { warmCountriesCache } = require('./controllers/countriesCache');
	warmCountriesCache();

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